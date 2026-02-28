import type { KeyEvent } from "@opentui/core"
import { app } from "../lib/state"
import { updateAll, rebuildDisplayRows, applySortMode } from "../ui/panels"
import { extractKeyboardInput, extractMouseEvents } from "./parser"
import { switchToGrid } from "../grid/view-switch"
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

function toggleRowSelection(row: DisplayRow) {
  const project = app.projects[row.projectIndex]
  if (row.type === "project" || row.type === "new-session") {
    toggleSetItem(app.selectedProjects, project.path)
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

// ─── Picker click ────────────────────────────────────────────────────

export function handlePickerClick(_col: number, screenRow: number) {
  const idx = hitTestListRow(screenRow)
  if (idx < 0 || idx >= app.displayRows.length) return
  app.cursor = idx
  toggleRowSelection(app.displayRows[idx])
  updateAll()
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
      for (const p of app.projects) app.selectedProjects.add(p.path)
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
        if (oRow) app.selectedProjects.add(app.projects[oRow.projectIndex].path)
      }
      if (app.selectedProjects.size > 0 || app.selectedSessions.size > 0) {
        await launchSelections(app.projects, app.selectedProjects, app.selectedSessions, app.selectedBranches)
        app.selectedProjects.clear()
        app.selectedSessions.clear()
        app.selectedBranches.clear()
      }
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

    case "t":
      if (app.directGrid && app.directGrid.paneCount > 0) switchToGrid()
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

  if (rawSequence === "\x1b" && app.directGrid.isExpanded) {
    app.directGrid.collapsePane()
    return true
  }

  if (rawSequence === "\x1e" || rawSequence === "\x1b`" || rawSequence === "\x00") {
    switchToPicker()
    return true
  }

  if (rawSequence === "\x0e") { app.directGrid.focusNext(); return true }
  if (rawSequence === "\x10") { app.directGrid.focusPrev(); return true }

  if (rawSequence === "\x06") {
    const pane = app.directGrid.focusedPane
    if (pane) Bun.spawn(["open", pane.session.projectPath])
    return true
  }

  if (rawSequence === "\x17") {
    const pane = app.directGrid.focusedPane
    if (pane) {
      if (app.directGrid.isExpanded) app.directGrid.collapsePane()
      const { killSession } = await import("../pty/session-manager")
      app.directGrid.removePane(pane.session.name)
      await killSession(pane.session.name)
      if (app.directGrid.paneCount === 0) switchToPicker()
    }
    return true
  }

  if (rawSequence === "\x1b[5~") { app.directGrid.sendScrollToFocused("up"); return true }
  if (rawSequence === "\x1b[6~") { app.directGrid.sendScrollToFocused("down"); return true }

  app.directGrid.sendInputToFocused(rawSequence)
  return true
}

// ─── View switching ──────────────────────────────────────────────────

export function switchToPicker() {
  app.viewMode = "picker"
  if (app.directGrid) {
    if (app.directGrid.selectMode) app.directGrid.exitSelectMode()
    if (app.directGrid.paneCount > 0) app.directGrid.pause()
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
      else dg.focusByClick(me.col, me.row)
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
  // Ctrl+Space → toggle to grid
  if (str.includes("\x00") && app.directGrid && app.directGrid.paneCount > 0) {
    switchToGrid()
    return
  }

  const pickerMouse = extractMouseEvents(str)
  for (const me of pickerMouse) {
    if (me.btn === 0 && !me.release) handlePickerClick(me.col, me.row)
    if (me.btn === 64) { if (app.cursor > 0) { app.cursor--; updateAll() } }
    if (me.btn === 65) { if (app.cursor < app.displayRows.length - 1) { app.cursor++; updateAll() } }
  }

  const keyboard = extractKeyboardInput(str)
  if (!keyboard) return

  let ki = 0
  while (ki < keyboard.length) {
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
