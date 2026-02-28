import {
  Box,
  Text,
  t,
  bold,
  dim,
  fg,
  green,
  yellow,
  cyan,
  magenta,
  red,
} from "@opentui/core"
import { st } from "../lib/styled"
import { app } from "../lib/state"
import { CURSOR_BG, ACTIVE_BG, ACCENT } from "../lib/theme"
import { getSessionStatus, getIdleSessions } from "../data/monitor"
import { formatCost, formatWindow, makeBar, pct, PLAN_LIMITS } from "../data/usage"
import { timeAgo, formatSize, elapsedCompact, timeAgoShort } from "../lib/time"
import { fmtProjectRow, fmtSessionRow, fmtNewSessionRow, fmtBranchRow, fmtSyncIndicator } from "./formatters"

// ─── Display rows ────────────────────────────────────────────────────

export function rebuildDisplayRows() {
  app.displayRows = []
  for (const idx of app.sortedIndices) {
    const project = app.projects[idx]
    app.displayRows.push({ type: "project", projectIndex: idx })
    if (project.expanded) {
      if (project.branches) {
        for (const br of project.branches) {
          if (!br.isCurrent) {
            app.displayRows.push({ type: "branch", projectIndex: idx, branchName: br.name })
          }
        }
      }
      if (project.sessions) {
        for (let si = 0; si < project.sessions.length; si++) {
          app.displayRows.push({ type: "session", projectIndex: idx, sessionIndex: si })
        }
      }
      app.displayRows.push({ type: "new-session", projectIndex: idx })
    }
  }
}

export function applySortMode() {
  const indices = Array.from(app.projects.keys())
  switch (app.sortMode) {
    case 0:
      app.sortedIndices = indices
      break
    case 1:
      app.sortedIndices = indices.sort((a, b) =>
        app.projects[a].name.localeCompare(app.projects[b].name)
      )
      break
    case 2:
      app.sortedIndices = indices.sort(
        (a, b) => (app.projects[b].commitEpoch || 0) - (app.projects[a].commitEpoch || 0)
      )
      break
    case 3:
      app.sortedIndices = indices.sort(
        (a, b) => app.projects[b].sessionCount - app.projects[a].sessionCount
      )
      break
  }
  rebuildDisplayRows()
}

// ─── Tab bar ─────────────────────────────────────────────────────────

const PANE_COLORS = [
  "#7aa2f7", "#9ece6a", "#e0af68", "#f7768e", "#bb9af7",
  "#7dcfff", "#ff9e64", "#c0caf5", "#73daca", "#b4f9f8",
]

export function updatePaneList() {
  if (!app.paneListText) return
  if (!app.directGrid || app.gridTabs.length === 0) {
    app.paneListText.content = ""
    return
  }

  const parts: Parameters<typeof st> = [t`  `]
  let first = true
  for (const tab of app.gridTabs) {
    const tabPanes = app.directGrid.getTabPanes(tab.id)
    if (tabPanes.length === 0) continue

    for (let pi = 0; pi < tabPanes.length; pi++) {
      const pane = tabPanes[pi]!
      const name = pane.session.projectName
      const short = name.length > 14 ? name.slice(0, 12) + "…" : name
      const isFocused = app.directGrid!.activeTabId === tab.id && app.directGrid!.focusIndex === pi

      if (!first) parts.push(dim(" · "))
      parts.push(isFocused ? bold(short) : dim(short))
      first = false
    }
    parts.push(dim("  │  "))
    first = true
  }
  app.paneListText.content = st(...parts)
}

export function updateTabBar() {
  if (!app.tabBarText) return

  const pickerActive = app.viewMode === "picker"
  const sep = dim(" │ ")

  // Chrome-style: active tab gets visual emphasis
  const parts: Parameters<typeof st> = []
  if (pickerActive) {
    parts.push(t` ${dim("╭")} ${cyan("●")} ${bold("Picker")} ${dim("╮")}`)
  } else {
    parts.push(t`  ${dim("○ Picker")} `)
  }

  // Grid tabs
  for (const tab of app.gridTabs) {
    const count = app.directGrid?.getTabPaneCount(tab.id) ?? 0
    const hasIdle = app.directGrid?.hasIdleInTab(tab.id) ?? false
    const isActive = app.viewMode === "grid" && app.directGrid?.activeTabId === tab.id
    const isPending = app.directGrid?.pendingCloseTabId === tab.id
    const label = `${tab.name} (${count})`
    const closeBtn = isPending ? t` ${red(bold("●"))}` : t` ${dim("×")}`

    if (isActive) {
      parts.push(dim("╭"), t` ${cyan("●")} ${bold(label)}`, closeBtn, t` ${dim("╮")}`)
    } else if (hasIdle) {
      parts.push(t` ${yellow("◉")} ${label}`, closeBtn, " ", sep)
    } else {
      parts.push(t` ${dim("○ " + label)}`, closeBtn, " ", sep)
    }
  }

  parts.push(t` ${dim("[+]")}`)
  app.tabBarText.content = st(...parts)
}

