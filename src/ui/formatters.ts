import {
  t,
  bold,
  dim,
  fg,
  green,
  yellow,
  cyan,
  magenta,
} from "@opentui/core"
import { app } from "../lib/state"
import { ACCENT } from "../lib/theme"
import { getSessionStatus } from "../data/monitor"
import { timeAgo, formatSize, elapsedCompact } from "../lib/time"

export function fmtSyncIndicator(ahead: number, behind: number): string {
  if (ahead === -1 && behind === -1) return "✗"
  if (ahead === 0 && behind === 0) return "✓"
  const parts: string[] = []
  if (ahead > 0) parts.push(`↑${ahead}`)
  if (behind > 0) parts.push(`↓${behind}`)
  return parts.join("")
}

const TAB_COLORS = [
  cyan,      // 1
  green,     // 2
  yellow,    // 3
  magenta,   // 4
  (s: string) => fg("#ff9e64")(s),  // 5
  (s: string) => fg("#7dcfff")(s),  // 6
  (s: string) => fg("#bb9af7")(s),  // 7
  (s: string) => fg("#73daca")(s),  // 8
  (s: string) => fg("#b4f9f8")(s),  // 9
]

function fmtTabCheck(tabNum: number | undefined) {
  if (tabNum === undefined) return " "
  const color = TAB_COLORS[(tabNum - 1) % TAB_COLORS.length]!
  return color(String(tabNum))
}

export function fmtProjectRow(project: import("../lib/types").Project, isSelected: number | undefined) {
  let activeDot: string
  let activeTag: string
  if (project.activeSessions > 0) {
    if (project.busySessions > 0) {
      activeDot = green("●")
      const count = String(project.activeSessions)
      activeTag = project.activeSessions > 1 ? yellow((count + " ").slice(0, 2)) : "  "
    } else {
      activeDot = yellow("◉")
      const elapsed = elapsedCompact(project.lastActivityMs)
      activeTag = elapsed ? dim((elapsed + "  ").slice(0, 2)) : "  "
    }
  } else {
    activeDot = dim("○")
    activeTag = "  "
  }
  const check = fmtTabCheck(isSelected)
  const arrow = project.expanded ? "▼" : "▶"
  const name =
    project.name.length > 28 ? project.name.slice(0, 25) + "..." : project.name
  const branch =
    project.branch.length > 8
      ? project.branch.slice(0, 7) + "…"
      : project.branch

  const sync = fmtSyncIndicator(project.ahead, project.behind)
  const syncCol = sync === "✓" ? green(sync.padEnd(5))
    : sync === "✗" ? dim(sync.padEnd(5))
    : yellow(sync.padEnd(5))

  const dirtyCol = project.dirty
    ? yellow(project.dirty.padEnd(9))
    : green("clean".padEnd(9))

  const ca = project.claudeAgo
  let claudeCol
  if (ca === "never" || ca === "-") claudeCol = dim(ca.padEnd(9))
  else if (ca.includes("m ago") || ca.includes("h ago") || ca === "just now")
    claudeCol = cyan(ca.padEnd(9))
  else if (ca.includes("d ago")) claudeCol = green(ca.padEnd(9))
  else claudeCol = dim(ca.padEnd(9))

  return t` ${activeDot}${activeTag}[${check}] ${dim(arrow)} ${name.padEnd(28)} ${magenta(branch.padEnd(9))}${syncCol}${dim(
    (project.commitAge || "-").padEnd(10)
  )}${(project.commitMsg || "-").padEnd(22)}${dirtyCol}${claudeCol}${dim(
    String(project.sessionCount).padStart(3)
  )} ${dim(String(project.totalMessages).padStart(5))} ${dim(project.tags)}`
}

export function fmtSessionRow(
  projectIdx: number,
  sessionIdx: number,
  isSelected: boolean,
  isLastSession: boolean
) {
  const project = app.projects[projectIdx]
  const session = project.sessions![sessionIdx]
  const check = isSelected ? green("✓") : " "  // sessions still use boolean check
  const prefix = isLastSession ? "│ " : "├─"
  const title =
    session.title.length > 55
      ? session.title.slice(0, 52) + "..."
      : session.title
  const age = timeAgo(session.timestamp)
  const size = formatSize(session.sizeBytes)

  const status = getSessionStatus(project.path, session.id)

  const promptText = session.lastUserPrompt
    ? session.lastUserPrompt.length > 60
      ? session.lastUserPrompt.slice(0, 57) + "..."
      : session.lastUserPrompt
    : "(no text)"
  const responseText = session.lastAssistantMsg
    ? session.lastAssistantMsg.length > 60
      ? session.lastAssistantMsg.slice(0, 57) + "..."
      : session.lastAssistantMsg
    : "(no text response)"

  if (status === "busy") {
    return t`    ${green("●")} ${dim(prefix)} [${check}] ${dim(age.padEnd(9))} ${dim(
      size.padEnd(7)
    )} ${fg(ACCENT)('"' + title + '"')} ${green("running")}
      ${dim("│")}     ${dim("You:")} ${fg(ACCENT)('"' + promptText + '"')}
      ${dim("│")}     ${dim("Claude:")} ${fg(ACCENT)('"' + responseText + '"')}`
  }
  if (status === "idle") {
    return t`    ${yellow("◉")} ${dim(prefix)} [${check}] ${dim(age.padEnd(9))} ${dim(
      size.padEnd(7)
    )} ${fg(ACCENT)('"' + title + '"')} ${yellow("idle")}
      ${dim("│")}     ${dim("You:")} ${fg(ACCENT)('"' + promptText + '"')}
      ${dim("│")}     ${dim("Claude:")} ${fg(ACCENT)('"' + responseText + '"')}`
  }
  return t`      ${dim(prefix)} [${check}] ${dim(age.padEnd(9))} ${dim(
    size.padEnd(7)
  )} ${fg(ACCENT)('"' + title + '"')}
      ${dim("│")}     ${dim("You:")} ${fg(ACCENT)('"' + promptText + '"')}
      ${dim("│")}     ${dim("Claude:")} ${fg(ACCENT)('"' + responseText + '"')}`
}

export function fmtNewSessionRow(projectIdx: number, isSelected: number | undefined) {
  const check = fmtTabCheck(isSelected)
  return t`      ${dim("└─")} [${check}] ${green("+ New session")}`
}

export function fmtBranchRow(projectIdx: number, branchName: string, isSelected: boolean) {
  const project = app.projects[projectIdx]
  const br = project.branches?.find(b => b.name === branchName)
  if (!br) return t`      ${dim("├─")} ${branchName}`

  const check = isSelected ? green("✓") : " "
  const sync = fmtSyncIndicator(br.ahead, br.behind)
  const syncCol = sync === "✓" ? green(sync)
    : sync === "✗" ? dim(sync)
    : yellow(sync)
  const msg = br.lastCommitMsg.length > 40 ? br.lastCommitMsg.slice(0, 37) + "..." : br.lastCommitMsg

  return t`      ${dim("├─")} [${check}] ${magenta(branchName.padEnd(18))} ${syncCol} ${dim(br.lastCommitAge.padEnd(9))} ${dim(msg)}`
}
