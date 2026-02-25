import {
  FrameBufferRenderable,
  type FrameBufferOptions,
  type RenderContext,
  type OptimizedBuffer,
  RGBA,
  TextAttributes,
} from "@opentui/core"
import { capturePane, hasChanged, resetHash } from "../tmux/capture"
import { parseAnsiFrame, type ParsedFrame } from "../tmux/ansi-parser"
import type { TmuxSession } from "../tmux/session-manager"

// Per-project color palette for borders (distinct, visible on dark bg)
const PROJECT_COLORS = [
  "#7aa2f7", // blue
  "#9ece6a", // green
  "#e0af68", // yellow
  "#f7768e", // red
  "#bb9af7", // purple
  "#7dcfff", // cyan
  "#ff9e64", // orange
  "#c0caf5", // white
  "#73daca", // teal
  "#b4f9f8", // mint
]

export function getProjectColor(colorIndex: number): string {
  return PROJECT_COLORS[colorIndex % PROJECT_COLORS.length]
}

export class TerminalView extends FrameBufferRenderable {
  session: TmuxSession | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private lastFrame: ParsedFrame | null = null
  private _focused = false
  private _flashUntil = 0  // timestamp until which border flashes
  private _idleSince = 0

  constructor(ctx: RenderContext, options: FrameBufferOptions) {
    super(ctx, options)
  }

  get focused() { return this._focused }
  set focused(v: boolean) { this._focused = v }

  get idleSince() { return this._idleSince }

  attach(session: TmuxSession) {
    this.detach()
    this.session = session
    resetHash()
    this.startPolling()
  }

  detach() {
    this.stopPolling()
    this.session = null
    this.lastFrame = null
  }

  flash(durationMs = 2000) {
    this._flashUntil = Date.now() + durationMs
  }

  setIdle(sinceMs: number) {
    this._idleSince = sinceMs
  }

  clearIdle() {
    this._idleSince = 0
  }

  private startPolling() {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => this.refresh(), 80)
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async refresh() {
    if (!this.session) return

    const result = await capturePane(this.session.name)
    if (!result) return

    if (!hasChanged(result.lines)) return

    const frame = parseAnsiFrame(result.lines, result.width, result.height)
    this.lastFrame = frame
    this.renderFrameToBuffer(frame)
  }

  private renderFrameToBuffer(frame: ParsedFrame) {
    const fb = this.frameBuffer
    if (!fb) return

    const w = Math.min(frame.width, fb.width)
    const h = Math.min(frame.height, fb.height)

    for (let y = 0; y < h; y++) {
      const row = frame.cells[y]
      if (!row) continue
      for (let x = 0; x < w; x++) {
        const cell = row[x]
        if (!cell) continue
        fb.setCell(x, y, cell.char, cell.fg, cell.bg, cell.attrs)
      }
    }
  }

  protected renderSelf(buffer: OptimizedBuffer) {
    if (this.lastFrame) {
      this.renderFrameToBuffer(this.lastFrame)
    }
    super.renderSelf(buffer)
  }

  protected onResize(width: number, height: number) {
    super.onResize(width, height)
    if (this.session) {
      // Resize tmux pane to match (async, fire-and-forget)
      import("../tmux/session-manager").then(m => {
        if (this.session) m.resizePane(this.session.name, width, height)
      })
    }
  }

  protected destroySelf() {
    this.detach()
    super.destroySelf()
  }
}