// ─── Header / Footer ─────────────────────────────────────────────────

export function updateHeader() {
  const total = app.selectedProjects.size + app.selectedSessions.size
  // Count distinct tab groups
  const tabGroups = new Set(app.selectedProjects.values())
  const tabNote = tabGroups.size > 1 ? ` → ${tabGroups.size} tabs` : ""
  const branchNote = app.selectedBranches.size > 0 ? ` (${app.selectedBranches.size} branch switch)` : ""
  const modeLabel = app.demoMode ? " [DEMO]" : ""
  const activeCount = app.projects.reduce((sum, p) => sum + (p.activeSessions > 0 ? 1 : 0), 0)
  const busyCount = app.projects.reduce((sum, p) => sum + (p.busySessions > 0 ? 1 : 0), 0)
  const idleCount = activeCount - busyCount
  if (activeCount > 0) {
    app.headerText.content = t`  ${bold("cladm")}${yellow(modeLabel)} — ${String(total)} selected${tabNote}${branchNote}   ${dim(
      `sort: ${app.sortLabels[app.sortMode]} │ ${app.projects.length} projects`
    )} │ ${green(`${busyCount} busy`)} ${yellow(`${idleCount} idle`)}`
  } else {
    app.headerText.content = t`  ${bold("cladm")}${yellow(modeLabel)} — ${String(total)} selected${tabNote}${branchNote}   ${dim(
      `sort: ${app.sortLabels[app.sortMode]} │ ${app.projects.length} projects`
    )}`
  }
}

export function updateColumnHeaders() {
  const cols = `    ${"PROJECT".padEnd(30)} ${"BRANCH".padEnd(9)}${"SYNC".padEnd(5)}${"COMMIT".padEnd(10)}${"MESSAGE".padEnd(22)}${"DIRTY".padEnd(9)}${"LAST USE".padEnd(9)}${"SES".padStart(3)} ${"MSGS".padStart(5)} STACK`
  app.colHeaderText.content = t`  ${dim(cols)}`
}

export function updateFooter() {
  const gridHint = app.directGrid && app.directGrid.totalPaneCount > 0 ? " │ ^space grid" : ""

  // Restore mode: show choice prompt
  if (app.restoreMode === "pending") {
    app.footerText.content = t`  ${yellow("Restore session?")} ${dim("r resume │ R fresh │ esc cancel")}`
    return
  }

  // Saved session hint
  let restoreHint = ""
  if (app.savedSession) {
    const ago = timeAgoShort(app.savedSession.savedAt)
    const paneCount = app.savedSession.tabs.reduce((sum, t) => sum + t.panes.length, 0)
    restoreHint = ` │ r restore (${paneCount}p, ${ago})`
  }

  if (app.bottomPanelMode === "idle" && app.cachedIdleSessions.length > 0) {
    app.footerText.content = t`  ${dim(
      "↑↓ nav │ tab/shift-tab idle select │ enter focus │ i preview │ space select │ a all │ n none │ s sort │ q quit" + gridHint + restoreHint
    )}`
  } else {
    app.footerText.content = t`  ${dim(
      "↑↓ nav │ space select │ → expand │ ← collapse │ f folder │ g go to │ i idle │ a all │ n none │ s sort │ enter grid │ o external │ q quit" + gridHint + restoreHint
    )}`
  }
}

// ─── Bottom panel ────────────────────────────────────────────────────

function addIdleRow(s: { idleSinceMs: number; projectName: string; sessionTitle: string; lastPrompt: string; lastResponse: string }, isCursor: boolean) {
  const elapsed = (elapsedCompact(s.idleSinceMs) || "<5s").padEnd(6)
  const name = s.projectName.length > 20 ? s.projectName.slice(0, 17) + "..." : s.projectName
  const title = s.sessionTitle.length > 50 ? s.sessionTitle.slice(0, 47) + "..." : s.sessionTitle
  const prompt = s.lastPrompt
    ? s.lastPrompt.length > 60 ? s.lastPrompt.slice(0, 57) + "..." : s.lastPrompt
    : "(no text)"
  const response = s.lastResponse
    ? s.lastResponse.length > 60 ? s.lastResponse.slice(0, 57) + "..." : s.lastResponse
    : "(no response)"
  const pointer = isCursor ? "▸" : " "
  app.previewBox.add(Text({ content: t`  ${yellow("◉")} ${isCursor ? cyan(pointer) : dim(pointer)} ${dim(elapsed)}${bold(name)}  ${fg(ACCENT)('"' + title + '"')}`, width: "100%", height: 1 }))
  app.previewBox.add(Text({ content: t`       ${dim("│")}  ${dim("You:")} ${fg(ACCENT)('"' + prompt + '"')}`, width: "100%", height: 1 }))
  app.previewBox.add(Text({ content: t`       ${dim("│")}  ${dim("Claude:")} ${fg(ACCENT)('"' + response + '"')}`, width: "100%", height: 1 }))
}

