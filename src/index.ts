#!/usr/bin/env bun
import {
  createCliRenderer,
  Box,
  Text,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  t,
  bold,
  dim,
  fg,
  green,
  yellow,
  cyan,
  magenta,
  type KeyEvent,
  type CliRenderer,
} from "@opentui/core"
import { discoverProjects } from "./data/history"
import { loadGitMetadata, loadBranches } from "./data/git"
import { loadSessions } from "./data/sessions"
import { generateMockProjects, generateMockSessions, generateMockBranches, generateMockBusySessions } from "./data/mock"
import { detectActiveSessions, updateProjectSessions, generateMockActiveSessions, focusTerminalByPath, checkTransitions, snapshotBusy, playDoneSound } from "./data/monitor"
import { launchSelections } from "./actions/launcher"
import type { Project, DisplayRow } from "./lib/types"
import { timeAgo, formatSize, elapsedCompact } from "./lib/time"

// ─── Theme ──────────────────────────────────────────────────────────
const CURSOR_BG = "#283457"
const ACTIVE_BG = "#1a2e1a"
const ACCENT = "#7aa2f7"
const DIM_CLR = "#565f89"

// ─── State ──────────────────────────────────────────────────────────
const demoMode = Bun.argv.includes("--demo")
let projects: Project[] = []
const selectedProjects = new Set<string>()
const selectedSessions = new Set<string>()
const selectedBranches = new Map<string, string>()
let cursor = 0
let sortMode = 0
const sortLabels = ["recent", "name", "commit", "sessions"]
let sortedIndices: number[] = []
let displayRows: DisplayRow[] = []
let monitorInterval: ReturnType<typeof setInterval> | null = null
let prevBusySnapshot: Map<string, number> = new Map()

// ─── UI Refs ────────────────────────────────────────────────────────
let renderer: CliRenderer
let headerText: TextRenderable
let colHeaderText: TextRenderable
let listBox: ScrollBoxRenderable
let previewText: TextRenderable
let footerText: TextRenderable

// ─── Display Rows ───────────────────────────────────────────────────
function rebuildDisplayRows() {
  displayRows = []
  for (const idx of sortedIndices) {
    const project = projects[idx]
    displayRows.push({ type: "project", projectIndex: idx })
    if (project.expanded) {
      if (project.branches) {
        for (const br of project.branches) {
          if (!br.isCurrent) {
            displayRows.push({ type: "branch", projectIndex: idx, branchName: br.name })
          }
        }
      }
      if (project.sessions) {
        for (let si = 0; si < project.sessions.length; si++) {
          displayRows.push({ type: "session", projectIndex: idx, sessionIndex: si })
        }
      }
      displayRows.push({ type: "new-session", projectIndex: idx })
    }
  }
}

// ─── Sort ───────────────────────────────────────────────────────────
function applySortMode() {
  const indices = Array.from(projects.keys())
  switch (sortMode) {
    case 0:
      sortedIndices = indices
      break
    case 1:
      sortedIndices = indices.sort((a, b) =>
        projects[a].name.localeCompare(projects[b].name)
      )
      break
    case 2:
      sortedIndices = indices.sort(
        (a, b) => (projects[b].commitEpoch || 0) - (projects[a].commitEpoch || 0)
      )
      break
    case 3:
      sortedIndices = indices.sort(
        (a, b) => projects[b].sessionCount - projects[a].sessionCount
      )
      break
  }
  rebuildDisplayRows()
}

// ─── Row Formatting ─────────────────────────────────────────────────
function fmtSyncIndicator(ahead: number, behind: number): string {
  if (ahead === -1 && behind === -1) return "✗"
  if (ahead === 0 && behind === 0) return "✓"
  const parts: string[] = []
  if (ahead > 0) parts.push(`↑${ahead}`)
  if (behind > 0) parts.push(`↓${behind}`)
  return parts.join("")
}

