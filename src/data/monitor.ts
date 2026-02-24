import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Project } from "../lib/types"

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

export function getSessionTtys(projectPath: string): string[] {
  const sessions = sessionsByPath.get(projectPath)
  if (!sessions) return []
  return sessions.map(s => s.tty).filter(Boolean)
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

export async function focusTerminalByPath(projectPath: string): Promise<boolean> {
  const ttys = getSessionTtys(projectPath)
  if (ttys.length === 0) return false

  const tty = ttys[0]
  const script = `
tell application "Terminal"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${tty}" then
        set selected of t to true
        set index of w to 1
        return true
      end if
    end repeat
  end repeat
end tell
return false`

  try {
    const proc = Bun.spawn(["osascript", "-e", script], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    const focused = out.trim() === "true"

    if (focused) {
      const ttys = getSessionTtys(projectPath)
      for (const tty of ttys) {
        try {
          await Bun.write(tty, "\x07")
        } catch {}
      }
    }

    return focused
  } catch {
    return false
  }
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

export function generateMockActiveSessions(projects: Project[]): void {
  const indices = Array.from(projects.keys())
  const shuffled = indices.sort(() => Math.random() - 0.5)
  const activeCount = Math.min(3 + Math.floor(Math.random() * 2), projects.length)
  for (let i = 0; i < activeCount; i++) {
    projects[shuffled[i]].activeSessions = 1 + Math.floor(Math.random() * 2)
  }
}
