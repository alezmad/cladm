import { existsSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { getTags } from "../lib/tags"
import { timeAgo } from "../lib/time"
import type { Project } from "../lib/types"

const SCAN_ROOT = `${Bun.env.HOME}/Desktop`
const HISTORY_PATH = `${Bun.env.HOME}/.claude/history.jsonl`
const PROJECTS_DIR = `${Bun.env.HOME}/.claude/projects`

interface HistoryAgg {
  msgs: number
  last: number
}

export async function discoverProjects(): Promise<Project[]> {
  const file = Bun.file(HISTORY_PATH)
  if (!(await file.exists())) return []

  const text = await file.text()
  const agg = new Map<string, HistoryAgg>()

  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const d = JSON.parse(line)
      const p = d.project as string
      const ts = (d.timestamp as number) || 0
      if (p && p.startsWith(SCAN_ROOT + "/") && p !== SCAN_ROOT) {
        let info = agg.get(p)
        if (!info) {
          info = { msgs: 0, last: 0 }
          agg.set(p, info)
        }
        info.msgs++
        info.last = Math.max(info.last, ts)
      }
    } catch {}
  }

  const projects: Project[] = []
  for (const [path, info] of agg) {
    if (!existsSync(path)) continue

    const dirName = path.replaceAll("/", "-")
    const projDir = join(PROJECTS_DIR, dirName)
    let sessionCount = 0
    try {
      sessionCount = readdirSync(projDir).filter((f) => f.endsWith(".jsonl")).length
    } catch {}

    projects.push({
      path,
      name: relative(SCAN_ROOT, path),
      branch: "",
      commitAge: "",
      commitMsg: "",
      commitEpoch: 0,
      dirty: "",
      ahead: 0,
      behind: 0,
      claudeAgo: timeAgo(info.last),
      claudeLastMs: info.last,
      sessionCount,
      totalMessages: info.msgs,
      tags: getTags(path),
      expanded: false,
      sessions: null,
      branches: null,
    })
  }

  projects.sort((a, b) => b.claudeLastMs - a.claudeLastMs)
  return projects
}
