// PTY capture: reads raw ANSI output from pty-helper stdout,
// maintains a virtual screen buffer, and pushes frame updates to subscribers.
// Replaces tmux capture-pane — no screen-scraping, direct PTY output.

import type { PtySession } from "./session-manager"

export interface CaptureResult {
  lines: string[]
  cursorX: number
  cursorY: number
  width: number
  height: number
}

type FrameCallback = (frame: CaptureResult) => void

interface PaneState {
  session: PtySession
  screen: VtScreen
  callbacks: Set<FrameCallback>
  reader: ReadableStreamDefaultReader<Uint8Array> | null
  running: boolean
}

const panes = new Map<string, PaneState>()

// ─── VT Screen Buffer ─────────────────────────────────────────

interface VtCell {
  char: string
  sgr: string  // accumulated SGR state as ANSI escape string
}

class VtScreen {
  width: number
  height: number
  cursorX = 0
  cursorY = 0
  cells: VtCell[][]
  scrollback: VtCell[][] = []  // lines that scrolled off the top
  scrollOffset = 0             // 0 = live view, >0 = scrolled back N lines
  private static MAX_SCROLLBACK = 5000
  private currentSgr = ""
  private savedCursorX = 0
  private savedCursorY = 0
  private scrollTop = 0
  private scrollBottom: number
  private altScreen: VtCell[][] | null = null
  private altCursorX = 0
  private altCursorY = 0

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.scrollBottom = height - 1
    this.cells = this.makeGrid(width, height)
  }

  private makeGrid(w: number, h: number): VtCell[][] {
    return Array.from({ length: h }, () =>
      Array.from({ length: w }, () => ({ char: " ", sgr: "" }))
    )
  }

  resize(width: number, height: number) {
    const newCells = this.makeGrid(width, height)
    for (let r = 0; r < Math.min(height, this.height); r++) {
      for (let c = 0; c < Math.min(width, this.width); c++) {
        newCells[r][c] = this.cells[r]?.[c] ?? { char: " ", sgr: "" }
      }
    }
    this.cells = newCells
    this.width = width
    this.height = height
    this.scrollTop = 0
    this.scrollBottom = height - 1
    if (this.cursorX >= width) this.cursorX = width - 1
    if (this.cursorY >= height) this.cursorY = height - 1
  }

  // Write raw PTY output to the virtual screen
  write(data: string) {
    let i = 0
    while (i < data.length) {
      const c = data.charCodeAt(i)

      // ESC sequences
      if (c === 0x1b && i + 1 < data.length) {
        const next = data[i + 1]

        // CSI: \x1b[
        if (next === "[") {
          i = this.handleCSI(data, i + 2)
          continue
        }

        // OSC: \x1b] ... BEL or ST — skip
        if (next === "]") {
          i = this.skipOSC(data, i + 2)
          continue
        }

        // DCS/APC/PM: \x1bP, \x1b_, \x1b^ — skip to ST
        if (next === "P" || next === "_" || next === "^") {
          i = this.skipToST(data, i + 2)
          continue
        }

        // SS3: \x1bO — skip the next char
        if (next === "O" && i + 2 < data.length) {
          i += 3
          continue
        }

        // Save cursor: \x1b7 or \x1b[s
        if (next === "7") {
          this.savedCursorX = this.cursorX
          this.savedCursorY = this.cursorY
          i += 2; continue
        }

        // Restore cursor: \x1b8 or \x1b[u
        if (next === "8") {
          this.cursorX = this.savedCursorX
          this.cursorY = this.savedCursorY
          i += 2; continue
        }

        // Index (scroll up): \x1bD
        if (next === "D") {
          this.index()
          i += 2; continue
        }

        // Reverse index (scroll down): \x1bM
        if (next === "M") {
          this.reverseIndex()
          i += 2; continue
        }

        // Set tab stop, reset: skip
        if (next === "H" || next === "c") {
          i += 2; continue
        }

        // Unknown ESC — skip
        i += 2; continue
      }

      // C0 control characters
      if (c === 0x0d) { // CR
        this.cursorX = 0
        i++; continue
      }
      if (c === 0x0a) { // LF
        if (this.cursorY === this.scrollBottom) {
          this.scrollUp()
        } else if (this.cursorY < this.height - 1) {
          this.cursorY++
        }
        i++; continue
      }
      if (c === 0x08) { // BS
        if (this.cursorX > 0) this.cursorX--
        i++; continue
      }
      if (c === 0x09) { // TAB
        this.cursorX = Math.min(((this.cursorX >> 3) + 1) << 3, this.width - 1)
        i++; continue
      }
      if (c === 0x07) { // BEL
        i++; continue
      }
      if (c < 0x20 && c !== 0x1b) {
        i++; continue
      }

      // Printable character
      if (this.cursorX >= this.width) {
        // Auto-wrap
        this.cursorX = 0
        if (this.cursorY === this.scrollBottom) {
          this.scrollUp()
        } else if (this.cursorY < this.height - 1) {
          this.cursorY++
        }
      }

      const row = this.cells[this.cursorY]
      if (row && this.cursorX < this.width) {
        row[this.cursorX] = { char: data[i], sgr: this.currentSgr }
      }
      this.cursorX++
      i++
    }
  }

  // Get full buffer: all scrollback lines + current screen (for select mode)
  getAllLines(): string[] {
    const lines: string[] = []
    for (const row of this.scrollback) lines.push(this.renderRow(row))
    for (let r = 0; r < this.height; r++) lines.push(this.renderRow(this.cells[r]))
    return lines
  }

  // Get screen as lines with embedded ANSI SGR codes (like tmux capture-pane -e)
  // When scrollOffset > 0, shows scrollback history mixed with screen content
  getLines(): string[] {
    const lines: string[] = []

    if (this.scrollOffset > 0) {
      // Viewing scrollback: combine scrollback + current screen, then take a window
      const sbLen = this.scrollback.length
      const totalRows = sbLen + this.height
      const startRow = totalRows - this.height - this.scrollOffset
      for (let r = 0; r < this.height; r++) {
        const srcRow = startRow + r
        let row: VtCell[]
        if (srcRow < 0) {
          // Beyond scrollback — empty line
          lines.push("")
          continue
        } else if (srcRow < sbLen) {
          row = this.scrollback[srcRow]
        } else {
          row = this.cells[srcRow - sbLen]
        }
        lines.push(this.renderRow(row))
      }
    } else {
      // Live view: just render current screen
      for (let r = 0; r < this.height; r++) {
        lines.push(this.renderRow(this.cells[r]))
      }
    }

    return lines
  }

  private renderRow(row: VtCell[]): string {
    if (!row) return ""
    let line = ""
    let lastSgr = ""
    let trailingSpaces = 0

    for (let c = 0; c < this.width && c < row.length; c++) {
      const cell = row[c]
      if (cell.sgr !== lastSgr) {
        if (trailingSpaces > 0) {
          line += " ".repeat(trailingSpaces)
          trailingSpaces = 0
        }
        line += cell.sgr ? `\x1b[${cell.sgr}m` : "\x1b[0m"
        lastSgr = cell.sgr
      }
      if (cell.char === " " && !cell.sgr) {
        trailingSpaces++
      } else {
        if (trailingSpaces > 0) {
          line += " ".repeat(trailingSpaces)
          trailingSpaces = 0
        }
        line += cell.char
      }
    }
    if (lastSgr) line += "\x1b[0m"
    return line
  }

  // ─── CSI Handler ──────────────────────────────────────────

  private handleCSI(data: string, start: number): number {
    let i = start
    const params: number[] = []
    let num = ""
    let privateMode = ""

    // Check for private mode prefix (?, >, =)
    if (i < data.length && (data[i] === "?" || data[i] === ">" || data[i] === "=")) {
      privateMode = data[i]
      i++
    }

    // Parse parameters
    while (i < data.length) {
      const ch = data[i]
      if (ch >= "0" && ch <= "9") {
        num += ch; i++
      } else if (ch === ";") {
        params.push(num === "" ? 0 : parseInt(num))
        num = ""; i++
      } else {
        params.push(num === "" ? 0 : parseInt(num))
        break
      }
    }

    if (i >= data.length) return i

    const final = data[i]
    i++

    // Private mode sequences (h/l for set/reset)
    if (privateMode === "?") {
      if (final === "h" || final === "l") {
        const mode = params[0] ?? 0
        if (mode === 1049 || mode === 47 || mode === 1047) {
          if (final === "h") {
            // Enter alternate screen
            this.altScreen = this.cells
            this.altCursorX = this.cursorX
            this.altCursorY = this.cursorY
            this.cells = this.makeGrid(this.width, this.height)
            this.cursorX = 0
            this.cursorY = 0
          } else {
            // Leave alternate screen
            if (this.altScreen) {
              this.cells = this.altScreen
              this.cursorX = this.altCursorX
              this.cursorY = this.altCursorY
              this.altScreen = null
            }
          }
        }
        // Ignore other private modes (cursor visibility, mouse, etc.)
      }
      return i
    }

    // Standard CSI sequences
    switch (final) {
      case "m": // SGR
        this.currentSgr = this.buildSgrString(params)
        break

      case "H": case "f": { // Cursor position
        const row = Math.max(0, (params[0] || 1) - 1)
        const col = Math.max(0, (params[1] || 1) - 1)
        this.cursorY = Math.min(row, this.height - 1)
        this.cursorX = Math.min(col, this.width - 1)
        break
      }

      case "A": // Cursor up
        this.cursorY = Math.max(0, this.cursorY - (params[0] || 1))
        break
      case "B": // Cursor down
        this.cursorY = Math.min(this.height - 1, this.cursorY + (params[0] || 1))
        break
      case "C": // Cursor right
        this.cursorX = Math.min(this.width - 1, this.cursorX + (params[0] || 1))
        break
      case "D": // Cursor left
        this.cursorX = Math.max(0, this.cursorX - (params[0] || 1))
        break

      case "G": // Cursor horizontal absolute
        this.cursorX = Math.min(Math.max(0, (params[0] || 1) - 1), this.width - 1)
        break
      case "d": // Cursor vertical absolute
        this.cursorY = Math.min(Math.max(0, (params[0] || 1) - 1), this.height - 1)
        break

      case "J": { // Erase in display
        const mode = params[0] || 0
        if (mode === 0) { // Erase below
          this.clearRange(this.cursorY, this.cursorX, this.height - 1, this.width - 1)
        } else if (mode === 1) { // Erase above
          this.clearRange(0, 0, this.cursorY, this.cursorX)
        } else if (mode === 2 || mode === 3) { // Erase all
          this.cells = this.makeGrid(this.width, this.height)
        }
        break
      }

      case "K": { // Erase in line
        const mode = params[0] || 0
        const row = this.cells[this.cursorY]
        if (!row) break
        if (mode === 0) { // Erase to right
          for (let c = this.cursorX; c < this.width; c++) row[c] = { char: " ", sgr: "" }
        } else if (mode === 1) { // Erase to left
          for (let c = 0; c <= this.cursorX; c++) row[c] = { char: " ", sgr: "" }
        } else if (mode === 2) { // Erase entire line
          for (let c = 0; c < this.width; c++) row[c] = { char: " ", sgr: "" }
        }
        break
      }

      case "X": { // Erase characters
        const n = params[0] || 1
        const row = this.cells[this.cursorY]
        if (row) {
          for (let c = this.cursorX; c < Math.min(this.cursorX + n, this.width); c++) {
            row[c] = { char: " ", sgr: "" }
          }
        }
        break
      }

      case "L": { // Insert lines
        const n = Math.min(params[0] || 1, this.scrollBottom - this.cursorY + 1)
        for (let j = 0; j < n; j++) {
          this.cells.splice(this.scrollBottom, 1)
          this.cells.splice(this.cursorY, 0,
            Array.from({ length: this.width }, () => ({ char: " ", sgr: "" })))
        }
        break
      }

      case "M": { // Delete lines
        const n = Math.min(params[0] || 1, this.scrollBottom - this.cursorY + 1)
        for (let j = 0; j < n; j++) {
          this.cells.splice(this.cursorY, 1)
          this.cells.splice(this.scrollBottom, 0,
            Array.from({ length: this.width }, () => ({ char: " ", sgr: "" })))
        }
        break
      }

      case "P": { // Delete characters
        const n = params[0] || 1
        const row = this.cells[this.cursorY]
        if (row) {
          row.splice(this.cursorX, n)
          while (row.length < this.width) row.push({ char: " ", sgr: "" })
        }
        break
      }

      case "@": { // Insert characters
        const n = params[0] || 1
        const row = this.cells[this.cursorY]
        if (row) {
          for (let j = 0; j < n; j++) {
            row.splice(this.cursorX, 0, { char: " ", sgr: "" })
          }
          row.length = this.width
        }
        break
      }

      case "S": { // Scroll up
        const n = params[0] || 1
        for (let j = 0; j < n; j++) this.scrollUp()
        break
      }

      case "T": { // Scroll down
        const n = params[0] || 1
        for (let j = 0; j < n; j++) this.reverseIndex()
        break
      }

      case "r": { // Set scroll region
        this.scrollTop = Math.max(0, (params[0] || 1) - 1)
        this.scrollBottom = Math.min(this.height - 1, (params[1] || this.height) - 1)
        this.cursorX = 0
        this.cursorY = 0
        break
      }

      case "s": // Save cursor
        this.savedCursorX = this.cursorX
        this.savedCursorY = this.cursorY
        break
      case "u": // Restore cursor
        this.cursorX = this.savedCursorX
        this.cursorY = this.savedCursorY
        break

      case "n": // Device status report — ignore
      case "c": // Device attributes — ignore
      case "h": case "l": // Set/reset mode — ignore
      case "t": // Window manipulation — ignore
        break
    }

    return i
  }

  private buildSgrString(params: number[]): string {
    // Reset
    if (params.length === 1 && params[0] === 0) return ""
    if (params.length === 0) return ""
    return params.join(";")
  }

  private clearRange(r1: number, c1: number, r2: number, c2: number) {
    for (let r = r1; r <= r2 && r < this.height; r++) {
      const row = this.cells[r]
      if (!row) continue
      const startC = r === r1 ? c1 : 0
      const endC = r === r2 ? c2 : this.width - 1
      for (let c = startC; c <= endC && c < this.width; c++) {
        row[c] = { char: " ", sgr: "" }
      }
    }
  }

  private scrollUp() {
    // Save the line scrolling off the top into scrollback
    const removedRow = this.cells.splice(this.scrollTop, 1)[0]
    if (removedRow && this.scrollTop === 0) {
      this.scrollback.push(removedRow)
      if (this.scrollback.length > VtScreen.MAX_SCROLLBACK) {
        this.scrollback.shift()
      }
    }
    this.cells.splice(this.scrollBottom, 0,
      Array.from({ length: this.width }, () => ({ char: " ", sgr: "" })))
    // Auto-reset scroll offset when new output arrives
    if (this.scrollOffset > 0) this.scrollOffset = 0
  }

  private index() {
    if (this.cursorY === this.scrollBottom) {
      this.scrollUp()
    } else if (this.cursorY < this.height - 1) {
      this.cursorY++
    }
  }

  private reverseIndex() {
    if (this.cursorY === this.scrollTop) {
      this.cells.splice(this.scrollBottom, 1)
      this.cells.splice(this.scrollTop, 0,
        Array.from({ length: this.width }, () => ({ char: " ", sgr: "" })))
    } else if (this.cursorY > 0) {
      this.cursorY--
    }
  }

  private skipOSC(data: string, start: number): number {
    let i = start
    while (i < data.length) {
      if (data[i] === "\x07") return i + 1
      if (data[i] === "\x1b" && i + 1 < data.length && data[i + 1] === "\\") return i + 2
      i++
    }
    return i
  }

  private skipToST(data: string, start: number): number {
    let i = start
    while (i < data.length) {
      if (data[i] === "\x1b" && i + 1 < data.length && data[i + 1] === "\\") return i + 2
      i++
    }
    return i
  }
}

