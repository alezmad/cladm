import type { KeyEvent } from "@opentui/core"
import { app } from "../lib/state"
import { updateAll, rebuildDisplayRows, applySortMode, updateTabBar } from "../ui/panels"
import { extractKeyboardInput, extractMouseEvents } from "./parser"
import { switchToGrid, switchToGridTab, createNewGridTab } from "../grid/view-switch"
import { doLaunch } from "../actions/launch"
import { launchSelections } from "../actions/launcher"
import { loadSessions } from "../data/sessions"
import { loadBranches } from "../data/git"
import { generateMockSessions, generateMockBranches } from "../data/mock"
import { focusTerminalByPath, populateMockSessionStatus } from "../data/monitor"
import { stopAllCaptures } from "../pty/capture"
import type { DisplayRow } from "../lib/types"

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
  const project = app.projects[row.projectIndex]
  if (row.type === "project" || row.type === "new-session") {
    // Cycle tab number: none → 1 → 2 → ... → 9 → none
    const current = app.selectedProjects.get(project.path)
    if (current === undefined) {
      app.selectedProjects.set(project.path, 1)
    } else if (current < MAX_TAB_NUM) {
      app.selectedProjects.set(project.path, current + 1)
    } else {
      app.selectedProjects.delete(project.path)
    }
  } else if (row.type === "session") {
    toggleSetItem(app.selectedSessions, project.sessions![row.sessionIndex!].id)
  } else if (row.type === "branch") {
    if (app.selectedBranches.get(project.path) === row.branchName) {
      app.selectedBranches.delete(project.path)
    } else {
      app.selectedBranches.set(project.path, row.branchName!)
    }
  }
}

function assignTabNumber(row: DisplayRow, tabNum: number) {
  const project = app.projects[row.projectIndex]
  if (row.type === "project" || row.type === "new-session") {
    const current = app.selectedProjects.get(project.path)
    if (current === tabNum) {
      app.selectedProjects.delete(project.path)  // toggle off if same number
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
  app.projects[projectIndex].expanded = false
  rebuildDisplayRows()
  const target = app.displayRows.findIndex(
    (r) => r.type === "project" && r.projectIndex === projectIndex
  )
  app.cursor = target >= 0 ? target : 0
  if (app.cursor >= app.displayRows.length) app.cursor = app.displayRows.length - 1
}

// ─── Expand ──────────────────────────────────────────────────────────

export async function expandProject(projectIndex: number) {
  const project = app.projects[projectIndex]
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
    const h = app.displayRows[i].type === "session" ? 3 : 1
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
    switchToGridTab(app.gridTabs[tabIndex].id)
  }
}

function handleNextTab() {
  if (app.gridTabs.length === 0) return
  if (app.viewMode === "picker") {
    switchToGridTab(app.gridTabs[0].id)
    return
  }
  const currentIdx = app.gridTabs.findIndex(t => t.id === app.directGrid?.activeTabId)
  if (currentIdx < app.gridTabs.length - 1) {
    switchToGridTab(app.gridTabs[currentIdx + 1].id)
  } else {
    switchToPicker() // wrap around to picker
  }
}

function handlePrevTab() {
  if (app.gridTabs.length === 0) return
  if (app.viewMode === "picker") {
    switchToGridTab(app.gridTabs[app.gridTabs.length - 1].id)
    return
  }
  const currentIdx = app.gridTabs.findIndex(t => t.id === app.directGrid?.activeTabId)
  if (currentIdx > 0) {
    switchToGridTab(app.gridTabs[currentIdx - 1].id)
  } else {
    switchToPicker() // wrap to picker
  }
}

// ─── Picker click ────────────────────────────────────────────────────

export function handlePickerClick(_col: number, screenRow: number) {
  const idx = hitTestListRow(screenRow)
  if (idx < 0 || idx >= app.displayRows.length) return
  app.cursor = idx
  toggleRowSelection(app.displayRows[idx])
  updateAll()
}

// ─── Picker tab bar click ────────────────────────────────────────────

function handlePickerTabBarClick(col: number, screenRow: number) {
  // Tab bar is at row 1 in picker (rendered as OpenTUI text)
  if (screenRow !== 1) return false
  // Hit test against tab bar positions (approximate, since OpenTUI renders it)
  // We compute positions similar to the grid tab bar
  let c = 2
  // Picker tab
  const pickerEnd = c + 7
  if (col >= c && col <= pickerEnd) return false // already on picker
  c += 11

  for (const tab of app.gridTabs) {
    const count = app.directGrid?.getTabPaneCount(tab.id) ?? 0
    const label = `${tab.name} (${count})`
    const visLen = 2 + label.length
    if (col >= c && col < c + visLen) {
      switchToGridTab(tab.id)
      return true
    }
    c += visLen + 3
  }

  // [+] button
  if (col >= c && col <= c + 2) {
    createNewGridTab()
    return true
  }

  return false
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
      const row = app.displayRows[app.cursor]
      if (row.type === "project" && !app.projects[row.projectIndex].expanded) {
        expandProject(row.projectIndex)
        return
      }
      return
    }

    case "left":
      collapseProject(app.displayRows[app.cursor].projectIndex)
      break

    case "space":
      toggleRowSelection(app.displayRows[app.cursor])
      break

    case "f": {
      const project = app.projects[app.displayRows[app.cursor].projectIndex]
      Bun.spawn(["open", project.path])
      break
    }

    case "g": {
      const row = app.displayRows[app.cursor]
      const project = app.projects[row.projectIndex]
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
        doLaunch()
        break
      }
      if (app.bottomPanelMode === "idle" && app.cachedIdleSessions.length > 0 && app.idleCursor < app.cachedIdleSessions.length) {
        if (await focusTerminalByPath(app.cachedIdleSessions[app.idleCursor].projectPath)) return
      }
      const returnRow = app.displayRows[app.cursor]
      if (returnRow.type === "project" && app.projects[returnRow.projectIndex].activeSessions > 0) {
        if (await focusTerminalByPath(app.projects[returnRow.projectIndex].path)) return
      }
      doLaunch()
      break
    }

    case "o": {
      if (app.selectedProjects.size === 0 && app.selectedSessions.size === 0) {
        const oRow = app.displayRows[app.cursor]
        if (oRow) app.selectedProjects.set(app.projects[oRow.projectIndex].path, 1)
      }
      if (app.selectedProjects.size > 0 || app.selectedSessions.size > 0) {
        await launchSelections(app.projects, app.selectedProjects, app.selectedSessions, app.selectedBranches)
        app.selectedProjects.clear()
        app.selectedSessions.clear()
        app.selectedBranches.clear()
      }
      break
    }

    case "1": case "2": case "3": case "4": case "5":
    case "6": case "7": case "8": case "9": {
      const row = app.displayRows[app.cursor]
      assignTabNumber(row, parseInt(key.name))
      break
    }

    case "q":
    case "escape":
      app.destroyed = true
      if (app.monitorInterval) clearInterval(app.monitorInterval)
      stopAllCaptures()
      process.stdout.write("\x1b[?1006l")
      process.stdout.write("\x1b[?1000l")
      app.renderer.destroy()
      return

    default:
      return
  }

  updateAll()
  } catch {}
}

