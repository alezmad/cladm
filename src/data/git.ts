import type { BranchInfo, Project } from "../lib/types"
import { timeAgo } from "../lib/time"

async function gitCmd(path: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", path, ...args], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const text = await new Response(proc.stdout).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(`git failed: ${code}`)
  return text.trim()
}

export async function loadGitMetadata(project: Project): Promise<void> {
  const path = project.path

  const [branchResult, logResult, statusResult, syncResult] = await Promise.allSettled([
    gitCmd(path, "rev-parse", "--abbrev-ref", "HEAD"),
    gitCmd(path, "log", "-1", "--format=%ct|%s"),
    gitCmd(path, "status", "--porcelain"),
    gitCmd(path, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"),
  ])

  if (branchResult.status === "fulfilled") {
    project.branch = branchResult.value || "-"
  } else {
    project.branch = "-"
  }

  if (logResult.status === "fulfilled") {
    const raw = logResult.value
    const pipeIdx = raw.indexOf("|")
    if (pipeIdx > -1) {
      project.commitEpoch = parseInt(raw.slice(0, pipeIdx)) || 0
      project.commitAge = timeAgo(project.commitEpoch * 1000)
      const msg = raw.slice(pipeIdx + 1)
      project.commitMsg = msg.length > 22 ? msg.slice(0, 19) + "..." : msg
    }
  }

  if (statusResult.status === "fulfilled") {
    const lines = statusResult.value.split("\n").filter(Boolean)
    let staged = 0,
      unstaged = 0,
      untracked = 0
    for (const line of lines) {
      if (line.length < 2) continue
      const x = line[0],
        y = line[1]
      if (x === "?" && y === "?") {
        untracked++
      } else {
        if (x !== " " && x !== "?") staged++
        if (y !== " " && y !== "?") unstaged++
      }
    }
    const parts: string[] = []
    if (staged > 0) parts.push(`+${staged}`)
    if (unstaged > 0) parts.push(`~${unstaged}`)
    if (untracked > 0) parts.push(`?${untracked}`)
    project.dirty = parts.join(" ")
  }

  if (syncResult.status === "fulfilled") {
    const parts = syncResult.value.split("\t")
    project.ahead = parseInt(parts[0] ?? "0") || 0
    project.behind = parseInt(parts[1] ?? "0") || 0
  } else {
    project.ahead = -1
    project.behind = -1
  }
}

export async function loadBranches(projectPath: string): Promise<BranchInfo[]> {
  let raw: string
  try {
    raw = await gitCmd(
      projectPath,
      "branch",
      "--sort=-committerdate",
      "--format=%(refname:short)|%(HEAD)|%(committerdate:unix)|%(subject)",
    )
  } catch {
    return []
  }

  if (!raw) return []

  const lines = raw.split("\n").filter(Boolean)
  const top = lines.slice(0, 5)

  const branches: BranchInfo[] = []
  for (const line of top) {
    const parts = line.split("|")
    if (parts.length < 4) continue

    const name = parts[0]!
    const isCurrent = parts[1] === "*"
    const epoch = parseInt(parts[2] ?? "0") || 0
    const subject = parts.slice(3).join("|")
    const lastCommitAge = timeAgo(epoch * 1000)
    const lastCommitMsg = subject.length > 40 ? subject.slice(0, 37) + "..." : subject

    let ahead = -1
    let behind = -1
    try {
      const syncOut = await gitCmd(
        projectPath,
        "rev-list",
        "--left-right",
        "--count",
        `${name}...${name}@{upstream}`,
      )
      const syncParts = syncOut.split("\t")
      ahead = parseInt(syncParts[0] ?? "0") || 0
      behind = parseInt(syncParts[1] ?? "0") || 0
    } catch {
      ahead = -1
      behind = -1
    }

    branches.push({ name, isCurrent, lastCommitAge, lastCommitMsg, ahead, behind })
  }

  return branches
}
