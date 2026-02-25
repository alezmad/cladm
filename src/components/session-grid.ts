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
import { sendKeys } from "../tmux/input-bridge"

export interface GridPane {
  session: TmuxSession
  termView: TerminalView
  borderBox: BoxRenderable
  titleText: TextRenderable
}

export class SessionGrid {
  private renderer: CliRenderer
  private container: BoxRenderable
  private panes: GridPane[] = []
  private _focusIndex = 0
  private flashTimers = new Map<string, ReturnType<typeof setInterval>>()

  constructor(renderer: CliRenderer, container: BoxRenderable) {
    this.renderer = renderer
    this.container = container
  }

  get focusIndex() { return this._focusIndex }
  get paneCount() { return this.panes.length }
  get focusedPane(): GridPane | null { return this.panes[this._focusIndex] ?? null }

  addSession(session: TmuxSession): GridPane {
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

    // Calculate pane size (leave room for border + title)
    const dims = this.calcPaneDims()
    const termView = new TerminalView(this.renderer, {
      width: Math.max(dims.w - 2, 10),
      height: Math.max(dims.h - 3, 4),
    })

    borderBox.add(titleText)
    borderBox.add(termView)
    this.container.add(borderBox)

    const pane: GridPane = { session, termView, borderBox, titleText }
    this.panes.push(pane)

    termView.attach(session)
    this.updateLayout()
    this.updateBorders()

    return pane
  }

  removeSession(sessionName: string) {
    const idx = this.panes.findIndex(p => p.session.name === sessionName)
    if (idx < 0) return

    const pane = this.panes[idx]
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

  async sendInputToFocused(rawSequence: string) {
    const pane = this.focusedPane
    if (!pane) return
    await sendKeys(pane.session.name, rawSequence)
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
    this.startFlash(sessionName)
    pane.titleText.content = t` ${bold(fg(getProjectColor(pane.session.colorIndex))(pane.session.projectName))} ${fg("#e0af68")("NEEDS INPUT")}`
    this.renderer.requestRender()
  }

  markBusy(sessionName: string) {
    const pane = this.panes.find(p => p.session.name === sessionName)
    if (!pane) return
    this.clearFlash(sessionName)
    pane.titleText.content = t` ${bold(fg(getProjectColor(pane.session.colorIndex))(pane.session.projectName))} ${fg("#9ece6a")("RUNNING")}`
    this.renderer.requestRender()
  }

  clearMark(sessionName: string) {
    const pane = this.panes.find(p => p.session.name === sessionName)
    if (!pane) return
    this.clearFlash(sessionName)
    const color = getProjectColor(pane.session.colorIndex)
    pane.titleText.content = t` ${bold(fg(color)(pane.session.projectName))}${pane.session.sessionId ? dim(` #${pane.session.sessionId.slice(0, 8)}`) : ""}`
    this.renderer.requestRender()
  }

  private updateBorders() {
    for (let i = 0; i < this.panes.length; i++) {
      const pane = this.panes[i]
      const isFocused = i === this._focusIndex
      const color = getProjectColor(pane.session.colorIndex)

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
      const pane = this.panes[i]
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