// ─── Grid input ──────────────────────────────────────────────────────

export async function handleGridInput(rawSequence: string): Promise<boolean> {
  if (app.viewMode !== "grid" || !app.directGrid) return false

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

  // Ctrl+E → toggle click-to-expand
  if (rawSequence === "\x05") {
    app.clickExpand = !app.clickExpand
    if (!app.clickExpand && app.directGrid.isSoftExpanded) app.directGrid.softCollapsePane()
    app.directGrid.drawChrome()
    return true
  }

  // Alt+1 through Alt+9 → switch tab
  if (rawSequence.length === 2 && rawSequence[0] === "\x1b" && rawSequence[1] >= "1" && rawSequence[1] <= "9") {
    handleTabSwitch(parseInt(rawSequence[1]))
    return true
  }

  // Alt+n → next tab, Alt+p → prev tab
  if (rawSequence === "\x1bn") { handleNextTab(); return true }
  if (rawSequence === "\x1bp") { handlePrevTab(); return true }

  // Ctrl+N / Ctrl+P → focus next/prev pane
  if (rawSequence === "\x0e") { app.directGrid.focusNext(); return true }
  if (rawSequence === "\x10") { app.directGrid.focusPrev(); return true }

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
          switchToGridTab(app.gridTabs[prevIdx].id)
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
    if (app.directGrid.selectMode) app.directGrid.exitSelectMode()
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

// ─── Stdin: grid mode ────────────────────────────────────────────────

function processGridInput(str: string) {
  const dg = app.directGrid!

  if (dg.selectMode) {
    if (extractKeyboardInput(str) === "\x1b") dg.exitSelectMode()
    return
  }

  const mouseEvents = extractMouseEvents(str)
  for (const me of mouseEvents) {
    if (me.btn === 64) { dg.sendScrollToFocused("up", 3); continue }
    if (me.btn === 65) { dg.sendScrollToFocused("down", 3); continue }
    if (me.btn === 0 && !me.release) {
      const btn = dg.checkButtonClick(me.col, me.row)
      if (btn?.action === "max") dg.expandPane(btn.paneIndex)
      else if (btn?.action === "min") dg.collapsePane()
      else if (btn?.action === "sel") dg.enterSelectMode()
      else if (btn?.action === "tab") {
        if (btn.tabId === -1) {
          // Switch to picker
          app.lastGridTabIndex = app.gridTabs.findIndex(t => t.id === dg.activeTabId)
          switchToPicker()
        } else if (btn.tabId !== undefined) {
          switchToGridTab(btn.tabId)
        }
      }
      else if (btn?.action === "newtab") createNewGridTab()
      else if (btn?.action === "panefocus" && btn.tabId !== undefined) {
        // Click on pane name in pane list → switch to that tab and focus the pane
        switchToGridTab(btn.tabId)
        dg.setFocus(btn.paneIndex)
        if (app.clickExpand) dg.softExpandPane(btn.paneIndex)
      }
      else {
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
    const me = mouseEvents[i]
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
  // Ctrl+Space → toggle to last grid tab
  if (str.includes("\x00")) {
    if (app.directGrid && app.directGrid.totalPaneCount > 0) {
      // Switch to last active grid tab
      if (app.gridTabs.length > 0) {
        const idx = Math.min(app.lastGridTabIndex, app.gridTabs.length - 1)
        switchToGridTab(app.gridTabs[Math.max(0, idx)].id)
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
      const next = keyboard[ki + 1]
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
        handleKeypress(syntheticKey(keyboard[ki]))
      }
      ki++
    }
  }
}

// ─── Stdin entry point ───────────────────────────────────────────────

export function stdinHandler(data: string | Buffer) {
  const str = typeof data === "string" ? data : data.toString("utf8")
  if (app.viewMode === "grid" && app.directGrid) processGridInput(str)
  else processPickerInput(str)
}
