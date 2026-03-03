import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  RGBA,
  t,
  bold,
  dim,
  fg,
} from "@opentui/core"
import { TerminalView, getProjectColor } from "./terminal-view"
import type { TmuxSession } from "../tmux/session-manager"
import { sendKeys, sendMouseEvent } from "../tmux/input-bridge"

export type PaneStatus = "busy" | "idle" | null

export interface GridPane {
  session: TmuxSession
  termView: TerminalView
  borderBox: BoxRenderable
  titleText: TextRenderable
  subtitleText: TextRenderable
  status: PaneStatus
  statusSince: number // Date.now() when status was set
}

function fmtElapsed(sinceMs: number): string {
  if (!sinceMs) return ""
  const sec = Math.floor((Date.now() - sinceMs) / 1000)
  if (sec < 1) return "0s"
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m${s > 0 ? String(s).padStart(2, "0") + "s" : ""}`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h${rm > 0 ? String(rm).padStart(2, "0") + "m" : ""}`
}

export class SessionGrid {
  private renderer: CliRenderer
  private container: BoxRenderable
  private panes: GridPane[] = []
  private _focusIndex = 0
  private flashTimers = new Map<string, ReturnType<typeof setInterval>>()
  private titleTimer: ReturnType<typeof setInterval> | null = null

  constructor(renderer: CliRenderer, container: BoxRenderable) {
    this.renderer = renderer
    this.container = container
    this.titleTimer = setInterval(() => this.refreshTitles(), 1000)
  }

  get focusIndex() { return this._focusIndex }
  get paneCount() { return this.panes.length }
  get focusedPane(): GridPane | null { return this.panes[this._focusIndex] ?? null }

  addSession(session: TmuxSession, subtitle?: ReturnType<typeof t>): GridPane {
    const color = getProjectColor(session.colorIndex)
    const colorRGBA = RGBA.fromHex(color)

    const borderBox = new BoxRenderable(this.renderer, {
      borderStyle: "rounded",
      border: true,
      borderColor: colorRGBA,
      flexGrow: 1,
      flexDirection: "column",
      overflow: "hidden",
    })

    const titleText = new TextRenderable(this.renderer, {
      width: "100%",
      height: 1,
      flexShrink: 0,
    })
    titleText.content = t` ${bold(fg(color)(session.projectName))}${session.sessionId ? dim(` #${session.sessionId.slice(0, 8)}`) : ""}`

    const subtitleText = new TextRenderable(this.renderer, {
      width: "100%",
      height: 1,
      flexShrink: 0,
    })
    if (subtitle) subtitleText.content = subtitle
    else subtitleText.content = t` ${dim("...")}`

    // Calculate pane size (leave room for border + title + subtitle)
    const dims = this.calcPaneDims()
    const termView = new TerminalView(this.renderer, {
      width: Math.max(dims.w - 2, 10),
      height: Math.max(dims.h - 4, 4),
    })

    borderBox.add(titleText)
    borderBox.add(subtitleText)
    borderBox.add(termView)
    this.container.add(borderBox)

    const pane: GridPane = { session, termView, borderBox, titleText, subtitleText, status: null, statusSince: 0 }
    this.panes.push(pane)

    termView.attach(session)
    this.updateLayout()
    this.updateBorders()

    return pane
  }

  removeSession(sessionName: string) {
    const idx = this.panes.findIndex(p => p.session.name === sessionName)
    if (idx < 0) return

    const pane = this.panes[idx]!
    pane.termView.detach()
    this.container.remove(pane.borderBox.id)
    this.panes.splice(idx, 1)

    this.clearFlash(sessionName)

    if (this._focusIndex >= this.panes.length) {
      this._focusIndex = Math.max(0, this.panes.length - 1)
    }

    this.updateLayout()
    this.updateBorders()
  }

  focusNext() {
    if (this.panes.length === 0) return
    this._focusIndex = (this._focusIndex + 1) % this.panes.length
    this.updateBorders()
  }

  focusPrev() {
    if (this.panes.length === 0) return
    this._focusIndex = (this._focusIndex - 1 + this.panes.length) % this.panes.length
    this.updateBorders()
  }

  focusByIndex(index: number) {
    if (index >= 0 && index < this.panes.length) {
      this._focusIndex = index
      this.updateBorders()
    }
  }

  flashFocused() {
    const pane = this.focusedPane
    if (!pane) return
    const flashColor = RGBA.fromHex("#7dcfff")
    pane.borderBox.borderColor = flashColor
    this.renderer.requestRender()
    setTimeout(() => {
      // Restore to heavy white (focused state)
      pane.borderBox.borderColor = RGBA.fromHex("#ffffff")
      this.renderer.requestRender()
    }, 150)
  }