function updateIdlePanel() {
  app.cachedIdleSessions = getIdleSessions(app.projects)
  const n = app.cachedIdleSessions.length
  app.previewBox.title = ` Idle Sessions (${n}) — enter to focus `
  clearChildren(app.previewBox)
  if (n === 0) {
    app.idleCursor = 0
    app.previewBox.add(Text({ content: t`${dim("  No idle sessions")}`, width: "100%", height: 1 }))
    return
  }
  if (app.idleCursor >= n) app.idleCursor = n - 1
  const show = app.cachedIdleSessions.slice(0, 3)
  for (let i = 0; i < show.length; i++) {
    addIdleRow(show[i], app.idleCursor === i)
  }
  if (n > 3) {
    app.previewBox.add(Text({ content: t`    ${dim(`+${n - 3} more`)}`, width: "100%", height: 1 }))
  }
}

export function updateBottomPanel() {
  if (app.bottomPanelMode === "idle") {
    app.bottomRow.height = 14
    updateIdlePanel()
  } else {
    clearChildren(app.previewBox)
    app.previewBox.add(app.previewText)
    app.bottomRow.height = 10
    app.previewBox.title = " Preview "
    updatePreview()
  }
}

// ─── Usage panel ─────────────────────────────────────────────────────

function usageBarColor(p: number) {
  return p >= 80 ? yellow : p >= 50 ? cyan : green
}

export function updateUsagePanel() {
  if (app.destroyed) return
  clearChildren(app.usageBox)

  if (!app.cachedUsage) {
    app.usageBox.title = " Usage "
    app.usageBox.add(Text({ content: t`${dim("Loading...")}`, width: "100%", height: 1 }))
    return
  }

  const u = app.cachedUsage
  const BAR_W = 18

  const sPct = pct(u.totalCost, PLAN_LIMITS.session)
  const sBar = makeBar(u.totalCost, PLAN_LIMITS.session, BAR_W)
  const sReset = u.sessionResetMs > 0 ? formatWindow(u.sessionResetMs) : ""
  app.usageBox.title = " Usage "
  app.usageBox.add(Text({ content: t`${bold("Session")}`, width: "100%", height: 1 }))
  app.usageBox.add(Text({ content: t`${usageBarColor(sPct)(sBar)} ${bold(String(sPct) + "%")}`, width: "100%", height: 1 }))
  app.usageBox.add(Text({ content: t`${dim(sReset ? "resets " + sReset : "")} ${dim(formatCost(u.costPerHour) + "/h")}`, width: "100%", height: 1 }))

  const wPct = pct(u.weekTotal, PLAN_LIMITS.weeklyAll)
  const wBar = makeBar(u.weekTotal, PLAN_LIMITS.weeklyAll, BAR_W)
  app.usageBox.add(Text({ content: t`${bold("All models")} ${dim(formatCost(u.weekTotal))}`, width: "100%", height: 1 }))
  app.usageBox.add(Text({ content: t`${usageBarColor(wPct)(wBar)} ${bold(String(wPct) + "%")}`, width: "100%", height: 1 }))

  const snPct = pct(u.weeklySonnetCost, PLAN_LIMITS.weeklySonnet)
  const snBar = makeBar(u.weeklySonnetCost, PLAN_LIMITS.weeklySonnet, BAR_W)
  app.usageBox.add(Text({ content: t`${bold("Sonnet")} ${dim(formatCost(u.weeklySonnetCost))}`, width: "100%", height: 1 }))
  app.usageBox.add(Text({ content: t`${usageBarColor(snPct)(snBar)} ${bold(String(snPct) + "%")}`, width: "100%", height: 1 }))

  const monthLabel = new Date().toLocaleString("en", { month: "short" })
  app.usageBox.add(Text({ content: t`${bold(monthLabel + " total")} ${dim(formatCost(u.monthlyTotalCost))}`, width: "100%", height: 1 }))
  app.usageBox.add(Text({ content: t`${dim(formatCost(u.costPerHour) + "/h avg · " + u.totalRequests + " reqs")}`, width: "100%", height: 1 }))

  app.renderer.requestRender()
}

// ─── Preview panel ───────────────────────────────────────────────────

