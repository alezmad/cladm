// Direct grid renderer: bypasses OpenTUI entirely for grid mode.
// Draws chrome (borders/titles) and pane content using raw ANSI cursor-addressed writes.
// Each pane renders independently via PTY capture push callbacks.

import { DirectPane } from "./direct-pane"
import { startCapture, stopCapture, resizeCapture, resetHash, getLatestFrame, scrollPane, getScrollOffset } from "../pty/capture"
import { writeToSession, resizeSession, killSession, type PtySession } from "../pty/session-manager"

export type PaneStatus = "busy" | "idle" | null

export interface GridPaneInfo {
  session: PtySession
  directPane: DirectPane
  status: PaneStatus
  statusSince: number
}

const PROJECT_COLORS = [
  "#7aa2f7", "#9ece6a", "#e0af68", "#f7768e", "#bb9af7",
  "#7dcfff", "#ff9e64", "#c0caf5", "#73daca", "#b4f9f8",
]

function getColor(idx: number): string {
  return PROJECT_COLORS[idx % PROJECT_COLORS.length]!
}

function hexFg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `\x1b[38;2;${r};${g};${b}m`
}

const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const WHITE = "\x1b[38;2;255;255;255m"
const HIDE_CURSOR = "\x1b[?25l"
const SHOW_CURSOR = "\x1b[?25h"
const SYNC_START = "\x1b[?2026h"
const SYNC_END = "\x1b[?2026l"
const CLEAR = "\x1b[2J\x1b[H"

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

export class DirectGridRenderer {
  private panes: GridPaneInfo[] = []
  private _focusIndex = 0
  private writeRaw: (s: string) => boolean
  private flashTimers = new Map<string, ReturnType<typeof setInterval>>()
  private titleTimer: ReturnType<typeof setInterval> | null = null
  private running = false
  private _selectMode = false
  private _expandedIndex = -1  // -1 = grid view, >=0 = expanded pane index

  constructor(rawWrite: (s: string) => boolean) {
    this.writeRaw = rawWrite
  }

  // ─── Lifecycle ─────────────────────────────────────────

  start() {
    this.running = true
    this.writeRaw(HIDE_CURSOR + CLEAR)
    this.drawChrome()
    this.titleTimer = setInterval(() => this.refreshTitles(), 1000)
  }

  stop() {
    this.running = false
    if (this.titleTimer) { clearInterval(this.titleTimer); this.titleTimer = null }
    for (const timer of this.flashTimers.values()) clearInterval(timer)
    this.flashTimers.clear()
    for (const p of this.panes) {
      p.directPane.detach()
      stopCapture(p.session.name)
    }
    this.writeRaw(SHOW_CURSOR)
  }

  pause() {
    this.running = false
    if (this.titleTimer) { clearInterval(this.titleTimer); this.titleTimer = null }
    // Detach frame listeners (stops rendering) but keep captures alive
    for (const p of this.panes) p.directPane.detach()
  }

  resume() {
    this.running = true
    this.writeRaw(HIDE_CURSOR + CLEAR)
    // Reattach frame listeners and redraw
    for (let i = 0; i < this.panes.length; i++) {
      const p = this.panes[i]
      const dp = p.directPane
      const idx = i
      dp.attach(p.session.name)
      dp.onFrame = (lines) => {
        if (!this.running) return
        this.drawPane(idx, lines)
      }
    }
    this.repositionAll()
    this.titleTimer = setInterval(() => this.refreshTitles(), 1000)
  }

  // ─── Getters ───────────────────────────────────────────

  get focusIndex() { return this._focusIndex }
  get paneCount() { return this.panes.length }
  get focusedPane(): GridPaneInfo | null { return this.panes[this._focusIndex] ?? null }
  get selectMode() { return this._selectMode }
  get isExpanded() { return this._expandedIndex >= 0 }

  enterSelectMode() {
    if (!this.isExpanded) return // Only allow in expanded mode
    this._selectMode = true
    this.writeRaw("\x1b[?1000l\x1b[?1006l") // Disable mouse reporting
    this.writeRaw(SHOW_CURSOR)
    this.drawChrome()
  }

  exitSelectMode() {
    this._selectMode = false
    this.writeRaw("\x1b[?1000h\x1b[?1006h") // Re-enable mouse reporting
    this.writeRaw(HIDE_CURSOR)
    this.drawChrome()
  }