  focusByDirection(dir: "up" | "down" | "left" | "right") {
    const n = this.panes.length
    if (n <= 1) return
    const cols = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 9 ? 3 : 4
    const rows = Math.ceil(n / cols)
    const curCol = this._focusIndex % cols
    const curRow = Math.floor(this._focusIndex / cols)

    let newCol = curCol
    let newRow = curRow
    switch (dir) {
      case "left":  newCol = (curCol - 1 + cols) % cols; break
      case "right": newCol = (curCol + 1) % cols; break
      case "up":    newRow = (curRow - 1 + rows) % rows; break
      case "down":  newRow = (curRow + 1) % rows; break
    }
    const idx = newRow * cols + newCol
    if (idx >= 0 && idx < n) {
      this._focusIndex = idx
      this.updateBorders()
    }
  }

  focusByClick(col: number, row: number): boolean {
    const n = this.panes.length
    if (n === 0) return false
    const termW = process.stdout.columns || 120
    const termH = process.stdout.rows || 40
    const cols = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 9 ? 3 : 4
    const rows = Math.ceil(n / cols)
    const cellW = Math.floor(termW / cols)
    const cellH = Math.floor((termH - 2) / rows) // -2 for header+footer
    const gridCol = Math.floor(col / cellW)
    const gridRow = Math.floor((row - 1) / cellH) // -1 for header line
    const idx = gridRow * cols + gridCol
    if (idx >= 0 && idx < n) {
      this._focusIndex = idx
      this.updateBorders()
      return true
    }
    return false
  }

  sendInputToFocused(rawSequence: string) {
    const pane = this.focusedPane
    if (!pane) return
    sendKeys(pane.session.name, rawSequence)
    pane.termView.nudge()
  }

  // Hit-test: map absolute screen coords to pane index + relative terminal coords
  hitTest(absCol: number, absRow: number): { index: number, relX: number, relY: number } | null {
    const n = this.panes.length
    if (n === 0) return null
    const termW = process.stdout.columns || 120
    const termH = process.stdout.rows || 40
    const gridCols = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 9 ? 3 : 4
    const gridRows = Math.ceil(n / gridCols)
    const cellW = Math.floor(termW / gridCols)
    const cellH = Math.floor((termH - 2) / gridRows)

    // Convert 1-based screen coords to grid cell
    const gc = Math.floor((absCol - 1) / cellW)
    const gr = Math.floor((absRow - 2) / cellH) // row 2 is first grid row (row 1 = header)
    if (gc < 0 || gc >= gridCols || gr < 0 || gr >= gridRows) return null

    const idx = gr * gridCols + gc
    if (idx < 0 || idx >= n) return null

    // Terminal content within cell: after left border(1) + after top border(1)+title(1)+subtitle(1)
    const termStartX = gc * cellW + 2   // 1-based + left border
    const termStartY = 2 + gr * cellH + 3 // header(1) + top border(1) + title(1) + subtitle(1)

    return {
      index: idx,
      relX: absCol - termStartX + 1, // 1-based for tmux
      relY: absRow - termStartY + 1,
    }
  }

  // Forward mouse event to the focused tmux pane with correct relative coordinates
  sendMouseToFocused(absCol: number, absRow: number, btn: number, release: boolean) {
    const pane = this.focusedPane
    if (!pane) return

    const hit = this.hitTest(absCol, absRow)
    if (!hit || hit.index !== this._focusIndex) return
    if (hit.relX < 1 || hit.relY < 1) return
    if (hit.relX > pane.session.width || hit.relY > pane.session.height) return

    sendMouseEvent(pane.session.name, hit.relX, hit.relY, btn, release)
  }

  // Flash a pane's border to draw attention (e.g., when session goes idle)
  startFlash(sessionName: string) {
    if (this.flashTimers.has(sessionName)) return

    const pane = this.panes.find(p => p.session.name === sessionName)
    if (!pane) return

    const color = getProjectColor(pane.session.colorIndex)
    const colorRGBA = RGBA.fromHex(color)
    const flashColor = RGBA.fromHex("#ff9e64") // orange flash
    let on = true

    const timer = setInterval(() => {
      pane.borderBox.borderColor = on ? flashColor : colorRGBA
      on = !on
      this.renderer.requestRender()
    }, 400)

    this.flashTimers.set(sessionName, timer)
  }

  clearFlash(sessionName: string) {
    const timer = this.flashTimers.get(sessionName)
    if (timer) {
      clearInterval(timer)
      this.flashTimers.delete(sessionName)
    }

    const pane = this.panes.find(p => p.session.name === sessionName)
    if (pane) {
      const color = getProjectColor(pane.session.colorIndex)
      pane.borderBox.borderColor = RGBA.fromHex(color)
    }
  }

