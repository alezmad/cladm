import {
  FrameBufferRenderable,
  type FrameBufferOptions,
  type RenderContext,
  type OptimizedBuffer,
  RGBA,
  TextAttributes,
} from "@opentui/core"
import { startCapture, stopCapture, setCaptureRate, onFrame, hasChanged, resetHash, type CaptureResult } from "../tmux/capture"
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
  return PROJECT_COLORS[colorIndex % PROJECT_COLORS.length]!
}

// Push-based terminal view: no poll timers.
// Subscribes to capture stream and renders only when content changes.
export class TerminalView extends FrameBufferRenderable {
  session: TmuxSession | null = null
  private unsubCapture: (() => void) | null = null
  private lastFrame: ParsedFrame | null = null
  private _flashUntil = 0
  private _idleSince = 0
  private _frameDirty = false

  constructor(ctx: RenderContext, options: FrameBufferOptions) {
    super(ctx, options)
  }

  override get focused() { return this._focused }
  override set focused(v: boolean) {
    if (this._focused === v) return
    this._focused = v
    // Focused pane captures at ~60fps, unfocused at ~5fps
    if (this.session) {
      setCaptureRate(this.session.name, v ? 16 : 200)
    }
  }

  get idleSince() { return this._idleSince }

  attach(session: TmuxSession) {
    this.detach()
    this.session = session
    resetHash(session.name)
    const captureMs = this._focused ? 16 : 200
    startCapture(session.name, captureMs)
    // Subscribe to push notifications — no poll timer needed
    this.unsubCapture = onFrame(session.name, (frame) => this.onNewFrame(frame))
  }

  detach() {
    if (this.unsubCapture) { this.unsubCapture(); this.unsubCapture = null }
    if (this.session) {
      stopCapture(this.session.name)
      resetHash(this.session.name)
    }
    this.session = null
    this.lastFrame = null
    this._frameDirty = false
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

  // Hint that input was sent — request immediate render
  nudge() {
    this.requestRender()
  }

  private onNewFrame(result: CaptureResult) {
    if (!this.session) return
    if (!hasChanged(result.lines, this.session.name)) return

    const frame = parseAnsiFrame(result.lines, result.width, result.height)
    this.lastFrame = frame
    this._frameDirty = true
    this.requestRender()
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

  // Only write to framebuffer when content actually changed (dirty flag)
  // Previously this re-rendered EVERY paint cycle — major CPU waste
  protected override renderSelf(buffer: OptimizedBuffer) {
    if (this._frameDirty && this.lastFrame) {
      this.renderFrameToBuffer(this.lastFrame)
      this._frameDirty = false
    }
    super.renderSelf(buffer)
  }

  protected override onResize(width: number, height: number) {
    super.onResize(width, height)
    this._frameDirty = true // Re-render frame to new buffer size
    if (this.session) {
      import("../tmux/session-manager").then(m => {
        if (this.session) m.resizePane(this.session.name, width, height)
      })
    }
  }

  protected override destroySelf() {
    this.detach()
    super.destroySelf()
  }
}