export function updatePreview() {
  if (app.cursor >= app.displayRows.length) {
    app.previewText.content = t`${dim("  No selection")}`
    return
  }

  const row = app.displayRows[app.cursor]
  const project = app.projects[row.projectIndex]

  if (row.type === "project") {
    app.previewText.content = t`  ${bold(project.name)}  ${dim(project.path)}
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
    const sStatus = getSessionStatus(project.path, s.id)
    const sLabel = sStatus === "busy" ? green(" ● running") : sStatus === "idle" ? yellow(" ◉ idle") : ""
    app.previewText.content = t`  ${bold("Session:")} ${s.title}${sLabel}
  ${dim(timeAgo(s.timestamp))} · ${dim(formatSize(s.sizeBytes))} · ${magenta(s.branch || "-")}
  ${dim("Last prompt:")} ${s.lastUserPrompt || dim("(no text)")}
  ${dim("Claude:")} ${s.lastAssistantMsg || dim("(no text response)")}`
  } else if (row.type === "branch" && project.branches) {
    const br = project.branches.find(b => b.name === row.branchName)
    if (br) {
      const sync = fmtSyncIndicator(br.ahead, br.behind)
      const selBranch = app.selectedBranches.get(project.path)
      const selNote = selBranch === br.name
        ? t`  ${green("Selected")} — will launch with: ${dim(`-p "switch to branch ${br.name}, stash if needed"`)}`
        : t`  ${dim("Press space to select this branch for launch")}`
      app.previewText.content = st(
        t`  ${bold("Branch:")} ${magenta(br.name)}  ${dim("Sync:")} ${sync}
  ${dim("Last commit:")} ${br.lastCommitAge} — ${br.lastCommitMsg}
`, selNote)
    }
  } else {
    app.previewText.content = t`  ${green("Start a new Claude session")} in ${bold(project.name)}
  ${dim(project.path)}`
  }
}

// ─── List rendering ──────────────────────────────────────────────────

// Renderable IDs for each row — enables incremental updates
let rowRenderableIds: string[] = []

function renderRowContent(i: number) {
  const row = app.displayRows[i]
  const project = app.projects[row.projectIndex]

  let content: ReturnType<typeof t>
  let rowHeight = 1
  if (row.type === "project") {
    content = fmtProjectRow(project, app.selectedProjects.get(project.path))
  } else if (row.type === "session") {
    content = fmtSessionRow(row.projectIndex, row.sessionIndex!, app.selectedSessions.has(project.sessions![row.sessionIndex!].id), false)
    rowHeight = 3
  } else if (row.type === "branch") {
    content = fmtBranchRow(row.projectIndex, row.branchName!, app.selectedBranches.get(project.path) === row.branchName)
  } else {
    content = fmtNewSessionRow(row.projectIndex, app.selectedProjects.get(project.path))
  }

  const isCursor = i === app.cursor
  const isActiveProject = row.type === "project" && project.activeSessions > 0
  const isActiveSession = row.type === "session" && getSessionStatus(project.path, project.sessions![row.sessionIndex!].id) !== null
  const bgColor = isCursor ? CURSOR_BG : (isActiveProject || isActiveSession) ? ACTIVE_BG : undefined

  if (bgColor) {
    return Box({ backgroundColor: bgColor, shouldFill: true, width: "100%", height: rowHeight }, Text({ content }))
  }
  return Text({ content, width: "100%", height: rowHeight })
}

export function rebuildList() {
  clearChildren(app.listBox)
  rowRenderableIds = []

  for (let i = 0; i < app.displayRows.length; i++) {
    const vnode = renderRowContent(i)
    const rid = app.listBox.add(vnode)
    rowRenderableIds.push(rid as unknown as string)
  }

  ensureCursorVisible()
  app.renderer.requestRender()
}

export function ensureCursorVisible() {
  const vpH = app.listBox.viewport.height
  if (vpH <= 0) return

  let cursorY = 0
  let cursorH = 1
  for (let i = 0; i < app.displayRows.length; i++) {
    const h = app.displayRows[i].type === "session" ? 3 : 1
    if (i === app.cursor) {
      cursorH = h
      break
    }
    cursorY += h
  }

  const top = app.listBox.scrollTop
  if (cursorY < top) {
    app.listBox.scrollTo(cursorY)
  } else if (cursorY + cursorH > top + vpH) {
    app.listBox.scrollTo(cursorY + cursorH - vpH)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function clearChildren(box: { getChildren(): { id: string }[]; remove(id: string): void }) {
  for (const child of box.getChildren()) box.remove(child.id)
}

// ─── Top-level ───────────────────────────────────────────────────────

export function updateAll() {
  if (app.destroyed) return
  updateTabBar()
  updatePaneList()
  updateHeader()
  rebuildList()
  updateBottomPanel()
  updateFooter()
}
