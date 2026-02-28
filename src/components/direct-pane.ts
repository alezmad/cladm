// Lightweight terminal pane: writes raw ANSI from PTY capture directly to stdout.
// No parsing, no FrameBuffer, no OpenTUI. Just cursor-addressed raw lines.

import { onFrame, hasChanged, resetHash, type CaptureResult } from "../pty/capture"

export class DirectPane {
  screenX: number   // 1-based screen column of content area
  screenY: number   // 1-based screen row of content area
  width: number     // content columns
  height: number    // content rows
  sessionName = ""

  private unsub: (() => void) | null = null

  // Set by DirectGridRenderer to receive frame updates
  onFrame: ((lines: string[], pane: DirectPane) => void) | null = null

  constructor(x: number, y: number, w: number, h: number) {
    this.screenX = x
    this.screenY = y
    this.width = w
    this.height = h
  }

  attach(sessionName: string) {
    this.detach()
    this.sessionName = sessionName
    resetHash(`dp_${sessionName}`)
    this.unsub = onFrame(sessionName, (result) => {
      if (!hasChanged(result.lines, `dp_${sessionName}`)) return
      if (this.onFrame) this.onFrame(result.lines, this)
    })
  }

  detach() {
    if (this.unsub) { this.unsub(); this.unsub = null }
    if (this.sessionName) resetHash(`dp_${this.sessionName}`)
    this.sessionName = ""
    this.onFrame = null
  }

  reposition(x: number, y: number, w: number, h: number) {
    this.screenX = x
    this.screenY = y
    this.width = w
    this.height = h
  }

  // Build cursor-addressed ANSI output for this pane's content.
  // Returns a string ready for stdout.write(). No allocations beyond the string.
  buildFrame(lines: string[]): string {
    let out = ""
    const x = this.screenX
    const y = this.screenY
    const w = this.width
    const h = this.height

    for (let row = 0; row < h; row++) {
      // Position cursor at start of this row
      out += `\x1b[${y + row};${x}H`
      // Erase w characters (clears old content)
      out += `\x1b[${w}X`

      if (row < lines.length) {
        // Write raw ANSI line from PTY (already correct width)
        out += lines[row]
        // Reset SGR to prevent color bleed into border
        out += "\x1b[0m"
      }
    }

    return out
  }
}
