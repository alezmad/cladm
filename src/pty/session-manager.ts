// Direct PTY session management — no tmux.
// Each session spawns a pty-helper subprocess that owns a real PTY.
// I/O flows through Bun.spawn stdin/stdout pipes.

import type { Subprocess } from "bun"
import { resolve } from "path"

export interface PtySession {
  name: string
  projectPath: string
  projectName: string
  sessionId?: string
  targetBranch?: string
  alive: boolean
  width: number
  height: number
  colorIndex: number
  proc: Subprocess<"pipe", "pipe", "pipe">
}

const sessions = new Map<string, PtySession>()
let colorCounter = 0

// Resolve pty-helper binary path relative to this source file
const PTY_HELPER = resolve(import.meta.dir, "..", "..", "bin", "pty-helper")

export function getSessions(): Map<string, PtySession> {
  return sessions
}

export function getSessionByProject(projectPath: string): PtySession[] {
  return [...sessions.values()].filter(s => s.projectPath === projectPath)
}

export async function createSession(opts: {
  projectPath: string
  projectName: string
  sessionId?: string
  targetBranch?: string
  width: number
  height: number
}): Promise<PtySession> {
  const slug = opts.projectName.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 20)
  const ts = Date.now().toString(36)
  const name = `cladm-${slug}-${ts}`

  const cmd = buildClaudeCmd(opts.projectPath, opts.sessionId, opts.targetBranch)

  const proc = Bun.spawn([
    PTY_HELPER,
    String(opts.height),
    String(opts.width),
    "bash", "-c", cmd,
  ], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TERM: "xterm-256color", CLAUDECODE: "" },
  })

  // Assign color index based on project path (same project = same color)
  const existingForProject = getSessionByProject(opts.projectPath)
  const ci = existingForProject.length > 0
    ? existingForProject[0].colorIndex
    : colorCounter++

  const session: PtySession = {
    name,
    projectPath: opts.projectPath,
    projectName: opts.projectName,
    sessionId: opts.sessionId,
    targetBranch: opts.targetBranch,
    alive: true,
    width: opts.width,
    height: opts.height,
    colorIndex: ci,
    proc,
  }

  sessions.set(name, session)

  // Monitor for exit
  proc.exited.then(() => {
    session.alive = false
  })

  return session
}

export function killSession(name: string): void {
  const session = sessions.get(name)
  if (!session) return
  if (!session.proc.killed) {
    session.proc.stdin.end()
    session.proc.kill()
  }
  session.alive = false
  sessions.delete(name)
}

export function resizeSession(name: string, width: number, height: number): void {
  const session = sessions.get(name)
  if (!session || !session.alive || session.proc.killed) return
  session.width = width
  session.height = height
  // Send APC resize command: \x1b_R<rows>;<cols>\x1b\\
  const resizeCmd = `\x1b_R${height};${width}\x1b\\`
  try { session.proc.stdin.write(resizeCmd) } catch {}
}

export function writeToSession(name: string, data: string): void {
  const session = sessions.get(name)
  if (!session || !session.alive || session.proc.killed) return
  try { session.proc.stdin.write(data) } catch {}
}

export function isAlive(name: string): boolean {
  const session = sessions.get(name)
  if (!session) return false
  return session.alive && !session.proc.killed
}

export function refreshAlive(): void {
  for (const [name, session] of sessions) {
    if (session.proc.killed || !session.alive) {
      sessions.delete(name)
    }
  }
}

export function cleanupAll(): void {
  for (const [name] of sessions) killSession(name)
}

function buildClaudeCmd(path: string, sessionId?: string, targetBranch?: string): string {
  const base = `cd '${path}' && claude --dangerously-skip-permissions`
  const branchFlag = targetBranch
    ? ` -p "switch to branch ${targetBranch}, stash if needed"`
    : ""
  if (sessionId) return `${base} --resume '${sessionId}'${branchFlag}`
  return `${base}${branchFlag}`
}