  expandPane(index?: number) {
    const idx = index ?? this._focusIndex
    if (idx < 0 || idx >= this.panes.length) return
    this._expandedIndex = idx
    this._focusIndex = idx
    this.repositionAll()
  }

  collapsePane() {
    if (this._selectMode) this.exitSelectMode()
    this._expandedIndex = -1
    this.repositionAll()
  }

  // Check if a click hit a button on the top border. Returns action + pane index.
  checkButtonClick(col: number, row: number): { action: "max" | "min" | "sel", paneIndex: number } | null {
    const indicesToCheck = this.isExpanded ? [this._expandedIndex] : this.panes.map((_, i) => i)
    for (const i of indicesToCheck) {
      const dp = this.panes[i]!.directPane
      const bx = dp.screenX - 1
      const by = dp.screenY - 3
      const bw = dp.width + 2
      const btnRow = by

      if (row !== btnRow) continue

      if (this.isExpanded) {
        // Expanded: buttons are [SEL] and [MIN] at top-right
        // Layout: ...hz [SEL] hz [MIN] hz tr
        const minRight = bx + bw - 2
        const minLeft = minRight - 4
        if (col >= minLeft && col <= minRight) return { action: "min", paneIndex: i }
        const selRight = minLeft - 2
        const selLeft = selRight - 4
        if (col >= selLeft && col <= selRight) return { action: "sel", paneIndex: i }
      } else {
        // Grid: button is [MAX] at top-right
        const btnLeft = bx + bw - 7
        const btnRight = bx + bw - 3
        if (col >= btnLeft && col <= btnRight) return { action: "max", paneIndex: i }
      }
    }
    return null
  }

  // ─── Pane management ───────────────────────────────────

  async addPane(session: PtySession): Promise<GridPaneInfo> {
    const regions = this.calcPaneRegions(this.panes.length + 1)
    const idx = this.panes.length
    const region = regions[idx]!

    const dp = new DirectPane(region.screenX, region.screenY, region.contentW, region.contentH)
    const info: GridPaneInfo = { session, directPane: dp, status: null, statusSince: 0 }
    this.panes.push(info)

    // Resize PTY to match content area
    resizeSession(session.name, region.contentW, region.contentH)

    // Start capture (reads PTY stdout and pushes frames)
    startCapture(session)

    // Subscribe to push frames (must set callback AFTER attach, since attach calls detach which nulls onFrame)
    dp.attach(session.name)
    dp.onFrame = (lines) => {
      if (!this.running) return
      this.drawPane(idx, lines)
    }

    // Reposition all existing panes
    this.repositionAll()

    return info
  }

  removePane(sessionName: string) {
    const idx = this.panes.findIndex(p => p.session.name === sessionName)
    if (idx < 0) return

    const pane = this.panes[idx]!
    pane.directPane.detach()
    stopCapture(pane.session.name)
    killSession(pane.session.name)
    this.clearFlash(sessionName)
    this.panes.splice(idx, 1)

    if (this._focusIndex >= this.panes.length) {
      this._focusIndex = Math.max(0, this.panes.length - 1)
    }

    this.repositionAll()
  }

  // ─── Focus ─────────────────────────────────────────────

  setFocus(index: number) {
    if (index < 0 || index >= this.panes.length) return
    this._focusIndex = index
    this.drawChrome()
  }

  focusNext() {
    if (this.panes.length === 0) return
    this.setFocus((this._focusIndex + 1) % this.panes.length)
  }

  focusPrev() {
    if (this.panes.length === 0) return
    this.setFocus((this._focusIndex - 1 + this.panes.length) % this.panes.length)
  }

  focusByDirection(dir: "up" | "down" | "left" | "right") {
    const n = this.panes.length
    if (n <= 1) return
    const { cols } = this.calcGrid(n)
    const rows = Math.ceil(n / cols)
    const curCol = this._focusIndex % cols
    const curRow = Math.floor(this._focusIndex / cols)
    let nc = curCol, nr = curRow
    switch (dir) {
      case "left":  nc = (curCol - 1 + cols) % cols; break
      case "right": nc = (curCol + 1) % cols; break
      case "up":    nr = (curRow - 1 + rows) % rows; break
      case "down":  nr = (curRow + 1) % rows; break
    }
    const idx = nr * cols + nc
    if (idx >= 0 && idx < n) this.setFocus(idx)
  }

