export interface TmuxSession {
  name: string
  projectPath: string
  projectName: string
  sessionId?: string
  targetBranch?: string
  alive: boolean
  width: number
  height: number
  colorIndex: number
}

const sessions = new Map<string, TmuxSession>()
let colorCounter = 0

export function getSessions(): Map<string, TmuxSession> {
  return sessions
}

export function getSessionByProject(projectPath: string): TmuxSession[] {
  return [...sessions.values()].filter(s => s.projectPath === projectPath)
}

export async function createSession(opts: {
  projectPath: string
  projectName: string
  sessionId?: string
  targetBranch?: string
  width: number
  height: number
}): Promise<TmuxSession> {
  const slug = opts.projectName.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 20)
  const ts = Date.now().toString(36)
  const name = `cladm-${slug}-${ts}`

  const cmd = buildClaudeCmd(opts.projectPath, opts.sessionId, opts.targetBranch)

  const proc = Bun.spawn([
    "tmux", "new-session", "-d",
    "-s", name,
    "-x", String(opts.width),
    "-y", String(opts.height),
    cmd,
  ], { stdout: "ignore", stderr: "pipe" })
  await proc.exited

  // Assign color index based on project path (same project = same color)
  const existingForProject = getSessionByProject(opts.projectPath)
  const ci = existingForProject.length > 0
    ? existingForProject[0]!.colorIndex
    : colorCounter++

  const session: TmuxSession = {
    name,
    projectPath: opts.projectPath,
    projectName: opts.projectName,
    sessionId: opts.sessionId,
    targetBranch: opts.targetBranch,
    alive: true,
    width: opts.width,
    height: opts.height,
    colorIndex: ci,
  }

  sessions.set(name, session)

  // Enable mouse mode so clicks/scrolls forward to the application
  Bun.spawn(["tmux", "set", "-t", name, "mouse", "on"], {
    stdout: "ignore", stderr: "ignore",
  })

  return session
}

export async function killSession(name: string): Promise<void> {
  const proc = Bun.spawn(["tmux", "kill-session", "-t", name], {
    stdout: "ignore", stderr: "ignore",
  })
  await proc.exited
  sessions.delete(name)
}

export async function resizePane(name: string, width: number, height: number): Promise<void> {
  const s = sessions.get(name)
  if (s) {
    s.width = width
    s.height = height
  }
  const proc = Bun.spawn([
    "tmux", "resize-window", "-t", name, "-x", String(width), "-y", String(height),
  ], { stdout: "ignore", stderr: "ignore" })
  await proc.exited
}

export async function isAlive(name: string): Promise<boolean> {
  const proc = Bun.spawn(["tmux", "has-session", "-t", name], {
    stdout: "ignore", stderr: "ignore",
  })
  const code = await proc.exited
  const alive = code === 0
  const s = sessions.get(name)
  if (s) s.alive = alive
  return alive
}

export async function refreshAlive(): Promise<void> {
  const checks = [...sessions.keys()].map(async name => {
    const alive = await isAlive(name)
    if (!alive) sessions.delete(name)
  })
  await Promise.all(checks)
}

export async function cleanupAll(): Promise<void> {
  const kills = [...sessions.keys()].map(name => killSession(name))
  await Promise.all(kills)
}

function buildClaudeCmd(path: string, sessionId?: string, targetBranch?: string): string {
  const base = `cd '${path}' && claude --dangerously-skip-permissions`
  const branchFlag = targetBranch
    ? ` -p "switch to branch ${targetBranch}, stash if needed"`
    : ""
  if (sessionId) return `${base} --resume '${sessionId}'${branchFlag}`
  return `${base}${branchFlag}`
}
