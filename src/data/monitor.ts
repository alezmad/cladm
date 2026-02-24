import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Project, SessionInfo } from "../lib/types"

const PROJECTS_DIR = `${Bun.env.HOME}/.claude/projects`
const BUSY_THRESHOLD_MS = 5000

export interface ActiveSession {
  pid: string
  cwd: string
  tty: string
  sessionFile: string | null
  busy: boolean
  lastActivityMs: number
}

// path → list of active sessions with tty info
const sessionsByPath = new Map<string, ActiveSession[]>()

function cwdToProjectKey(cwd: string): string {
  return cwd.replaceAll("/", "-")
}

function findActiveJsonl(projectKey: string): { path: string; mtime: number } | null {
  const projDir = join(PROJECTS_DIR, projectKey)
  try {
    const files = readdirSync(projDir).filter(f => f.endsWith(".jsonl"))
    let best: { path: string; mtime: number } | null = null
    for (const f of files) {
      const full = join(projDir, f)
      try {
        const st = statSync(full)
        const mt = st.mtimeMs
        if (!best || mt > best.mtime) best = { path: full, mtime: mt }
      } catch {}
    }
    return best
  } catch {
    return null
  }
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

async function getTtyViaPsForPids(pids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (pids.length === 0) return result
  try {
    const proc = Bun.spawn(["ps", "-o", "pid=,tty=", "-p", pids.join(",")], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const text = (await new Response(proc.stdout).text()).trim()
    await proc.exited
    for (const line of text.split("\n")) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2) {
        const pid = parts[0]
        const tty = parts[1]
        if (tty && tty !== "??" && tty !== "-") {
          result.set(pid, `/dev/tty${tty}`)
        }
      }
    }
  } catch {}
  return result
}