  // Mark a session as needing user input
  markIdle(sessionName: string) {
    const pane = this.panes.find(p => p.session.name === sessionName)
    if (!pane) return
    if (pane.status !== "idle") {
      pane.status = "idle"
      pane.statusSince = Date.now()
    }
    this.startFlash(sessionName)
    this.renderPaneTitle(pane)
  }

  markBusy(sessionName: string) {
    const pane = this.panes.find(p => p.session.name === sessionName)
    if (!pane) return
    if (pane.status !== "busy") {
      pane.status = "busy"
      pane.statusSince = Date.now()
    }
    this.clearFlash(sessionName)
    this.renderPaneTitle(pane)
  }

  clearMark(sessionName: string) {
    const pane = this.panes.find(p => p.session.name === sessionName)
    if (!pane) return
    pane.status = null
    pane.statusSince = 0
    this.clearFlash(sessionName)
    this.renderPaneTitle(pane)
  }

  private renderPaneTitle(pane: GridPane) {
    const color = getProjectColor(pane.session.colorIndex)
    const name = bold(fg(color)(pane.session.projectName))
    const elapsed = pane.statusSince ? fmtElapsed(pane.statusSince) : ""

    if (pane.status === "idle") {
      pane.titleText.content = t` ${name} ${fg("#e0af68")("IDLE")} ${dim(elapsed)}`
    } else if (pane.status === "busy") {
      pane.titleText.content = t` ${name} ${fg("#9ece6a")("RUNNING")} ${dim(elapsed)}`
    } else {
      pane.titleText.content = t` ${name}${pane.session.sessionId ? dim(` #${pane.session.sessionId.slice(0, 8)}`) : ""}`
    }
    this.renderer.requestRender()
  }

  private refreshTitles() {
    let needsRender = false
    for (const pane of this.panes) {
      if (pane.status && pane.statusSince) {
        this.renderPaneTitle(pane)
        needsRender = true
      }
    }
    if (needsRender) this.renderer.requestRender()
  }

  private updateBorders() {
    for (let i = 0; i < this.panes.length; i++) {
      const pane = this.panes[i]!
      const isFocused = i === this._focusIndex
      const color = getProjectColor(pane.session.colorIndex)

      // Update terminal view focus state (controls poll rate)
      pane.termView.focused = isFocused

      // Focused pane gets brighter border, others get dimmer
      if (isFocused) {
        pane.borderBox.borderColor = RGBA.fromHex("#ffffff")
        pane.borderBox.borderStyle = "heavy"
      } else {
        // Check if flashing — don't override flash timer
        if (!this.flashTimers.has(pane.session.name)) {
          pane.borderBox.borderColor = RGBA.fromHex(color)
        }
        pane.borderBox.borderStyle = "rounded"
      }
    }
    this.renderer.requestRender()
  }

  private updateLayout() {
    const n = this.panes.length
    if (n === 0) return

    // Calculate grid: prefer wider layout
    // 1 pane: full, 2: side by side, 3-4: 2x2, 5-6: 3x2, etc.
    const cols = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 9 ? 3 : 4
    const rows = Math.ceil(n / cols)

    // Set container direction
    this.container.flexDirection = "column"
    this.container.flexWrap = "wrap"

    // For a proper grid, we'd need nested boxes. For now, use flex percentages.
    for (let i = 0; i < n; i++) {
      const pane = this.panes[i]!
      pane.borderBox.width = `${Math.floor(100 / cols)}%`
      pane.borderBox.height = `${Math.floor(100 / rows)}%`
    }

    // Update container to row+wrap for grid
    this.container.flexDirection = "row"
    this.container.flexWrap = "wrap"
  }

  private calcPaneDims() {
    // Rough estimate based on terminal size
    const termW = process.stdout.columns || 120
    const termH = process.stdout.rows || 40
    const n = Math.max(1, this.panes.length + 1) // +1 for the incoming pane
    const cols = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 2 : 3
    const rows = Math.ceil(n / cols)
    return {
      w: Math.floor(termW / cols),
      h: Math.floor((termH - 4) / rows), // -4 for header+footer
    }
  }

  destroyAll() {
    if (this.titleTimer) { clearInterval(this.titleTimer); this.titleTimer = null }
    for (const timer of this.flashTimers.values()) clearInterval(timer)
    this.flashTimers.clear()
    for (const pane of this.panes) {
      pane.termView.detach()
      this.container.remove(pane.borderBox.id)
    }
    this.panes = []
    this._focusIndex = 0
  }
}