// ─── Public API ─────────────────────────────────────────────

export function startCapture(session: PtySession): void {
  if (panes.has(session.name)) return

  const screen = new VtScreen(session.width, session.height)
  const state: PaneState = {
    session,
    screen,
    callbacks: new Set(),
    reader: null,
    running: true,
  }
  panes.set(session.name, state)

  // Start reading stdout from pty-helper
  if (session.proc.stdout) {
    const reader = session.proc.stdout.getReader()
    state.reader = reader
    const decoder = new TextDecoder()

    ;(async () => {
      try {
        while (state.running) {
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value, { stream: true })
          screen.write(text)

          // Push frame to subscribers
          const frame: CaptureResult = {
            lines: screen.getLines(),
            cursorX: screen.cursorX,
            cursorY: screen.cursorY,
            width: screen.width,
            height: screen.height,
          }
          for (const cb of state.callbacks) {
            try { cb(frame) } catch {}
          }
        }
      } catch {
        // Process died
      }
    })()
  }
}

export function onFrame(sessionName: string, cb: FrameCallback): () => void {
  const state = panes.get(sessionName)
  if (state) state.callbacks.add(cb)
  return () => {
    const s = panes.get(sessionName)
    if (s) s.callbacks.delete(cb)
  }
}

export function getLatestFrame(sessionName: string): CaptureResult | null {
  const state = panes.get(sessionName)
  if (!state) return null
  return {
    lines: state.screen.getLines(),
    cursorX: state.screen.cursorX,
    cursorY: state.screen.cursorY,
    width: state.screen.width,
    height: state.screen.height,
  }
}

