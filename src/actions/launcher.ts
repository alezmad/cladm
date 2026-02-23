import type { Project } from "../lib/types"

interface LaunchItem {
  path: string
  sessionId?: string
  targetBranch?: string
}

export async function launchSelections(
  projects: Project[],
  selectedProjects: Set<string>,
  selectedSessions: Set<string>,
  selectedBranches: Map<string, string> = new Map()
): Promise<number> {
  const byProject = new Map<string, LaunchItem[]>()

  for (const path of selectedProjects) {
    if (!byProject.has(path)) byProject.set(path, [])
    const targetBranch = selectedBranches.get(path)
    const project = projects.find(p => p.path === path)
    const needsBranch = targetBranch && project && targetBranch !== project.branch
    byProject.get(path)!.push({ path, targetBranch: needsBranch ? targetBranch : undefined })
  }

  for (const project of projects) {
    if (!project.sessions) continue
    for (const session of project.sessions) {
      if (selectedSessions.has(session.id)) {
        if (!byProject.has(project.path)) byProject.set(project.path, [])
        const targetBranch = selectedBranches.get(project.path)
        const needsBranch = targetBranch && targetBranch !== project.branch
        byProject.get(project.path)!.push({
          path: project.path,
          sessionId: session.id,
          targetBranch: needsBranch ? targetBranch : undefined,
        })
      }
    }
  }

  let count = 0
  for (const [, items] of byProject) {
    const first = items[0]
    const firstCmd = buildCmd(first)

    const newWindowScript = [
      'tell application "Terminal"',
      "  activate",
      `  do script "${escapeAS(firstCmd)}"`,
      "end tell",
    ].join("\n")

    await runOsascript(newWindowScript)
    count++

    for (let i = 1; i < items.length; i++) {
      await Bun.sleep(400)
      const cmd = buildCmd(items[i])

      await runOsascript(
        'tell application "System Events" to keystroke "t" using command down'
      )
      await Bun.sleep(300)
      await runOsascript(
        `tell application "Terminal" to do script "${escapeAS(cmd)}" in front window`
      )
      count++
    }

    await Bun.sleep(300)
  }

  return count
}

function buildCmd(item: LaunchItem): string {
  const base = `cd '${item.path}' && claude --dangerously-skip-permissions`
  const branchFlag = item.targetBranch
    ? ` -p "switch to branch ${item.targetBranch}, stash if needed"`
    : ""
  if (item.sessionId) {
    return `${base} --resume '${item.sessionId}'${branchFlag}`
  }
  return `${base}${branchFlag}`
}

function escapeAS(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

async function runOsascript(script: string): Promise<void> {
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "ignore",
    stderr: "ignore",
  })
  await proc.exited
}