function fmtProjectRow(project: Project, isSelected: boolean) {
  let activeDot: string
  let activeTag: string
  if (project.activeSessions > 0) {
    if (project.busySessions > 0) {
      activeDot = green("●")
      activeTag = project.activeSessions > 1 ? yellow(String(project.activeSessions)) : " "
    } else {
      activeDot = yellow("◉")
      const elapsed = elapsedCompact(project.lastActivityMs)
      activeTag = elapsed ? dim(elapsed.padEnd(2).slice(0, 2)) : " "
    }
  } else {
    activeDot = dim("○")
    activeTag = " "
  }
  const check = isSelected ? green("✓") : " "
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

function fmtSessionRow(
  projectIdx: number,
  sessionIdx: number,
  isSelected: boolean,
  isLastSession: boolean
) {
  const project = projects[projectIdx]
  const session = project.sessions![sessionIdx]
  const check = isSelected ? green("✓") : " "
  const prefix = isLastSession ? "│ " : "├─"
  const title =
    session.title.length > 55
      ? session.title.slice(0, 52) + "..."
      : session.title
  const age = timeAgo(session.timestamp)
  const size = formatSize(session.sizeBytes)

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

  return t`      ${dim(prefix)} [${check}] ${dim(age.padEnd(9))} ${dim(
    size.padEnd(7)
  )} ${fg(ACCENT)('"' + title + '"')}
      ${dim("│")}     ${dim("You:")} ${fg(ACCENT)('"' + promptText + '"')}
      ${dim("│")}     ${dim("Claude:")} ${fg(ACCENT)('"' + responseText + '"')}`
}

function fmtNewSessionRow(projectIdx: number, isSelected: boolean) {
  const check = isSelected ? green("✓") : " "
  return t`      ${dim("└─")} [${check}] ${green("+ New session")}`
}

function fmtBranchRow(projectIdx: number, branchName: string, isSelected: boolean) {
  const project = projects[projectIdx]
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

// ─── UI Updates ─────────────────────────────────────────────────────
function updateHeader() {
  const total = selectedProjects.size + selectedSessions.size
  const branchNote = selectedBranches.size > 0 ? ` (${selectedBranches.size} branch switch)` : ""
  const modeLabel = demoMode ? " [DEMO]" : ""
  const activeCount = projects.reduce((sum, p) => sum + (p.activeSessions > 0 ? 1 : 0), 0)
  const busyCount = projects.reduce((sum, p) => sum + (p.busySessions > 0 ? 1 : 0), 0)
  const activeLabel = activeCount > 0
    ? ` │ ${green(`${busyCount} busy`)} ${yellow(`${activeCount - busyCount} idle`)}`
    : ""
  headerText.content = t`  ${bold("cladm")}${yellow(modeLabel)} — ${String(total)} selected${branchNote}   ${dim(
    `sort: ${sortLabels[sortMode]} │ ${projects.length} projects`
  )}${activeLabel}`
}

function updateColumnHeaders() {
  const cols = `    ${"PROJECT".padEnd(30)} ${"BRANCH".padEnd(9)}${"SYNC".padEnd(5)}${"COMMIT".padEnd(10)}${"MESSAGE".padEnd(22)}${"DIRTY".padEnd(9)}${"LAST USE".padEnd(9)}${"SES".padStart(3)} ${"MSGS".padStart(5)} STACK`
  colHeaderText.content = t`  ${dim(cols)}`
}

function updateFooter() {
  footerText.content = t`  ${dim(
    "↑↓ nav │ space select │ → expand │ ← collapse │ f folder │ g go to │ a all │ n none │ s sort │ enter launch │ q quit"
  )}`
}

function updatePreview() {
  if (cursor >= displayRows.length) {
    previewText.content = t`${dim("  No selection")}`
    return
  }

  const row = displayRows[cursor]
  const project = projects[row.projectIndex]

  if (row.type === "project") {
    previewText.content = t`  ${bold(project.name)}  ${dim(project.path)}
  ${dim("Branch:")} ${magenta(project.branch)}  ${dim("Commit:")} ${
      project.commitAge || "-"
    } — ${project.commitMsg || "-"}
  ${dim("Status:")} ${project.dirty ? yellow(project.dirty) : green("clean")}  ${dim(
      "Sessions:"
    )} ${String(project.sessionCount)}  ${dim("Msgs:")} ${String(project.totalMessages)}  ${dim(
      "Stack:"
    )} ${project.tags || "-"}`
  } else if (row.type === "session" && project.sessions) {
    const s = project.sessions[row.sessionIndex!]
    previewText.content = t`  ${bold("Session:")} ${s.title}
  ${dim(timeAgo(s.timestamp))} · ${dim(formatSize(s.sizeBytes))} · ${magenta(s.branch || "-")}
  ${dim("Last prompt:")} ${s.lastUserPrompt || dim("(no text)")}
  ${dim("Claude:")} ${s.lastAssistantMsg || dim("(no text response)")}`
  } else if (row.type === "branch" && project.branches) {
    const br = project.branches.find(b => b.name === row.branchName)
    if (br) {
      const sync = fmtSyncIndicator(br.ahead, br.behind)
      const selBranch = selectedBranches.get(project.path)
      const selNote = selBranch === br.name
        ? t`  ${green("Selected")} — will launch with: ${dim(`-p "switch to branch ${br.name}, stash if needed"`)}`
        : t`  ${dim("Press space to select this branch for launch")}`
      previewText.content = t`  ${bold("Branch:")} ${magenta(br.name)}  ${dim("Sync:")} ${sync}
  ${dim("Last commit:")} ${br.lastCommitAge} — ${br.lastCommitMsg}
${selNote}`
    }
  } else {
    previewText.content = t`  ${green("Start a new Claude session")} in ${bold(project.name)}
  ${dim(project.path)}`
  }
}

function rebuildList() {
  for (const child of listBox.getChildren()) {
    listBox.remove(child.id)
  }

  for (let i = 0; i < displayRows.length; i++) {
    const row = displayRows[i]
    const isCursor = i === cursor
    const project = projects[row.projectIndex]

    let content: ReturnType<typeof t>
    let rowHeight = 1
    if (row.type === "project") {
      const isSel = selectedProjects.has(project.path)
      content = fmtProjectRow(project, isSel)
    } else if (row.type === "session") {
      const session = project.sessions![row.sessionIndex!]
      const isSel = selectedSessions.has(session.id)
      content = fmtSessionRow(row.projectIndex, row.sessionIndex!, isSel, false)
      rowHeight = 3
    } else if (row.type === "branch") {
      const isSel = selectedBranches.get(project.path) === row.branchName
      content = fmtBranchRow(row.projectIndex, row.branchName!, isSel)
    } else {
      const isSel = selectedProjects.has(project.path)
      content = fmtNewSessionRow(row.projectIndex, isSel)
    }

    const isActive = row.type === "project" && project.activeSessions > 0
    const bgColor = isCursor ? CURSOR_BG : isActive ? ACTIVE_BG : undefined

    if (bgColor) {
      listBox.add(
        Box(
          {
            backgroundColor: bgColor,
            shouldFill: true,
            width: "100%",
            height: rowHeight,
          },
          Text({ content })
        )
      )
    } else {
      listBox.add(Text({ content, width: "100%", height: rowHeight }))
    }
  }

  ensureCursorVisible()
  renderer.requestRender()
}

function ensureCursorVisible() {
  const vpH = listBox.viewport.height
  if (vpH <= 0) return

  let cursorY = 0
  let cursorH = 1
  for (let i = 0; i < displayRows.length; i++) {
    const h = displayRows[i].type === "session" ? 3 : 1
    if (i === cursor) {
      cursorH = h
      break
    }
    cursorY += h
  }

  const top = listBox.scrollTop
  if (cursorY < top) {
    listBox.scrollTo(cursorY)
  } else if (cursorY + cursorH > top + vpH) {
    listBox.scrollTo(cursorY + cursorH - vpH)
  }
}

function updateAll() {
  updateHeader()
  rebuildList()
  updatePreview()
}

// ─── Keyboard ───────────────────────────────────────────────────────
function handleKeypress(key: KeyEvent) {
  const total = displayRows.length
  if (total === 0) return

  switch (key.name) {
    case "up":
      if (cursor > 0) cursor--
      break

    case "down":
      if (cursor < total - 1) cursor++
      break

    case "pageup":
      cursor = Math.max(0, cursor - 15)
      break

    case "pagedown":
      cursor = Math.min(total - 1, cursor + 15)
      break

    case "home":
      cursor = 0
      break

    case "end":
      cursor = total - 1
      break

    case "right": {
      const row = displayRows[cursor]
      if (row.type === "project") {
        const project = projects[row.projectIndex]
        if (!project.expanded) {
          expandProject(row.projectIndex)
          return
        }
      }
      return
    }

    case "left": {
      const row = displayRows[cursor]
      if (row.type === "project") {
        projects[row.projectIndex].expanded = false
      } else {
        projects[row.projectIndex].expanded = false
        const target = row.projectIndex
        rebuildDisplayRows()
        cursor = displayRows.findIndex(
          (r) => r.type === "project" && r.projectIndex === target
        )
        if (cursor < 0) cursor = 0
      }
      rebuildDisplayRows()
      if (cursor >= displayRows.length) cursor = displayRows.length - 1
      break
    }

    case "space": {
      const row = displayRows[cursor]
      if (row.type === "project" || row.type === "new-session") {
        const path = projects[row.projectIndex].path
        if (selectedProjects.has(path)) selectedProjects.delete(path)
        else selectedProjects.add(path)
      } else if (row.type === "session") {
        const session = projects[row.projectIndex].sessions![row.sessionIndex!]
        if (selectedSessions.has(session.id)) selectedSessions.delete(session.id)
        else selectedSessions.add(session.id)
      } else if (row.type === "branch") {
        const path = projects[row.projectIndex].path
        if (selectedBranches.get(path) === row.branchName) {
          selectedBranches.delete(path)
        } else {
          selectedBranches.set(path, row.branchName!)
        }
      }
      if (cursor < total - 1) cursor++
      break
    }

    case "f": {
      const row = displayRows[cursor]
      const project = projects[row.projectIndex]
      Bun.spawn(["open", project.path])
      break
    }

    case "g": {
      const row = displayRows[cursor]
      const project = projects[row.projectIndex]
      if (project.activeSessions > 0) {
        focusTerminalByPath(project.path)
      }
      return
    }

    case "a":
      for (const p of projects) selectedProjects.add(p.path)
      break

    case "n":
      selectedProjects.clear()
      selectedSessions.clear()
      selectedBranches.clear()
      break

    case "s":
      sortMode = (sortMode + 1) % sortLabels.length
      applySortMode()
      cursor = 0
      break

    case "return": {
      // If cursor is on a project row with active session and nothing selected, focus it
      const returnRow = displayRows[cursor]
      if (
        returnRow.type === "project" &&
        projects[returnRow.projectIndex].activeSessions > 0 &&
        selectedProjects.size === 0 &&
        selectedSessions.size === 0
      ) {
        focusTerminalByPath(projects[returnRow.projectIndex].path)
        return
      }
      doLaunch()
      break
    }

    case "q":
    case "escape":
      if (monitorInterval) clearInterval(monitorInterval)
      renderer.destroy()
      return

    default:
      return
  }

  updateAll()
}

async function expandProject(projectIndex: number) {
  const project = projects[projectIndex]
  if (demoMode) {
    if (!project.sessions) {
      project.sessions = generateMockSessions(project.path)
      project.sessionCount = project.sessions.length
    }
    if (!project.branches) {
      project.branches = generateMockBranches(project.path)
    }
  } else {
    const loads: Promise<void>[] = []
    if (!project.sessions) {
      loads.push(
        loadSessions(project.path).then(s => {
          project.sessions = s
          project.sessionCount = s.length
        })
      )
    }
    if (!project.branches) {
      loads.push(
        loadBranches(project.path).then(b => { project.branches = b }).catch(() => { project.branches = [] })
      )
    }
    if (loads.length > 0) await Promise.all(loads)
  }
  project.expanded = true
  rebuildDisplayRows()
  updateAll()
}

async function doLaunch() {
  if (selectedProjects.size === 0 && selectedSessions.size === 0) return
  const total = selectedProjects.size + selectedSessions.size
  if (demoMode) {
    // Just clear selections in demo mode
    selectedProjects.clear()
    selectedSessions.clear()
    selectedBranches.clear()
    rebuildDisplayRows()
    updateAll()
    return
  }
  await launchSelections(projects, selectedProjects, selectedSessions, selectedBranches)
  selectedProjects.clear()
  selectedSessions.clear()
  selectedBranches.clear()
  rebuildDisplayRows()
  updateAll()
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  process.stdout.write("\x1b[2J\x1b[H")
  process.stdout.write("\x1b[1m  cladm\x1b[0m\n")

  if (demoMode) {
    process.stdout.write("\x1b[2m  [Demo mode] Loading mock projects...\x1b[0m\n")
    projects = generateMockProjects()
  } else {
    process.stdout.write("\x1b[2m  Loading projects...\x1b[0m\n")
    projects = await discoverProjects()
    if (projects.length === 0) {
      console.log("  No projects found in ~/.claude/history.jsonl")
      process.exit(1)
    }
    process.stdout.write(
      `\x1b[2m  Found ${projects.length} projects. Loading git metadata...\x1b[0m\n`
    )
    await Promise.all(projects.map((p) => loadGitMetadata(p)))
  }

  sortedIndices = projects.map((_, i) => i)
  rebuildDisplayRows()

  renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useAlternateScreen: true,
    useMouse: true,
  })

  // Build layout
  const mainBox = new BoxRenderable(renderer, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
  })

  headerText = new TextRenderable(renderer, {
    width: "100%",
    height: 1,
    flexShrink: 0,
  })

  colHeaderText = new TextRenderable(renderer, {
    width: "100%",
    height: 1,
    flexShrink: 0,
  })

  listBox = new ScrollBoxRenderable(renderer, {
    scrollY: true,
    flexGrow: 1,
    viewportCulling: true,
  })

  const previewBox = new BoxRenderable(renderer, {
    height: 7,
    flexShrink: 0,
    width: "100%",
    borderStyle: "single",
    border: ["top"],
    borderColor: DIM_CLR,
    title: " Preview ",
    titleAlignment: "left",
    flexDirection: "column",
    paddingLeft: 0,
  })

  previewText = new TextRenderable(renderer, {
    width: "100%",
    flexGrow: 1,
    wrapMode: "word",
  })
  previewBox.add(previewText)

  footerText = new TextRenderable(renderer, {
    width: "100%",
    height: 1,
    flexShrink: 0,
  })

  mainBox.add(headerText)
  mainBox.add(colHeaderText)
  mainBox.add(listBox)
  mainBox.add(previewBox)
  mainBox.add(footerText)

  renderer.root.add(mainBox)

  updateHeader()
  updateColumnHeaders()
  rebuildList()
  updatePreview()
  updateFooter()

  renderer.keyInput.on("keypress", handleKeypress)

  // Live session monitoring
  if (demoMode) {
    generateMockActiveSessions(projects)
    generateMockBusySessions(projects)
    prevBusySnapshot = snapshotBusy(projects)
    updateAll()
  } else {
    detectActiveSessions().then((sessions) => {
      if (updateProjectSessions(projects, sessions)) updateAll()
      prevBusySnapshot = snapshotBusy(projects)
    })
  }

  monitorInterval = setInterval(async () => {
    if (demoMode) {
      for (const p of projects) { p.activeSessions = 0; p.busySessions = 0 }
      generateMockActiveSessions(projects)
      generateMockBusySessions(projects)
      const transitioned = checkTransitions(projects, prevBusySnapshot)
      prevBusySnapshot = snapshotBusy(projects)
      if (transitioned.length > 0) playDoneSound()
      updateAll()
    } else {
      const sessions = await detectActiveSessions()
      const changed = updateProjectSessions(projects, sessions)
      const transitioned = checkTransitions(projects, prevBusySnapshot)
      prevBusySnapshot = snapshotBusy(projects)
      if (transitioned.length > 0) playDoneSound()
      if (changed) updateAll()
    }
  }, 5000)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