  focusByClick(col: number, row: number): boolean {
    const n = this.panes.length
    if (n === 0) return false
    const termW = process.stdout.columns || 120
    const termH = process.stdout.rows || 40
    const { cols } = this.calcGrid(n)
    const rows = Math.ceil(n / cols)
    const cellW = Math.floor(termW / cols)
    const cellH = Math.floor((termH - 2) / rows)
    const gc = Math.floor((col - 1) / cellW)
    const gr = Math.floor((row - 2) / cellH)
    const idx = gr * cols + gc
    if (idx >= 0 && idx < n) {
      this.setFocus(idx)
      return true
    }
    return false
  }

  // ─── Chrome ────────────────────────────────────────────

  drawChrome() {
    if (!this.running) return
    const termW = process.stdout.columns || 120
    const termH = process.stdout.rows || 40

    let out = SYNC_START

    // Header (row 1)
    const n = this.panes.length
    const fi = this._focusIndex + 1
    let headerLeft: string, headerRight: string
    if (this._selectMode) {
      headerLeft = `  ${BOLD}cladm grid${RESET} — ${hexFg("#9ece6a")}${BOLD}SELECT MODE${RESET}`
      headerRight = `${DIM}drag to select │ cmd+c copy │ ${BOLD}Esc${RESET}${DIM} exit select${RESET}`
    } else if (this.isExpanded) {
      headerLeft = `  ${BOLD}cladm grid${RESET} — ${hexFg("#7dcfff")}${BOLD}EXPANDED${RESET} │ ${fi}/${n}`
      headerRight = `${DIM}click ${BOLD}[SEL]${RESET}${DIM} select text │ click ${BOLD}[MIN]${RESET}${DIM} restore │ ctrl+\` picker${RESET}`
    } else {
      headerLeft = `  ${BOLD}cladm grid${RESET} — ${n} sessions │ focus: ${fi}/${n}`
      headerRight = `${DIM}shift+arrows nav │ scroll/pgup/dn │ click ${BOLD}[MAX]${RESET}${DIM} expand │ ctrl+\` picker │ ctrl+w close${RESET}`
    }
    out += `\x1b[1;1H\x1b[${termW}X${headerLeft}   ${headerRight}`

    // Pane borders + titles
    if (this.isExpanded) {
      out += this.drawPaneBorder(this._expandedIndex)
    } else {
      for (let i = 0; i < this.panes.length; i++) {
        out += this.drawPaneBorder(i)
      }
    }

    // Footer (last row)
    const pane = this.focusedPane
    if (this._selectMode) {
      out += `\x1b[${termH};1H\x1b[${termW}X  ${hexFg("#9ece6a")}${BOLD}SELECT MODE${RESET}  ${DIM}drag to select text │ cmd+c to copy │ press ${BOLD}Esc${RESET}${DIM} to exit${RESET}`
    } else if (this.isExpanded && pane) {
      const color = getColor(pane.session.colorIndex)
      out += `\x1b[${termH};1H\x1b[${termW}X  ${hexFg(color)}▸${RESET} ${BOLD}${pane.session.projectName}${RESET}   ${DIM}expanded │ Esc or [MIN] to restore grid${RESET}`
    } else if (pane) {
      const color = getColor(pane.session.colorIndex)
      const sid = pane.session.sessionId ? ` ${DIM}#${pane.session.sessionId.slice(0, 8)}${RESET}` : ""
      out += `\x1b[${termH};1H\x1b[${termW}X  ${hexFg(color)}▸${RESET} ${BOLD}${pane.session.projectName}${RESET}${sid}   ${DIM}all input goes to focused pane${RESET}`
    } else {
      out += `\x1b[${termH};1H\x1b[${termW}X  ${DIM}No sessions. Press ctrl+\` to return to picker.${RESET}`
    }

    out += SYNC_END
    this.writeRaw(out)
  }

