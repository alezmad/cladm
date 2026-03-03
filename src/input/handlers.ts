import type { KeyEvent } from "@opentui/core"
import { app } from "../lib/state"
import { updateAll, rebuildDisplayRows, applySortMode, updateTabBar } from "../ui/panels"
import { extractKeyboardInput, extractMouseEvents } from "./parser"
import { switchToGrid, switchToGridTab, createNewGridTab } from "../grid/view-switch"
import { doLaunch, doAddPane, launchScratchSession } from "../actions/launch"
import { launchSelections } from "../actions/launcher"
import { loadSessions } from "../data/sessions"
import { loadBranches } from "../data/git"
import { generateMockSessions, generateMockBranches } from "../data/mock"
import { focusTerminalByPath, populateMockSessionStatus } from "../data/monitor"
import { stopAllCaptures, scrollToOffset } from "../pty/capture"
import { createSession } from "../pty/session-manager"
import type { DisplayRow } from "../lib/types"
import { extractSessionState, saveSessionSync, restoreSession } from "../data/session-store"

// ─── Constants ───────────────────────────────────────────────────────

const SHIFT_ARROWS: Record<string, "up" | "down" | "left" | "right"> = {
  "\x1b[1;2A": "up",
  "\x1b[1;2B": "down",
  "\x1b[1;2C": "right",
  "\x1b[1;2D": "left",
  "\x1b[a": "up",
  "\x1b[b": "down",
  "\x1b[c": "right",
  "\x1b[d": "left",
}

const KEY_MAP: Record<string, { name: string; shift?: boolean; ctrl?: boolean }> = {
  "\x1b[A": { name: "up" },
  "\x1b[B": { name: "down" },
  "\x1b[C": { name: "right" },
  "\x1b[D": { name: "left" },
  "\x1b[5~": { name: "pageup" },
  "\x1b[6~": { name: "pagedown" },
  "\x1b[H": { name: "home" },
  "\x1b[F": { name: "end" },
  "\x1bOH": { name: "home" },
  "\x1bOF": { name: "end" },
  "\x1b[3~": { name: "delete" },
  "\x1b[Z": { name: "tab", shift: true },
  "\x1b[1;2A": { name: "up", shift: true },
  "\x1b[1;2B": { name: "down", shift: true },
  "\x1b[1;2C": { name: "right", shift: true },
  "\x1b[1;2D": { name: "left", shift: true },
  "\x09": { name: "tab" },
  "\x0d": { name: "return" },
  "\x1b": { name: "escape" },
  " ": { name: "space" },
}

const NOOP = () => {}

// ─── Selection helpers ───────────────────────────────────────────────

function toggleSetItem<T>(set: Set<T>, item: T) {
  if (set.has(item)) set.delete(item)
  else set.add(item)
}

const MAX_TAB_NUM = 9

function toggleRowSelection(row: DisplayRow) {
  const project = app.projects[row.projectIndex]!
  if (row.type === "project" || row.type === "new-session") {
    const current = app.selectedProjects.get(project.path)
    if (current === undefined) {
      app.selectedProjects.set(project.path, 1)
    } else if (current < MAX_TAB_NUM) {
      app.selectedProjects.set(project.path, current + 1)
    } else {
      app.selectedProjects.delete(project.path)
    }
  } else if (row.type === "session") {
    toggleSetItem(app.selectedSessions, project.sessions![row.sessionIndex!]!.id)
  } else if (row.type === "branch") {
    if (app.selectedBranches.get(project.path) === row.branchName) {
      app.selectedBranches.delete(project.path)
    } else {
      app.selectedBranches.set(project.path, row.branchName!)
    }
  }
}

function assignTabNumber(row: DisplayRow, tabNum: number) {
  const project = app.projects[row.projectIndex]!
  if (row.type === "project" || row.type === "new-session") {
    const current = app.selectedProjects.get(project.path)
    if (current === tabNum) {
      app.selectedProjects.delete(project.path)
    } else {
      app.selectedProjects.set(project.path, tabNum)
    }
  }
}

function syntheticKey(name: string, shift = false, ctrl = false): KeyEvent {
  return { name, shift, ctrl, meta: false, preventDefault: NOOP, stopPropagation: NOOP } as KeyEvent
}

// ─── Collapse helper ─────────────────────────────────────────────────

function collapseProject(projectIndex: number) {
  app.projects[projectIndex]!.expanded = false
  rebuildDisplayRows()
  const target = app.displayRows.findIndex(
    (r) => r.type === "project" && r.projectIndex === projectIndex
  )
  app.cursor = target >= 0 ? target : 0
  if (app.cursor >= app.displayRows.length) app.cursor = app.displayRows.length - 1
}