async function focusTerminalTab(tty: string): Promise<string> {
  const escaped = escapeAppleScript(tty)
  try {
    const proc = Bun.spawn(["osascript", "-e", `
tell application "Terminal"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${escaped}" then
        set selected of t to true
        set index of w to 1
        return tty of t
      end if
    end repeat
  end repeat
end tell
return ""`], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const out = (await new Response(proc.stdout).text()).trim()
    await proc.exited
    return out
  } catch {
    return ""
  }
}

function flashTerminalByTty(tty: string): void {
  const escaped = escapeAppleScript(tty)
  Bun.spawn(["osascript", "-e", `
tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${escaped}" then
        try
          set origBg to background color of t
          repeat 3 times
            set background color of t to {12000, 12000, 28000}
            delay 0.12
            set background color of t to origBg
            delay 0.12
          end repeat
        end try
        return
      end if
    end repeat
  end repeat
end tell`], {
    stdout: "ignore",
    stderr: "ignore",
  })
}

export async function detectActiveSessions(): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  sessionsByPath.clear()

  let pids: string[]
  try {
    const proc = Bun.spawn(["pgrep", "-f", "^claude"], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const text = await new Response(proc.stdout).text()
    await proc.exited
    pids = text.trim().split("\n").filter(Boolean)
  } catch {
    return result
  }

  if (pids.length === 0) return result

  // Batch-fetch ttys via ps for all PIDs at once
  const psTtyMap = await getTtyViaPsForPids(pids)

  const infoPromises = pids.map(async (pid): Promise<ActiveSession | null> => {
    try {
      const proc = Bun.spawn(["lsof", "-p", pid, "-a", "-d", "cwd,0", "-F", "nf"], {
        stdout: "pipe",
        stderr: "ignore",
      })
      const text = await new Response(proc.stdout).text()
      await proc.exited

      let cwd = ""
      let tty = ""
      let currentFd = ""

      for (const line of text.split("\n")) {
        if (line.startsWith("f")) {
          currentFd = line.slice(1)
        } else if (line.startsWith("n") && line.length > 1) {
          const val = line.slice(1)
          if (currentFd === "cwd") cwd = val
          else if (currentFd === "0" && val.startsWith("/dev/")) tty = val
        }
      }

      // Fallback: use pre-fetched ps tty
      if (!tty) {
        tty = psTtyMap.get(pid) ?? ""
      }

      if (cwd) {
        const key = cwdToProjectKey(cwd)
        const jsonl = findActiveJsonl(key)
        const now = Date.now()
        const busy = jsonl ? (now - jsonl.mtime) < BUSY_THRESHOLD_MS : false

        return { pid, cwd, tty, sessionFile: jsonl?.path ?? null, busy, lastActivityMs: jsonl?.mtime ?? 0 }
      }
    } catch {}
    return null
  })

  const infos = await Promise.all(infoPromises)
  for (const info of infos) {
    if (!info) continue
    result.set(info.cwd, (result.get(info.cwd) || 0) + 1)
    if (!sessionsByPath.has(info.cwd)) sessionsByPath.set(info.cwd, [])
    sessionsByPath.get(info.cwd)!.push(info)
  }

  return result
}

export function getSessionTtys(projectPath: string, sessionId?: string): string[] {
  const sessions = sessionsByPath.get(projectPath)
  if (!sessions) return []
  // If targeting a specific session, return only its tty
  if (sessionId) {
    const match = sessions.find(s => s.sessionFile?.endsWith(`${sessionId}.jsonl`))
    return match?.tty ? [match.tty] : []
  }
  // Sort by most recently active first so the best candidate is tried first
  const sorted = [...sessions].sort((a, b) => b.lastActivityMs - a.lastActivityMs)
  return sorted.map(s => s.tty).filter(Boolean)
}

export function getBusyCount(projectPath: string): number {
  const sessions = sessionsByPath.get(projectPath)
  if (!sessions) return 0
  return sessions.filter(s => s.busy).length
}

export function getLastActivityMs(projectPath: string): number {
  const sessions = sessionsByPath.get(projectPath)
  if (!sessions) return 0
  let best = 0
  for (const s of sessions) {
    if (s.lastActivityMs > best) best = s.lastActivityMs
  }
  return best
}

export async function focusTerminalByPath(projectPath: string, sessionId?: string): Promise<boolean> {
  // Collect all candidate ttys: from sessionsByPath first, then ps fallback
  const triedTtys = new Set<string>()

  // Try cached ttys from sessionsByPath (sorted by most recent, or filtered to specific session)
  const cachedTtys = getSessionTtys(projectPath, sessionId)
  for (const tty of cachedTtys) {
    triedTtys.add(tty)
    const matched = await focusTerminalTab(tty)
    if (matched) {
      flashTerminalByTty(matched)
      return true
    }
  }

  // Fallback: fresh ps lookup for PIDs not already covered
  const sessions = sessionsByPath.get(projectPath)
  const pids = sessions?.map(s => s.pid) ?? []
  if (pids.length === 0) return false

  const psTtyMap = await getTtyViaPsForPids(pids)
  for (const tty of psTtyMap.values()) {
    if (triedTtys.has(tty)) continue
    triedTtys.add(tty)
    const matched = await focusTerminalTab(tty)
    if (matched) {
      flashTerminalByTty(matched)
      return true
    }
  }

  return false
}

export function updateProjectSessions(projects: Project[], sessions: Map<string, number>): boolean {
  let changed = false
  for (const project of projects) {
    const count = sessions.get(project.path) || 0
    const busy = getBusyCount(project.path)
    const activity = getLastActivityMs(project.path)
    if (project.activeSessions !== count || project.busySessions !== busy || project.lastActivityMs !== activity) {
      project.activeSessions = count
      project.busySessions = busy
      project.lastActivityMs = activity
      changed = true
    }
  }
  return changed
}

export function checkTransitions(
  projects: Project[],
  prevBusy: Map<string, number>
): string[] {
  const transitioned: string[] = []
  for (const project of projects) {
    const prev = prevBusy.get(project.path) || 0
    if (prev > 0 && project.busySessions === 0 && project.activeSessions > 0) {
      transitioned.push(project.name)
    }
  }
  return transitioned
}

export function snapshotBusy(projects: Project[]): Map<string, number> {
  const snap = new Map<string, number>()
  for (const p of projects) {
    snap.set(p.path, p.busySessions)
  }
  return snap
}

export function playDoneSound(): void {
  Bun.spawn(["afplay", "/System/Library/Sounds/Glass.aiff"], {
    stdout: "ignore",
    stderr: "ignore",
  })
}

export function bounceDock(): void {
  Bun.spawn(["osascript", "-e", 'tell application "System Events" to tell application process "Terminal" to set frontmost to false'], {
    stdout: "ignore",
    stderr: "ignore",
  })
  // BEL character triggers Terminal dock bounce when not focused
  process.stdout.write("\x07")
}

export function getSessionStatus(projectPath: string, sessionId: string): "busy" | "idle" | null {
  const sessions = sessionsByPath.get(projectPath)
  if (!sessions) return null
  for (const s of sessions) {
    if (s.sessionFile && s.sessionFile.endsWith(`${sessionId}.jsonl`)) {
      return s.busy ? "busy" : "idle"
    }
  }
  return null
}

export function populateMockSessionStatus(project: Project): void {
  if (!project.sessions || project.activeSessions === 0) return
  const entries: ActiveSession[] = []
  // Pick first 1-2 sessions as "active"
  const activeCount = Math.min(project.activeSessions, project.sessions.length)
  for (let i = 0; i < activeCount; i++) {
    const s = project.sessions[i]
    const isBusy = project.busySessions > 0 && i < project.busySessions
    entries.push({
      pid: `mock-${s.id}`,
      cwd: project.path,
      tty: `/dev/ttys${100 + i}`,
      sessionFile: `${PROJECTS_DIR}/${project.path.replaceAll("/", "-")}/${s.id}.jsonl`,
      busy: isBusy,
      lastActivityMs: isBusy ? Date.now() - 1000 : Date.now() - 120_000,
    })
  }
  sessionsByPath.set(project.path, entries)
}

export interface IdleSessionInfo {
  projectPath: string
  projectName: string
  tty: string
  idleSinceMs: number
  sessionTitle: string
  lastPrompt: string
  lastResponse: string
}

export function getIdleSessions(projects: Project[]): IdleSessionInfo[] {
  // Deduplicate by project+sessionFile — multiple processes in same CWD share one sessionFile
  const seen = new Map<string, IdleSessionInfo>()
  for (const project of projects) {
    const sessions = sessionsByPath.get(project.path)
    if (!sessions) continue
    for (const s of sessions) {
      if (s.busy) continue
      if (!s.lastActivityMs) continue
      const dedupeKey = `${project.path}:${s.sessionFile || s.pid}`
      const existing = seen.get(dedupeKey)
      if (existing && existing.idleSinceMs >= s.lastActivityMs) continue
      let title = ""
      let lastPrompt = ""
      let lastResponse = ""
      if (project.sessions) {
        const match = project.sessions.find(
          ps => s.sessionFile && s.sessionFile.endsWith(`${ps.id}.jsonl`)
        )
        if (match) {
          title = match.title
          lastPrompt = match.lastUserPrompt
          lastResponse = match.lastAssistantMsg
        }
      }
      seen.set(dedupeKey, {
        projectPath: project.path,
        projectName: project.name,
        tty: s.tty,
        idleSinceMs: s.lastActivityMs,
        sessionTitle: title || "(session)",
        lastPrompt: lastPrompt || "",
        lastResponse: lastResponse || "",
      })
    }
  }
  const idle = Array.from(seen.values())
  idle.sort((a, b) => b.idleSinceMs - a.idleSinceMs)
  return idle
}

export function generateMockActiveSessions(projects: Project[]): void {
  const indices = Array.from(projects.keys())
  const shuffled = indices.sort(() => Math.random() - 0.5)
  const activeCount = Math.min(3 + Math.floor(Math.random() * 2), projects.length)
  for (let i = 0; i < activeCount; i++) {
    projects[shuffled[i]].activeSessions = 1 + Math.floor(Math.random() * 2)
  }
}