  private drawPaneBorder(index: number): string {
    const pane = this.panes[index]!
    const dp = pane.directPane
    const isFocused = index === this._focusIndex
    const isFlashing = this.flashTimers.has(pane.session.name)

    const color = getColor(pane.session.colorIndex)
    let borderColor: string
    if (isFocused) borderColor = WHITE
    else if (isFlashing) borderColor = hexFg("#ff9e64")
    else borderColor = hexFg(color)

    const tl = isFocused ? "┏" : "╭"
    const tr = isFocused ? "┓" : "╮"
    const bl = isFocused ? "┗" : "╰"
    const br = isFocused ? "┛" : "╯"
    const hz = isFocused ? "━" : "─"
    const vt = isFocused ? "┃" : "│"

    const bx = dp.screenX - 1
    const by = dp.screenY - 3
    const bw = dp.width + 2
    const bh = dp.height + 4

    let out = ""

    // Top border with buttons
    let btnSection: string
    let btnVisibleLen: number
    if (this.isExpanded) {
      // Expanded: [SEL] [MIN] at right
      const selColor = this._selectMode ? `${hexFg("#9ece6a")}${BOLD}` : `${DIM}`
      btnSection = `${RESET}${selColor}[SEL]${RESET}${borderColor}${hz}${RESET}${hexFg("#7dcfff")}[MIN]${RESET}${borderColor}`
      btnVisibleLen = 5 + 1 + 5  // [SEL] + hz + [MIN]
    } else {
      // Grid: [MAX] at right
      btnSection = `${RESET}${DIM}[MAX]${RESET}${borderColor}`
      btnVisibleLen = 5  // [MAX]
    }
    const hzFill = Math.max(0, bw - 2 - btnVisibleLen - 1) // -2 corners, -1 trailing hz
    out += `\x1b[${by};${bx}H${borderColor}${tl}${hz.repeat(hzFill)}${btnSection}${hz}${tr}${RESET}`

    // Title row
    const nameColor = hexFg(color)
    const name = pane.session.projectName
    const elapsed = pane.statusSince ? fmtElapsed(pane.statusSince) : ""
    const scrollOff = getScrollOffset(pane.session.name)
    const scrollTag = scrollOff > 0 ? ` ${hexFg("#ff9e64")}[SCROLL +${scrollOff}]${RESET}` : ""
    let titleContent: string
    if (pane.status === "idle") {
      titleContent = ` ${nameColor}${BOLD}${name}${RESET} ${hexFg("#e0af68")}IDLE${RESET} ${DIM}${elapsed}${RESET}${scrollTag}`
    } else if (pane.status === "busy") {
      titleContent = ` ${nameColor}${BOLD}${name}${RESET} ${hexFg("#9ece6a")}RUNNING${RESET} ${DIM}${elapsed}${RESET}${scrollTag}`
    } else {
      const sid = pane.session.sessionId ? ` ${DIM}#${pane.session.sessionId.slice(0, 8)}${RESET}` : ""
      titleContent = ` ${nameColor}${BOLD}${name}${RESET}${sid}${scrollTag}`
    }
    out += `\x1b[${by + 1};${bx}H${borderColor}${vt}${RESET}\x1b[${bw - 2}X${titleContent}`
    out += `\x1b[${by + 1};${bx + bw - 1}H${borderColor}${vt}${RESET}`

    // Subtitle row
    out += `\x1b[${by + 2};${bx}H${borderColor}${vt}${RESET}\x1b[${bw - 2}X ${DIM}${pane.session.projectPath}${RESET}`
    out += `\x1b[${by + 2};${bx + bw - 1}H${borderColor}${vt}${RESET}`

    // Side borders for content rows
    for (let r = 0; r < dp.height; r++) {
      out += `\x1b[${dp.screenY + r};${bx}H${borderColor}${vt}${RESET}`
      out += `\x1b[${dp.screenY + r};${bx + bw - 1}H${borderColor}${vt}${RESET}`
    }

    // Bottom border
    out += `\x1b[${by + bh - 1};${bx}H${borderColor}${bl}${hz.repeat(bw - 2)}${br}${RESET}`

    return out
  }

  // ─── Content rendering ─────────────────────────────────

  private drawPane(index: number, lines: string[]) {
    // In expanded mode, only draw the expanded pane
    if (this.isExpanded && index !== this._expandedIndex) return
    const pane = this.panes[index]
    if (!pane) return
    const frame = pane.directPane.buildFrame(lines)
    this.writeRaw(SYNC_START + frame + SYNC_END)
  }

  // ─── Input ─────────────────────────────────────────────

  sendInputToFocused(rawSequence: string) {
    const pane = this.focusedPane
    if (!pane) return
    // Reset scroll offset when user types (back to live view)
    const offset = getScrollOffset(pane.session.name)
    if (offset > 0) {
      scrollPane(pane.session.name, "down", offset)
      this.drawChrome()
    }
    writeToSession(pane.session.name, rawSequence)
  }