// ─── Expand ──────────────────────────────────────────────────────────

export async function expandProject(projectIndex: number) {
  const project = app.projects[projectIndex]!
  if (app.demoMode) {
    if (!project.sessions) {
      project.sessions = generateMockSessions(project.path)
      project.sessionCount = project.sessions.length
    }
    if (!project.branches) {
      project.branches = generateMockBranches(project.path)
    }
    populateMockSessionStatus(project)
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

// ─── Hit test ────────────────────────────────────────────────────────

export function hitTestListRow(screenRow: number): number {
  const relY = screenRow - 2 + app.listBox.scrollTop
  if (relY < 0) return -1
  let y = 0
  for (let i = 0; i < app.displayRows.length; i++) {
    const h = app.displayRows[i]!.type === "session" ? 3 : 1
    if (relY >= y && relY < y + h) return i
    y += h
  }
  return -1
}

// ─── Tab switching helpers ───────────────────────────────────────────

function handleTabSwitch(tabNumber: number) {
  if (tabNumber === 0) {
    // Switch to picker
    if (app.viewMode === "grid") switchToPicker()
    return
  }
  // tabNumber 1-9 → grid tab index 0-8
  const tabIndex = tabNumber - 1
  if (tabIndex < app.gridTabs.length) {
    switchToGridTab(app.gridTabs[tabIndex]!.id)
  }
}

function handleNextTab() {
  if (app.gridTabs.length === 0) return
  if (app.viewMode === "picker") {
    switchToGridTab(app.gridTabs[0]!.id)
    return
  }
  const currentIdx = app.gridTabs.findIndex(t => t.id === app.directGrid?.activeTabId)
  if (currentIdx < app.gridTabs.length - 1) {
    switchToGridTab(app.gridTabs[currentIdx + 1]!.id)
  } else {
    switchToPicker()
  }
}

function handlePrevTab() {
  if (app.gridTabs.length === 0) return
  if (app.viewMode === "picker") {
    switchToGridTab(app.gridTabs[app.gridTabs.length - 1]!.id)
    return
  }
  const currentIdx = app.gridTabs.findIndex(t => t.id === app.directGrid?.activeTabId)
  if (currentIdx > 0) {
    switchToGridTab(app.gridTabs[currentIdx - 1]!.id)
  } else {
    switchToPicker()
  }
}

// ─── Picker click ────────────────────────────────────────────────────

export function handlePickerClick(_col: number, screenRow: number) {
  const idx = hitTestListRow(screenRow)
  if (idx < 0 || idx >= app.displayRows.length) return
  app.cursor = idx
  toggleRowSelection(app.displayRows[idx]!)
  updateAll()
}

// ─── Picker tab bar click ────────────────────────────────────────────

function handlePickerTabBarClick(col: number, screenRow: number) {
  // Tab bar is at row 1 in picker (rendered as OpenTUI text)
  if (screenRow !== 1) return false
  // Hit test against tab bar positions — Chrome-style layout
  // Picker: ╭ ● Picker ╮ = cols 1..10 (active) or  ○ Picker  = cols 1..10
  let c = 1
  const pickerEnd = c + 10
  if (col >= c && col <= pickerEnd) return false // already on picker
  c = 11

  for (const tab of app.gridTabs) {
    const isActive = app.viewMode === "grid" && app.directGrid?.activeTabId === tab.id

    // Build inline pane name list to calculate width
    const tabPanes = app.directGrid?.getTabPanes(tab.id) ?? []
    const paneNames = tabPanes.map(p => {
      const name = p.session.projectName
      return name.length > 14 ? name.slice(0, 12) + "…" : name
    })
    const inlineLabel = paneNames.length > 0 ? paneNames.join(" · ") : "empty"
    const visLen = 2 + inlineLabel.length // "● " + label

    const dg = app.directGrid

    if (isActive) {
      // Active: ╭ ● panes × ╮
      const labelStart = c + 2
      const labelEnd = labelStart + visLen - 1
      const closeCol = labelEnd + 2
      const totalVis = 1 + 1 + visLen + 1 + 1 + 1 + 1

      if (col === closeCol && dg) {
        const result = dg.requestCloseTab(tab.id)
        if (result === "closed") updateAll()
        else { updateTabBar(); app.renderer.requestRender() }
        return true
      }
      if (col >= labelStart && col <= labelEnd) {
        switchToGridTab(tab.id)
        return true
      }
      c += totalVis
    } else {
      // Inactive: sp ● panes sp × sp │
      const labelStart = c + 1
      const labelEnd = labelStart + visLen - 1
      const closeCol = labelEnd + 2
      const totalVis = 1 + visLen + 1 + 1 + 1 + 1

      if (col === closeCol && dg) {
        const result = dg.requestCloseTab(tab.id)
        if (result === "closed") updateAll()
        else { updateTabBar(); app.renderer.requestRender() }
        return true
      }
      if (col >= labelStart && col <= labelEnd) {
        switchToGridTab(tab.id)
        return true
      }
      c += totalVis
    }
  }

  // [+] button
  if (col >= c + 1 && col <= c + 3) {
    createNewGridTab()
    return true
  }

  return false
}

// ─── Quit helper ─────────────────────────────────────────────────────

function doQuit() {
  app.destroyed = true
  if (app.monitorInterval) clearInterval(app.monitorInterval)
  try {
    const state = extractSessionState()
    if (state) saveSessionSync(state)
  } catch {}
  stopAllCaptures()
  process.stdout.write("\x1b[?1006l")
  process.stdout.write("\x1b[?1002l")
  process.stdout.write("\x1b[?1000l")
  app.renderer.destroy()
}

let _quitPending = false

function drawQuitModal() {
  const w = process.stdout.columns || 120
  const h = process.stdout.rows || 40
  const boxW = 40
  const boxH = 5
  const x = Math.floor((w - boxW) / 2)
  const y = Math.floor((h - boxH) / 2)
  const hz = "─"
  const bg = "\x1b[48;2;30;30;46m"
  const fg = "\x1b[38;2;192;202;245m"
  const accent = "\x1b[38;2;158;206;106m"
  const dim = "\x1b[2m"
  const bold = "\x1b[1m"
  const rst = "\x1b[0m"
  const border = "\x1b[38;2;86;95;137m"
  let out = "\x1b[?2026h"
  out += `\x1b[${y};${x}H${bg}${border}╭${hz.repeat(boxW - 2)}╮${rst}`
  out += `\x1b[${y + 1};${x}H${bg}${border}│${rst}${bg}${" ".repeat(boxW - 2)}${border}│${rst}`
  const title = "  Quit cladm?"
  const pad1 = boxW - 2 - title.length
  out += `\x1b[${y + 2};${x}H${bg}${border}│${rst}${bg}${fg}${bold}${title}${" ".repeat(Math.max(0, pad1))}${border}│${rst}`
  const prompt = `  ${accent}${bold}[Enter]${rst}${bg}${fg} Yes   ${dim}[Esc]${rst}${bg}${fg} Cancel`
  const pad2 = boxW - 2 - 26
  out += `\x1b[${y + 3};${x}H${bg}${border}│${rst}${bg}${prompt}${" ".repeat(Math.max(0, pad2))}${border}│${rst}`
  out += `\x1b[${y + 4};${x}H${bg}${border}╰${hz.repeat(boxW - 2)}╯${rst}`
  out += "\x1b[?2026l"
  process.stdout.write(out)
}

function dismissQuitModal() {
  _quitPending = false
  if (app.viewMode === "grid" && app.directGrid) {
    app.directGrid.forceRedrawAll()
  } else {
    app.renderer.requestRender()
  }
}

function showQuitConfirm() {
  _quitPending = true
  drawQuitModal()
}

// ─── Keyboard ────────────────────────────────────────────────────────

export async function handleKeypress(key: KeyEvent) {
  try {
  const total = app.displayRows.length
  if (total === 0) return

  switch (key.name) {
    case "up":
      if (app.cursor > 0) app.cursor--
      break

    case "down":
      if (app.cursor < total - 1) app.cursor++
      break

    case "pageup":
      app.cursor = Math.max(0, app.cursor - 15)
      break

    case "pagedown":
      app.cursor = Math.min(total - 1, app.cursor + 15)
      break

    case "home":
      app.cursor = 0
      break

    case "end":
      app.cursor = total - 1
      break

    case "right": {
      const row = app.displayRows[app.cursor]!
      if (row.type === "project" && !app.projects[row.projectIndex]!.expanded) {
        expandProject(row.projectIndex)
        return
      }
      return
    }

    case "left":
      collapseProject(app.displayRows[app.cursor]!.projectIndex)
      break

    case "space":
      toggleRowSelection(app.displayRows[app.cursor]!)
      break

    case "f": {
      const project = app.projects[app.displayRows[app.cursor]!.projectIndex]!
      Bun.spawn(["open", project.path])
      break
    }

    case "g": {
      const row = app.displayRows[app.cursor]!
      const project = app.projects[row.projectIndex]!

      // Try grid pane navigation first
      if (app.directGrid && app.gridTabs.length > 0) {
        const targetSessionId = row.type === "session" && project.sessions
          ? project.sessions[row.sessionIndex!]?.id
          : undefined

        for (const tab of app.gridTabs) {
          const panes = app.directGrid.getTabPanes(tab.id)
          const paneIdx = targetSessionId
            ? panes.findIndex(p => p.session.projectPath === project.path && p.session.sessionId === targetSessionId)
            : panes.findIndex(p => p.session.projectPath === project.path)
          if (paneIdx >= 0) {
            switchToGridTab(tab.id)
            app.directGrid.setFocus(paneIdx)
            return
          }
        }
      }

      // Fallback: external terminal
      if (project.activeSessions > 0) {
        const sid = row.type === "session" && project.sessions
          ? project.sessions[row.sessionIndex!]?.id
          : undefined
        await focusTerminalByPath(project.path, sid)
      }
      return
    }

    case "a":
      for (const p of app.projects) app.selectedProjects.set(p.path, 1)
      break

    case "n":
      app.selectedProjects.clear()
      app.selectedSessions.clear()
      app.selectedBranches.clear()
      break

    case "i":
      app.bottomPanelMode = app.bottomPanelMode === "preview" ? "idle" : "preview"
      app.idleCursor = 0
      break

    case "tab":
      if (app.bottomPanelMode === "idle" && app.cachedIdleSessions.length > 0) {
        const max = Math.min(app.cachedIdleSessions.length, 3)
        app.idleCursor = key.shift
          ? (app.idleCursor > 0 ? app.idleCursor - 1 : max - 1)
          : (app.idleCursor + 1) % max
      }
      break

    case "s":
      app.sortMode = (app.sortMode + 1) % app.sortLabels.length
      applySortMode()
      app.cursor = 0
      break

    case "return": {
      const hasSelections = app.selectedProjects.size > 0 || app.selectedSessions.size > 0
      if (hasSelections) {
        if (app.addPaneTargetTabId !== null) {
          doAddPane()
        } else {
          doLaunch()
        }
        break
      }
      if (app.addPaneTargetTabId !== null) {
        const addRow = app.displayRows[app.cursor]
        if (addRow) app.selectedProjects.set(app.projects[addRow.projectIndex]!.path, 1)
        doAddPane()
        break
      }
      if (app.bottomPanelMode === "idle" && app.cachedIdleSessions.length > 0 && app.idleCursor < app.cachedIdleSessions.length) {
        if (await focusTerminalByPath(app.cachedIdleSessions[app.idleCursor]!.projectPath)) return
      }
      const returnRow = app.displayRows[app.cursor]!
      if (returnRow.type === "project" && app.projects[returnRow.projectIndex]!.activeSessions > 0) {
        if (await focusTerminalByPath(app.projects[returnRow.projectIndex]!.path)) return
      }
      doLaunch()
      break
    }

    case "o": {
      if (app.selectedProjects.size === 0 && app.selectedSessions.size === 0) {
        const oRow = app.displayRows[app.cursor]
        if (oRow) app.selectedProjects.set(app.projects[oRow.projectIndex]!.path, 1)
      }
      if (app.selectedProjects.size > 0 || app.selectedSessions.size > 0) {
        await launchSelections(app.projects, app.selectedProjects, app.selectedSessions, app.selectedBranches)
        app.selectedProjects.clear()
        app.selectedSessions.clear()
        app.selectedBranches.clear()
      }
      break
    }

    case "c":
      launchScratchSession()
      return

    case "delete": {
      const delRow = app.displayRows[app.cursor]!
      const delProject = app.projects[delRow.projectIndex]!
      if (delRow.type === "project" || delRow.type === "new-session") {
        app.selectedProjects.delete(delProject.path)
      } else if (delRow.type === "session") {
        app.selectedSessions.delete(delProject.sessions![delRow.sessionIndex!]!.id)
      } else if (delRow.type === "branch") {
        app.selectedBranches.delete(delProject.path)
      }
      break
    }

    case "1": case "2": case "3": case "4": case "5":
    case "6": case "7": case "8": case "9": {
      const row = app.displayRows[app.cursor]!
      assignTabNumber(row, parseInt(key.name))
      break
    }

    case "r": {
      if (app.restoreMode === "pending") {
        // Second press: restore with resume
        const saved = app.savedSession
        if (saved) {
          app.restoreMode = null
          await restoreSession(saved, true)
          return
        }
      } else if (app.savedSession) {
        app.restoreMode = "pending"
      }
      break
    }

    case "R": {
      if (app.restoreMode === "pending") {
        // Shift+R: restore fresh (no sessionIds)
        const saved = app.savedSession
        if (saved) {
          app.restoreMode = null
          await restoreSession(saved, false)
          return
        }
      }
      break
    }

    case "escape":
      if (app.addPaneTargetTabId !== null) {
        const returnTabId = app.addPaneTargetTabId
        app.addPaneTargetTabId = null
        app.selectedProjects.clear()
        app.selectedSessions.clear()
        app.selectedBranches.clear()
        switchToGridTab(returnTabId)
        return
      }
      if (app.restoreMode === "pending") {
        app.restoreMode = null
        break
      }
      doQuit()
      return

    case "q":
      doQuit()
      return

    default:
      return
  }

  updateAll()
  } catch (err) { console.error("[handleKeypress]", err) }
}

// ─── Grid input ──────────────────────────────────────────────────────

export async function handleGridInput(rawSequence: string): Promise<boolean> {
  if (app.viewMode !== "grid" || !app.directGrid) return false

  // Quit confirmation intercept
  if (_quitPending) {
    if (rawSequence === "\x0d" || rawSequence === "y" || rawSequence === "Y") { doQuit(); return true }
    dismissQuitModal()
    return true
  }

  // Ctrl+Q → quit confirmation
  if (rawSequence === "\x11") { showQuitConfirm(); return true }

  // Esc: collapse expanded/soft-expanded, or do nothing
  if (rawSequence === "\x1b") {
    if (app.directGrid.isExpanded) { app.directGrid.collapsePane(); return true }
    if (app.directGrid.isSoftExpanded) { app.directGrid.softCollapsePane(); return true }
    return true
  }

  // Ctrl+Space → switch to picker
  if (rawSequence === "\x00") {
    app.lastGridTabIndex = app.gridTabs.findIndex(t => t.id === app.directGrid!.activeTabId)
    switchToPicker()
    return true
  }

  // Ctrl+T → new tab
  if (rawSequence === "\x14") {
    createNewGridTab()
    return true
  }

  // Ctrl+S → open chat in TextEdit for easy copying
  if (rawSequence === "\x13") {
    app.directGrid.openInTextEdit()
    return true
  }

  // Ctrl+E → toggle click-to-expand
  if (rawSequence === "\x05") {
    app.clickExpand = !app.clickExpand
    if (!app.clickExpand && app.directGrid.isSoftExpanded) app.directGrid.softCollapsePane()
    app.directGrid.drawChrome()
    return true
  }

  // Alt+1 through Alt+9 → switch tab
  if (rawSequence.length === 2 && rawSequence[0] === "\x1b" && rawSequence[1]! >= "1" && rawSequence[1]! <= "9") {
    handleTabSwitch(parseInt(rawSequence[1]!))
    return true
  }

  // Alt+n → next tab, Alt+p → prev tab
  if (rawSequence === "\x1bn") { handleNextTab(); return true }
  if (rawSequence === "\x1bp") { handlePrevTab(); return true }

  // Ctrl+N → add pane to current tab (enter picker in add-pane mode)
  if (rawSequence === "\x0e") {
    app.addPaneTargetTabId = app.directGrid.activeTabId
    switchToPicker()
    return true
  }
  // Ctrl+P → focus prev pane
  if (rawSequence === "\x10") { app.directGrid.focusPrev(); return true }

  // Ctrl+O → launch scratch Claude session
  if (rawSequence === "\x0f") { launchScratchSession(); return true }

  // Ctrl+F → open folder
  if (rawSequence === "\x06") {
    const pane = app.directGrid.focusedPane
    if (pane) Bun.spawn(["open", pane.session.projectPath])
    return true
  }

  // Ctrl+W → close pane (remove tab if last pane)
  if (rawSequence === "\x17") {
    const pane = app.directGrid.focusedPane
    if (pane) {
      if (app.directGrid.isExpanded) app.directGrid.collapsePane()
      if (app.directGrid.isSoftExpanded) app.directGrid.softCollapsePane()
      const { killSession } = await import("../pty/session-manager")
      app.directGrid.removePane(pane.session.name)
      await killSession(pane.session.name)
      if (app.directGrid.paneCount === 0) {
        // Remove current tab and switch to previous or picker
        const currentTabId = app.directGrid.activeTabId
        const tabIdx = app.gridTabs.findIndex(t => t.id === currentTabId)
        app.directGrid.removeTab(currentTabId)
        app.gridTabs.splice(tabIdx, 1)
        if (app.gridTabs.length > 0) {
          const prevIdx = Math.max(0, tabIdx - 1)
          switchToGridTab(app.gridTabs[prevIdx]!.id)
        } else {
          switchToPicker()
        }
      }
    }
    return true
  }

  // Page Up/Down → scroll
  if (rawSequence === "\x1b[5~") { app.directGrid.sendScrollToFocused("up"); return true }
  if (rawSequence === "\x1b[6~") { app.directGrid.sendScrollToFocused("down"); return true }

  app.directGrid.sendInputToFocused(rawSequence)
  return true
}

// ─── View switching ──────────────────────────────────────────────────

export function switchToPicker() {
  app.viewMode = "picker"
  app.activeTabIndex = 0
  if (app.directGrid) {
    if (app.directGrid.totalPaneCount > 0) app.directGrid.pause()
  }
  app.renderer.resume()
  process.stdin.removeAllListeners("data")
  process.stdin.on("data", stdinHandler)
  process.stdout.write("\x1b[?1000h")
  process.stdout.write("\x1b[?1006h")
  if (app.mainBox) app.mainBox.visible = true
  updateAll()
  app.renderer.requestRender()
}

// ─── Double-click detection ──────────────────────────────────────────

let _lastClickTime = 0
let _lastClickCol = 0
let _lastClickRow = 0
const DOUBLE_CLICK_MS = 400
const DOUBLE_CLICK_DIST = 2

function isDoubleClick(col: number, row: number): boolean {
  const now = Date.now()
  const dt = now - _lastClickTime
  const dist = Math.abs(col - _lastClickCol) + Math.abs(row - _lastClickRow)
  _lastClickTime = now
  _lastClickCol = col
  _lastClickRow = row
  return dt < DOUBLE_CLICK_MS && dist <= DOUBLE_CLICK_DIST
}

// ─── Stdin: grid mode ────────────────────────────────────────────────

function processGridInput(str: string) {
  const dg = app.directGrid!

  const mouseEvents = extractMouseEvents(str)
  for (const me of mouseEvents) {
    if (me.btn === 64) { dg.sendScrollToFocused("up", 3); continue }
    if (me.btn === 65) { dg.sendScrollToFocused("down", 3); continue }

    // Scrollbar drag motion (btn=32 means motion with left button held)
    if (me.btn === 32 && dg._scrollDrag) {
      const d = dg._scrollDrag
      const offset = dg.scrollbarRowToOffset(d.trackTop, d.trackHeight, d.thumbSize, d.scrollbackLength, me.row)
      scrollToOffset(d.sessionName, offset)
      dg.drawChrome()
      continue
    }

    // Mouse release — end scrollbar drag
    if (me.release && dg._scrollDrag) {
      dg._scrollDrag = null
      continue
    }

    if (me.btn === 0 && !me.release) {
      // Scrollbar click — check before other click handlers
      const sbHit = dg.checkScrollbarClick(me.col, me.row)
      if (sbHit) {
        dg._scrollDrag = {
          sessionName: sbHit.sessionName,
          paneIndex: sbHit.paneIndex,
          trackTop: sbHit.trackTop,
          trackHeight: sbHit.trackHeight,
          thumbSize: sbHit.thumbSize,
          scrollbackLength: sbHit.scrollbackLength,
        }
        const offset = dg.scrollbarRowToOffset(sbHit.trackTop, sbHit.trackHeight, sbHit.thumbSize, sbHit.scrollbackLength, me.row)
        scrollToOffset(sbHit.sessionName, offset)
        dg.setFocus(sbHit.paneIndex)
        dg.drawChrome()
        continue
      }
      // Double-click → enter select mode for native text selection
      if (isDoubleClick(me.col, me.row)) { dg.openInTextEdit(); return }
      const btn = dg.checkButtonClick(me.col, me.row)
      if (btn?.action === "closetab" && btn.tabId !== undefined) {
        const result = dg.requestCloseTab(btn.tabId)
        if (result === "closed") {
          // Tab was closed — switch to adjacent or picker
          if (app.gridTabs.length > 0) {
            const currentTabId = dg.activeTabId
            if (btn.tabId === currentTabId) {
              // Closed the active tab — switch to first available
              switchToGridTab(app.gridTabs[0]!.id)
            } else {
              dg.drawChrome()
            }
          } else {
            switchToPicker()
          }
        }
      }
      else if (btn?.action === "closepane") {
        dg.cancelPendingClose()
        const pane = dg.paneCount > btn.paneIndex ? dg.getTabPanes(dg.activeTabId)[btn.paneIndex] : null
        if (pane) {
          if (dg.isExpanded) dg.collapsePane()
          if (dg.isSoftExpanded) dg.softCollapsePane()
          dg.removePane(pane.session.name)
          if (dg.paneCount === 0) {
            const currentTabId = dg.activeTabId
            const tabIdx = app.gridTabs.findIndex(t => t.id === currentTabId)
            dg.removeTab(currentTabId)
            app.gridTabs.splice(tabIdx, 1)
            if (app.gridTabs.length > 0) {
              const prevIdx = Math.max(0, tabIdx - 1)
              switchToGridTab(app.gridTabs[prevIdx]!.id)
            } else {
              switchToPicker()
            }
          }
        }
      }
      else if (btn?.action === "max") { dg.cancelPendingClose(); dg.expandPane(btn.paneIndex) }
      else if (btn?.action === "min") { dg.cancelPendingClose(); dg.collapsePane() }
      else if (btn?.action === "sel") { dg.cancelPendingClose(); dg.openInTextEdit() }
      else if (btn?.action === "move-left" || btn?.action === "move-right" || btn?.action === "move-up" || btn?.action === "move-down") {
        dg.cancelPendingClose()
        dg.setFocus(btn.paneIndex)
        dg.swapPane(btn.action.slice(5) as "left" | "right" | "up" | "down")
      }
      else if (btn?.action === "newsession") {
        dg.cancelPendingClose()
        const srcPane = dg.getTabPanes(dg.activeTabId)[btn.paneIndex]
        if (srcPane) {
          const tabId = dg.activeTabId
          const termW = process.stdout.columns || 120
          const termH = process.stdout.rows || 40
          const totalPanes = dg.paneCount + 1
          const cols = totalPanes <= 1 ? 1 : totalPanes <= 2 ? 2 : totalPanes <= 4 ? 2 : 3
          const rows = Math.ceil(totalPanes / cols)
          const paneW = Math.max(Math.floor(termW / cols) - 2, 20)
          const paneH = Math.max(Math.floor((termH - 2) / rows) - 4, 6)
          if (dg.isExpanded) dg.collapsePane()
          createSession({
            projectPath: srcPane.session.projectPath,
            projectName: srcPane.session.projectName,
            width: paneW,
            height: paneH,
          }).then(session => dg.addPane(session, tabId))
        }
      }
      else if (btn?.action === "openfolder") {
        dg.cancelPendingClose()
        const p = dg.getTabPanes(dg.activeTabId)[btn.paneIndex]
        if (p) Bun.spawn(["open", p.session.projectPath])
      }
      else if (btn?.action === "tab") {
        dg.cancelPendingClose()
        if (btn.tabId === -1) {
          // Switch to picker
          app.lastGridTabIndex = app.gridTabs.findIndex(t => t.id === dg.activeTabId)
          switchToPicker()
        } else if (btn.tabId !== undefined) {
          switchToGridTab(btn.tabId)
        }
      }
      else if (btn?.action === "newtab") { dg.cancelPendingClose(); createNewGridTab() }
      else if (btn?.action === "scratch") { dg.cancelPendingClose(); launchScratchSession() }
      else if (btn?.action === "panefocus" && btn.tabId !== undefined) {
        dg.cancelPendingClose()
        // Click on pane name in pane list → switch to that tab and focus the pane
        switchToGridTab(btn.tabId)
        dg.setFocus(btn.paneIndex)
        if (app.clickExpand) dg.softExpandPane(btn.paneIndex)
      }
      else {
        dg.cancelPendingClose()
        // Pane body click
        if (app.clickExpand && !dg.isExpanded) {
          const clickedIdx = dg.getPaneIndexAtClick(me.col, me.row)
          if (clickedIdx >= 0 && clickedIdx !== dg.focusIndex) {
            dg.softExpandPane(clickedIdx)
          }
        } else {
          dg.focusByClick(me.col, me.row)
        }
      }
      continue
    }
  }

  let stripped = str
  for (let i = mouseEvents.length - 1; i >= 0; i--) {
    const me = mouseEvents[i]!
    stripped = stripped.slice(0, me.start) + stripped.slice(me.end)
  }

  const keyboard = extractKeyboardInput(stripped)
  if (!keyboard) return
  const dir = SHIFT_ARROWS[keyboard]
  if (dir) dg.focusByDirection(dir)
  else handleGridInput(keyboard)
}

// ─── Stdin: picker mode ──────────────────────────────────────────────

function processPickerInput(str: string) {
  // Quit confirmation intercept
  if (_quitPending) {
    const kb = extractKeyboardInput(str)
    if (kb === "\x0d" || kb === "y" || kb === "Y") { doQuit(); return }
    dismissQuitModal()
    return
  }

  // Ctrl+Q → quit confirmation
  if (str.includes("\x11")) { showQuitConfirm(); return }

  // Ctrl+Space → toggle to last grid tab
  if (str.includes("\x00")) {
    if (app.directGrid && app.directGrid.totalPaneCount > 0) {
      // Switch to last active grid tab
      if (app.gridTabs.length > 0) {
        const idx = Math.min(app.lastGridTabIndex, app.gridTabs.length - 1)
        switchToGridTab(app.gridTabs[Math.max(0, idx)]!.id)
      }
      return
    }
  }

  const pickerMouse = extractMouseEvents(str)
  for (const me of pickerMouse) {
    if (me.btn === 0 && !me.release) {
      if (handlePickerTabBarClick(me.col, me.row)) continue
      handlePickerClick(me.col, me.row)
    }
    if (me.btn === 64) { if (app.cursor > 0) { app.cursor--; updateAll() } }
    if (me.btn === 65) { if (app.cursor < app.displayRows.length - 1) { app.cursor++; updateAll() } }
  }

  const keyboard = extractKeyboardInput(str)
  if (!keyboard) return

  // Check for Alt+digit and Alt+n/p before normal key processing
  let ki = 0
  while (ki < keyboard.length) {
    // Alt sequences
    if (keyboard[ki] === "\x1b" && ki + 1 < keyboard.length) {
      const next = keyboard[ki + 1]!
      if (next >= "1" && next <= "9") {
        handleTabSwitch(parseInt(next))
        ki += 2
        continue
      }
      if (next === "n") { handleNextTab(); ki += 2; continue }
      if (next === "p") { handlePrevTab(); ki += 2; continue }
    }

    let matched = false
    for (let len = Math.min(8, keyboard.length - ki); len >= 1; len--) {
      const mapped = KEY_MAP[keyboard.slice(ki, ki + len)]
      if (mapped) {
        handleKeypress(syntheticKey(mapped.name, mapped.shift, mapped.ctrl))
        ki += len
        matched = true
        break
      }
    }
    if (!matched) {
      const code = keyboard.charCodeAt(ki)
      if (code >= 0x21 && code <= 0x7e) {
        handleKeypress(syntheticKey(keyboard[ki]!))
      }
      ki++
    }
  }
}

// ─── Stdin buffering ─────────────────────────────────────────────────
// SGR mouse sequences (\x1b[<btn;col;rowM) can be split across stdin
// data events. Buffer partial escape sequences so fragments don't leak
// into the PTY as garbage characters.

let _pending = ""
let _timer: ReturnType<typeof setTimeout> | null = null

function dispatch(str: string) {
  if (app.viewMode === "grid" && app.directGrid) processGridInput(str)
  else processPickerInput(str)
}

function flushPending() {
  _timer = null
  if (_pending) {
    const p = _pending
    _pending = ""
    dispatch(p)
  }
}

// Returns index of a trailing partial escape sequence, or -1 if complete.
function trailingPartialEsc(data: string): number {
  for (let i = data.length - 1; i >= 0 && i >= data.length - 30; i--) {
    if (data.charCodeAt(i) !== 0x1b) continue
    const ch = data[i + 1]
    // Lone ESC at end
    if (ch === undefined) return i
    // CSI: \x1b[ — check for final byte
    if (ch === "[") {
      let j = i + 2
      while (j < data.length && data.charCodeAt(j) >= 0x30 && data.charCodeAt(j) <= 0x3f) j++
      while (j < data.length && data.charCodeAt(j) >= 0x20 && data.charCodeAt(j) <= 0x2f) j++
      if (j >= data.length) return i // no final byte yet — partial
      continue
    }
    // OSC/DCS/APC/PM — need ST terminator
    if (ch === "]" || ch === "P" || ch === "_" || ch === "^") {
      let terminated = false
      for (let j = i + 2; j < data.length; j++) {
        if (data[j] === "\x07") { terminated = true; break }
        if (data[j] === "\x1b" && data[j + 1] === "\\") { terminated = true; break }
      }
      if (!terminated) return i
      continue
    }
    // SS3 (\x1bO) needs one more byte
    if (ch === "O" && i + 2 >= data.length) return i
    continue
  }
  return -1
}

// ─── Stdin entry point ───────────────────────────────────────────────

export function stdinHandler(data: string | Buffer) {
  if (_timer) { clearTimeout(_timer); _timer = null }
  const str = typeof data === "string" ? data : data.toString("utf8")
  const full = _pending + str
  _pending = ""

  const idx = trailingPartialEsc(full)
  if (idx >= 0) {
    _pending = full.slice(idx)
    const ready = full.slice(0, idx)
    if (ready) dispatch(ready)
    _timer = setTimeout(flushPending, 8)
    return
  }

  dispatch(full)
}