export function getFullBuffer(sessionName: string): string[] | null {
  const state = panes.get(sessionName)
  if (!state) return null
  return state.screen.getAllLines()
}

export function stopCapture(sessionName: string): void {
  const state = panes.get(sessionName)
  if (!state) return
  state.running = false
  state.callbacks.clear()
  if (state.reader) {
    try { state.reader.cancel() } catch {}
  }
  panes.delete(sessionName)
}

export function resizeCapture(sessionName: string, width: number, height: number): void {
  const state = panes.get(sessionName)
  if (!state) return
  state.screen.resize(width, height)
}

// Scroll the pane's view into scrollback history.
// Returns the new scroll offset (0 = live view).
export function scrollPane(sessionName: string, direction: "up" | "down", lines = 5): number {
  const state = panes.get(sessionName)
  if (!state) return 0
  const screen = state.screen
  const maxOffset = screen.scrollback.length

  if (direction === "up") {
    screen.scrollOffset = Math.min(screen.scrollOffset + lines, maxOffset)
  } else {
    screen.scrollOffset = Math.max(screen.scrollOffset - lines, 0)
  }

  // Push a frame update so the pane redraws with the new scroll position
  const frame: CaptureResult = {
    lines: screen.getLines(),
    cursorX: screen.cursorX,
    cursorY: screen.cursorY,
    width: screen.width,
    height: screen.height,
  }
  for (const cb of state.callbacks) {
    try { cb(frame) } catch {}
  }

  return screen.scrollOffset
}

export function getScrollOffset(sessionName: string): number {
  const state = panes.get(sessionName)
  return state?.screen.scrollOffset ?? 0
}

export function stopAllCaptures(): void {
  for (const [name] of panes) stopCapture(name)
}

// Hash for diffing — skip re-render if nothing changed
const lastHashes = new Map<string, number>()

export function hasChanged(lines: string[], key = "_default"): boolean {
  let h = 5381
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (let j = 0; j < line.length; j++) {
      h = ((h << 5) + h + line.charCodeAt(j)) | 0
    }
    h = ((h << 5) + h + 10) | 0
  }
  const prev = lastHashes.get(key)
  if (prev === h) return false
  lastHashes.set(key, h)
  return true
}

export function resetHash(key = "_default") {
  lastHashes.delete(key)
}