  sendScrollToFocused(direction: "up" | "down", lines = 5) {
    const pane = this.focusedPane
    if (!pane) return
    const offset = scrollPane(pane.session.name, direction, lines)
    // Update title to show scroll indicator
    this.drawChrome()
  }

  // ─── Status ────────────────────────────────────────────

  markIdle(sessionName: string) {
    const pane = this.panes.find(p => p.session.name === sessionName)
    if (!pane) return
    if (pane.status !== "idle") { pane.status = "idle"; pane.statusSince = Date.now() }
    this.startFlash(sessionName)
    this.drawChrome()
  }

  markBusy(sessionName: string) {
    const pane = this.panes.find(p => p.session.name === sessionName)
    if (!pane) return
    if (pane.status !== "busy") { pane.status = "busy"; pane.statusSince = Date.now() }
    this.clearFlash(sessionName)
    this.drawChrome()
  }

  clearMark(sessionName: string) {
    const pane = this.panes.find(p => p.session.name === sessionName)
    if (!pane) return
    pane.status = null; pane.statusSince = 0
    this.clearFlash(sessionName)
    this.drawChrome()
  }

  startFlash(sessionName: string) {
    if (this.flashTimers.has(sessionName)) return
    const timer = setInterval(() => this.drawChrome(), 400)
    this.flashTimers.set(sessionName, timer)
  }

  clearFlash(sessionName: string) {
    const timer = this.flashTimers.get(sessionName)
    if (timer) { clearInterval(timer); this.flashTimers.delete(sessionName) }
  }

  // ─── Layout ────────────────────────────────────────────

  private calcGrid(n?: number): { cols: number, rows: number } {
    const count = n ?? this.panes.length
    const cols = count <= 1 ? 1 : count <= 2 ? 2 : count <= 4 ? 2 : count <= 6 ? 3 : count <= 9 ? 3 : 4
    return { cols, rows: Math.ceil(count / cols) }
  }

  private calcPaneRegions(count?: number): { screenX: number, screenY: number, contentW: number, contentH: number }[] {
    const n = count ?? this.panes.length
    const termW = process.stdout.columns || 120
    const termH = process.stdout.rows || 40
    const { cols, rows } = this.calcGrid(n)
    const cellW = Math.floor(termW / cols)
    const cellH = Math.floor((termH - 2) / rows)

    const regions: { screenX: number, screenY: number, contentW: number, contentH: number }[] = []
    for (let i = 0; i < n; i++) {
      const gc = i % cols
      const gr = Math.floor(i / cols)
      const contentW = cellW - 2
      const contentH = cellH - 4
      const screenX = gc * cellW + 2
      const screenY = 2 + gr * cellH + 3
      regions.push({
        screenX,
        screenY,
        contentW: Math.max(contentW, 10),
        contentH: Math.max(contentH, 2),
      })
    }
    return regions
  }

  repositionAll() {
    if (this.isExpanded) {
      // Expanded: give the expanded pane full screen area
      const termW = process.stdout.columns || 120
      const termH = process.stdout.rows || 40
      const contentW = termW - 2
      const contentH = termH - 2 - 4  // -2 header/footer, -4 border chrome
      const pane = this.panes[this._expandedIndex]!
      pane.directPane.reposition(2, 5, Math.max(contentW, 10), Math.max(contentH, 2))
      resizeSession(pane.session.name, Math.max(contentW, 10), Math.max(contentH, 2))
      resizeCapture(pane.session.name, Math.max(contentW, 10), Math.max(contentH, 2))
      resetHash(`dp_${pane.session.name}`)
    } else {
      const regions = this.calcPaneRegions()
      for (let i = 0; i < this.panes.length; i++) {
        const pane = this.panes[i]!
        const region = regions[i]!
        pane.directPane.reposition(region.screenX, region.screenY, region.contentW, region.contentH)
        resizeSession(pane.session.name, region.contentW, region.contentH)
        resizeCapture(pane.session.name, region.contentW, region.contentH)
        resetHash(`dp_${pane.session.name}`)
      }
    }
    if (this.running) {
      this.writeRaw(CLEAR)
      this.drawChrome()
    }
  }

  private refreshTitles() {
    let needsDraw = false
    for (const pane of this.panes) {
      if (pane.status && pane.statusSince) needsDraw = true
    }
    if (needsDraw) this.drawChrome()
  }

  destroyAll() {
    this.stop()
    this.panes = []
    this._focusIndex = 0
  }
}
