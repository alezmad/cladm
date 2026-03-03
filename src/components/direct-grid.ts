// Direct grid renderer: bypasses OpenTUI entirely for grid mode.
// Draws chrome (borders/titles) and pane content using raw ANSI cursor-addressed writes.
// Each pane renders independently via PTY capture push callbacks.

import { DirectPane } from "./direct-pane"
import { startCapture, stopCapture, resizeCapture, resetHash, getLatestFrame, getFullBuffer, scrollPane, getScrollOffset, getScrollInfo, scrollToOffset } from "../pty/capture"
import { writeToSession, resizeSession, killSession, type PtySession } from "../pty/session-manager"
import { app, type GridTab } from "../lib/state"
import { pct, makeBar, formatCost, PLAN_LIMITS } from "../data/usage"

export type PaneStatus = "busy" | "idle" | null

export interface GridPaneInfo {
  session: PtySession
  directPane: DirectPane
  status: PaneStatus
  statusSince: number
  tabId: number
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

function hexBg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `\x1b[48;2;${r};${g};${b}m`
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

const CYAN_FG = hexFg("#7dcfff")
const YELLOW_FG = hexFg("#e0af68")
const TAB_ACTIVE_BG = hexBg("#1a1b26")
const TAB_DIM_BG = hexBg("#16161e")

// TTS announce pane name on focus change (fire-and-forget)
const TTS_HOOK = `${process.env.HOME}/.claude/hooks/play-tts.sh`
let _lastAnnounce = 0
function announcePaneName(name: string) {
  const now = Date.now()
  if (now - _lastAnnounce < 500) return  // debounce rapid navigation
  _lastAnnounce = now
  try { Bun.spawn(["bash", TTS_HOOK, name], { stdout: "ignore", stderr: "ignore" }) } catch {}
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

export class DirectGridRenderer {
  // Per-tab state
  private tabPanes = new Map<number, GridPaneInfo[]>()
  private tabFocus = new Map<number, number>()
  private tabExpanded = new Map<number, number>()       // fullscreen expand
  private tabSoftExpand = new Map<number, number>()     // soft expand (70/30)
  private _activeTabId = -1

  private writeRaw: (s: string) => boolean
  private pulseTimers = new Map<string, ReturnType<typeof setInterval>>()
  private pulseStopTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private titleTimer: ReturnType<typeof setInterval> | null = null
  private running = false

  // Tab bar hit-test regions (col ranges for each tab)
  private tabBarHitRegions: { tabId: number, startCol: number, endCol: number }[] = []
  private tabCloseHitRegions: { tabId: number, startCol: number, endCol: number }[] = []
  private tabBarAddBtnCol = -1
  // Pane name hit-test regions (inline in tab bar, row 1)
  private paneListHitRegions: { tabId: number, paneIndex: number, startCol: number, endCol: number }[] = []
  // Footer scratch button hit region
  private scratchBtnHit: { startCol: number, endCol: number } | null = null

  // Pending close state
  private _pendingCloseTabId = -1
  private _pendingCloseTimer: ReturnType<typeof setTimeout> | null = null

  // Scrollbar drag state
  _scrollDrag: {
    sessionName: string
    paneIndex: number
    trackTop: number      // screen row where track starts
    trackHeight: number
    thumbSize: number
    scrollbackLength: number
  } | null = null

  constructor(rawWrite: (s: string) => boolean) {
    this.writeRaw = rawWrite
  }

  // ─── Active tab pane accessors ──────────────────────────

  private get panes(): GridPaneInfo[] {
    return this.tabPanes.get(this._activeTabId) ?? []
  }

  private get _focusIndex(): number {
    return this.tabFocus.get(this._activeTabId) ?? 0
  }
  private set _focusIndex(v: number) {
    this.tabFocus.set(this._activeTabId, v)
  }

  private get _expandedIndex(): number {
    return this.tabExpanded.get(this._activeTabId) ?? -1
  }
  private set _expandedIndex(v: number) {
    this.tabExpanded.set(this._activeTabId, v)
  }

  private get _softExpandIndex(): number {
    return this.tabSoftExpand.get(this._activeTabId) ?? -1
  }
  private set _softExpandIndex(v: number) {
    this.tabSoftExpand.set(this._activeTabId, v)
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
    for (const timer of this.pulseTimers.values()) clearInterval(timer)
    this.pulseTimers.clear()
    for (const timer of this.pulseStopTimers.values()) clearTimeout(timer)
    this.pulseStopTimers.clear()
    for (const [, panes] of this.tabPanes) {
      for (const p of panes) {
        p.directPane.detach()
        stopCapture(p.session.name)
      }
    }
    this.writeRaw(SHOW_CURSOR)
  }

  pause() {
    this.running = false
    if (this.titleTimer) { clearInterval(this.titleTimer); this.titleTimer = null }
    for (const [, panes] of this.tabPanes) {
      for (const p of panes) p.directPane.detach()
    }
  }

  resume() {
    this.running = true
    this.writeRaw(HIDE_CURSOR + CLEAR)
    const panes = this.panes
    for (let i = 0; i < panes.length; i++) {
      const p = panes[i]!
      const idx = i
      p.directPane.attach(p.session.name)
      p.directPane.onFrame = (lines) => {
        if (!this.running) return
        this.drawPane(idx, lines)
      }
    }
    this.repositionAll()
    setTimeout(() => this.forceRedrawAll(), 100)
    this.titleTimer = setInterval(() => this.refreshTitles(), 1000)
  }

  // ─── Getters ───────────────────────────────────────────

  get focusIndex() { return this._focusIndex }
  get paneCount() { return this.panes.length }
  get totalPaneCount() { let n = 0; for (const [, p] of this.tabPanes) n += p.length; return n }
  get focusedPane(): GridPaneInfo | null { return this.panes[this._focusIndex] ?? null }
  get isExpanded() { return this._expandedIndex >= 0 }
  get isSoftExpanded() { return this._softExpandIndex >= 0 }
  get activeTabId() { return this._activeTabId }

  openInTextEdit() {
    const pane = this.focusedPane
    if (!pane) return
    const lines = getFullBuffer(pane.session.name) ?? []
    const plain = lines.map(l => l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\].*?\x07/g, "")).join("\n")
    const tmp = `/tmp/cladm-${pane.session.projectName.replace(/[^a-zA-Z0-9_-]/g, "_")}.txt`
    Bun.write(tmp, plain).then(() => Bun.spawn(["open", "-a", "TextEdit", tmp]))
  }

  expandPane(index?: number) {
    const idx = index ?? this._focusIndex
    if (idx < 0 || idx >= this.panes.length) return
    this._expandedIndex = idx
    this._softExpandIndex = -1
    this._focusIndex = idx
    this.repositionAll()
  }

  collapsePane() {
    this._expandedIndex = -1
    this._softExpandIndex = -1
    this.repositionAll()
  }

  // ─── Soft Expand ──────────────────────────────────────

  softExpandPane(index: number) {
    if (index < 0 || index >= this.panes.length) return
    this._softExpandIndex = index
    this._focusIndex = index
    this.repositionAll()
  }

  softCollapsePane() {
    this._softExpandIndex = -1
    this.repositionAll()
  }

  toggleSoftExpand(index: number) {
    if (this._softExpandIndex === index) this.softCollapsePane()
    else this.softExpandPane(index)
  }

  // ─── Tab management ───────────────────────────────────

  addTab(tab: GridTab) {
    this.tabPanes.set(tab.id, [])
    this.tabFocus.set(tab.id, 0)
    this.tabExpanded.set(tab.id, -1)
    this.tabSoftExpand.set(tab.id, -1)
  }

  removeTab(tabId: number) {
    const panes = this.tabPanes.get(tabId)
    if (panes) {
      for (const p of panes) {
        p.directPane.detach()
        stopCapture(p.session.name)
        killSession(p.session.name)
        this.clearPulse(p.session.name)
      }
    }
    this.tabPanes.delete(tabId)
    this.tabFocus.delete(tabId)
    this.tabExpanded.delete(tabId)
    this.tabSoftExpand.delete(tabId)
  }

  // ─── Tab close (double-click confirm) ────────────────

  get pendingCloseTabId() { return this._pendingCloseTabId }

  requestCloseTab(tabId: number): "pending" | "closed" {
    if (this._pendingCloseTabId === tabId) {
      // Second click — execute close
      this.cancelPendingClose()
      this.closeTab(tabId)
      return "closed"
    }
    // First click — mark pending
    this.cancelPendingClose()
    this._pendingCloseTabId = tabId
    this._pendingCloseTimer = setTimeout(() => {
      this._pendingCloseTabId = -1
      this._pendingCloseTimer = null
      this.drawChrome()
    }, 2000)
    this.drawChrome()
    return "pending"
  }

  closeTab(tabId: number): number {
    const tabIdx = app.gridTabs.findIndex(t => t.id === tabId)
    if (tabIdx < 0) return -1
    this.removeTab(tabId)
    app.gridTabs.splice(tabIdx, 1)
    return tabIdx
  }

  cancelPendingClose() {
    if (this._pendingCloseTimer) {
      clearTimeout(this._pendingCloseTimer)
      this._pendingCloseTimer = null
    }
    if (this._pendingCloseTabId !== -1) {
      this._pendingCloseTabId = -1
      this.drawChrome()
    }
  }

  setActiveTab(tabId: number) {
    if (this._activeTabId === tabId) return
    // Detach current tab's panes
    if (this._activeTabId >= 0) {
      for (const p of this.panes) p.directPane.detach()
    }
    this._activeTabId = tabId
    // Reattach new tab's panes
    const panes = this.panes
    for (let i = 0; i < panes.length; i++) {
      const p = panes[i]!
      const idx = i
      p.directPane.attach(p.session.name)
      p.directPane.onFrame = (lines) => {
        if (!this.running) return
        this.drawPane(idx, lines)
      }
    }
    if (this.running) {
      this.writeRaw(CLEAR)
      this.repositionAll()
      setTimeout(() => this.forceRedrawAll(), 100)
    }
  }

  getTabPaneCount(tabId: number): number {
    return this.tabPanes.get(tabId)?.length ?? 0
  }

  getTabPanes(tabId: number): readonly GridPaneInfo[] {
    return this.tabPanes.get(tabId) ?? []
  }

  hasIdleInTab(tabId: number): boolean {
    const panes = this.tabPanes.get(tabId)
    if (!panes) return false
    return panes.some(p => p.status === "idle")
  }

  // Check if a click hit a button on the top border. Returns action + pane index.
  // Hit areas are widened beyond the visible dot characters to make clicking easier.
  checkButtonClick(col: number, row: number): { action: "max" | "min" | "sel" | "tab" | "newtab" | "panefocus" | "closetab" | "closepane" | "openfolder" | "newsession" | "scratch" | "move-left" | "move-up" | "move-down" | "move-right", paneIndex: number, tabId?: number } | null {
    // Footer row — scratch button
    const termH = process.stdout.rows || 40
    if (row === termH && this.scratchBtnHit) {
      if (col >= this.scratchBtnHit.startCol - 1 && col <= this.scratchBtnHit.endCol) {
        return { action: "scratch", paneIndex: -1 }
      }
    }
    // Tab bar check (row 1) — includes inline pane names
    if (row === 1) {
      // Check close buttons first — widened ±1 around the × character
      for (const region of this.tabCloseHitRegions) {
        if (col >= region.startCol - 1 && col <= region.endCol + 1) {
          return { action: "closetab", paneIndex: -1, tabId: region.tabId }
        }
      }
      // Pane names (inline in tabs) — check before tab regions since they're more specific
      for (const region of this.paneListHitRegions) {
        if (col >= region.startCol - 1 && col <= region.endCol + 1) {
          return { action: "panefocus", paneIndex: region.paneIndex, tabId: region.tabId }
        }
      }
      for (const region of this.tabBarHitRegions) {
        if (col >= region.startCol && col <= region.endCol) {
          return { action: "tab", paneIndex: -1, tabId: region.tabId }
        }
      }
      // [+] button — widened ±1
      if (this.tabBarAddBtnCol > 0 && col >= this.tabBarAddBtnCol - 1 && col <= this.tabBarAddBtnCol + 3) {
        return { action: "newtab", paneIndex: -1 }
      }
      return null
    }

    const indicesToCheck = this.isExpanded ? [this._expandedIndex] : this.panes.map((_, i) => i)
    for (const i of indicesToCheck) {
      const dp = this.panes[i]!.directPane
      const bx = dp.screenX - 1
      const by = dp.screenY - 3
      const bw = dp.width + 2

      // Top border row — framed [●] buttons
      // Order from right: ─[●] ─[●] [●] [●]─╮  = blue folder, gap, green/yellow, red close
      if (row === by) {
        // close (red): rightmost, positions bw-5..bw-3 (before ─╮)
        if (col >= bx + bw - 5 && col <= bx + bw - 3) return { action: this.isExpanded ? "closepane" : "closepane", paneIndex: i }
        if (this.isExpanded) {
          // Layout: ...─[+] ─[●] ─[●] [●] [●]─╮
          // min (yellow): bw-9..bw-7
          if (col >= bx + bw - 9 && col <= bx + bw - 7) return { action: "min", paneIndex: i }
          // sel (green): bw-13..bw-11
          if (col >= bx + bw - 13 && col <= bx + bw - 11) return { action: "sel", paneIndex: i }
          // folder (blue): bw-18..bw-16 (after ─ gap)
          if (col >= bx + bw - 18 && col <= bx + bw - 16) return { action: "openfolder", paneIndex: i }
          // new session (cyan [+]): bw-23..bw-21
          if (col >= bx + bw - 23 && col <= bx + bw - 21) return { action: "newsession", paneIndex: i }
        } else {
          // Layout: ...─[+] ─[●] ─[●] [●] [●]─╮
          // max (green): bw-9..bw-7
          if (col >= bx + bw - 9 && col <= bx + bw - 7) return { action: "max", paneIndex: i }
          // sel (textedit): bw-13..bw-11
          if (col >= bx + bw - 13 && col <= bx + bw - 11) return { action: "sel", paneIndex: i }
          // folder (blue): bw-18..bw-16 (after ─ gap)
          if (col >= bx + bw - 18 && col <= bx + bw - 16) return { action: "openfolder", paneIndex: i }
          // new session (cyan [+]): bw-23..bw-21
          if (col >= bx + bw - 23 && col <= bx + bw - 21) return { action: "newsession", paneIndex: i }
          // Arrow buttons on left: ╭─[◀] [▲] [▼] [▶]─
          if (this.panes.length > 1) {
            if (col >= bx + 2 && col <= bx + 4) return { action: "move-left", paneIndex: i }
            if (col >= bx + 6 && col <= bx + 8) return { action: "move-up", paneIndex: i }
            if (col >= bx + 10 && col <= bx + 12) return { action: "move-down", paneIndex: i }
            if (col >= bx + 14 && col <= bx + 16) return { action: "move-right", paneIndex: i }
          }
        }
        continue
      }

      // Title row (by+1) — click to expand/focus
      if (row === by + 1 && !this.isExpanded) {
        return { action: "max", paneIndex: i }
      }
    }
    return null
  }

  // ─── Pane management ───────────────────────────────────

  async addPane(session: PtySession, tabId?: number): Promise<GridPaneInfo> {
    const tid = tabId ?? this._activeTabId
    let panes = this.tabPanes.get(tid)
    if (!panes) {
      panes = []
      this.tabPanes.set(tid, [])
      this.tabFocus.set(tid, 0)
      this.tabExpanded.set(tid, -1)
      this.tabSoftExpand.set(tid, -1)
      panes = this.tabPanes.get(tid)!
    }

    const isActive = tid === this._activeTabId
    const regions = isActive ? this.calcPaneRegions(panes.length + 1) : [{ screenX: 2, screenY: 5, contentW: 20, contentH: 6 }]
    const idx = panes.length
    const region = regions[Math.min(idx, regions.length - 1)]!

    const dp = new DirectPane(region.screenX, region.screenY, region.contentW, region.contentH)
    const info: GridPaneInfo = { session, directPane: dp, status: null, statusSince: 0, tabId: tid }
    panes.push(info)

    resizeSession(session.name, region.contentW, region.contentH)
    startCapture(session)

    if (isActive) {
      dp.attach(session.name)
      dp.onFrame = (lines) => {
        if (!this.running) return
        this.drawPane(idx, lines)
      }
      this.repositionAll()

      // Force-redraw all panes after a short delay to catch initial frames
      // that may have arrived before attach or been cleared by repositionAll
      setTimeout(() => this.forceRedrawAll(), 200)
    }

    return info
  }

  removePane(sessionName: string) {
    // Search across all tabs
    for (const [tabId, panes] of this.tabPanes) {
      const idx = panes.findIndex(p => p.session.name === sessionName)
      if (idx < 0) continue

      const pane = panes[idx]!
      pane.directPane.detach()
      stopCapture(pane.session.name)
      killSession(pane.session.name)
      this.clearPulse(sessionName)
      panes.splice(idx, 1)

      if (tabId === this._activeTabId) {
        const fi = this.tabFocus.get(tabId) ?? 0
        if (fi >= panes.length) this.tabFocus.set(tabId, Math.max(0, panes.length - 1))
        // Reset expand states if they reference removed pane
        const ei = this.tabExpanded.get(tabId) ?? -1
        if (ei >= panes.length || ei === idx) this.tabExpanded.set(tabId, -1)
        const si = this.tabSoftExpand.get(tabId) ?? -1
        if (si >= panes.length || si === idx) this.tabSoftExpand.set(tabId, -1)
        this.repositionAll()
      }
      return
    }
  }

  // ─── Focus ─────────────────────────────────────────────

  setFocus(index: number) {
    if (index < 0 || index >= this.panes.length) return
    const prev = this._focusIndex
    this._focusIndex = index
    this.drawChrome()
    // TTS announce project name on focus change
    if (prev !== index && this.panes.length > 1) {
      const pane = this.panes[index]
      if (pane) announcePaneName(pane.session.projectName)
    }
  }

  focusNext() {
    if (this.panes.length === 0) return
    this.setFocus((this._focusIndex + 1) % this.panes.length)
  }

  focusPrev() {
    if (this.panes.length === 0) return
    this.setFocus((this._focusIndex - 1 + this.panes.length) % this.panes.length)
  }

  swapPane(dir: "up" | "down" | "left" | "right") {
    const n = this.panes.length
    if (n <= 1) return
    const { cols } = this.calcGrid(n)
    const rows = Math.ceil(n / cols)
    const curCol = this._focusIndex % cols
    const curRow = Math.floor(this._focusIndex / cols)
    let nc = curCol, nr = curRow
    switch (dir) {
      case "left":  nc = curCol - 1; break
      case "right": nc = curCol + 1; break
      case "up":    nr = curRow - 1; break
      case "down":  nr = curRow + 1; break
    }
    if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) return
    const targetIdx = nr * cols + nc
    if (targetIdx < 0 || targetIdx >= n) return
    const panes = this.tabPanes.get(this._activeTabId)
    if (!panes) return
    const tmp = panes[this._focusIndex]!
    panes[this._focusIndex] = panes[targetIdx]!
    panes[targetIdx] = tmp
    this._focusIndex = targetIdx
    this.repositionAll()
  }

  focusByDirection(dir: "up" | "down" | "left" | "right") {
    // Weighted grid keeps same positions — use standard grid nav for both modes
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
    if (this.isSoftExpanded) {
      // Hit-test against actual pane positions in soft expand layout
      for (let i = 0; i < this.panes.length; i++) {
        const dp = this.panes[i]!.directPane
        const bx = dp.screenX - 1
        const by = dp.screenY - 3
        const bw = dp.width + 2
        const bh = dp.height + 4
        if (col >= bx && col < bx + bw && row >= by && row < by + bh) {
          this.setFocus(i)
          return true
        }
      }
      return false
    }

    const n = this.panes.length
    if (n === 0) return false
    const termW = process.stdout.columns || 120
    const termH = process.stdout.rows || 40
    const chromeTop = 3
    const { cols } = this.calcGrid(n)
    const rows = Math.ceil(n / cols)
    const cellW = Math.floor(termW / cols)
    const cellH = Math.floor((termH - chromeTop - 1) / rows)
    const gc = Math.floor((col - 1) / cellW)
    const gr = Math.floor((row - chromeTop) / cellH)
    const idx = gr * cols + gc
    if (idx >= 0 && idx < n) {
      this.setFocus(idx)
      return true
    }
    return false
  }

  // Determine which pane index was clicked (for soft expand)
  getPaneIndexAtClick(col: number, row: number): number {
    if (this.isSoftExpanded) {
      for (let i = 0; i < this.panes.length; i++) {
        const dp = this.panes[i]!.directPane
        const bx = dp.screenX - 1
        const by = dp.screenY - 3
        const bw = dp.width + 2
        const bh = dp.height + 4
        if (col >= bx && col < bx + bw && row >= by && row < by + bh) return i
      }
      return -1
    }
    const n = this.panes.length
    if (n === 0) return -1
    const termW = process.stdout.columns || 120
    const termH = process.stdout.rows || 40
    const chromeTop = 3
    const { cols } = this.calcGrid(n)
    const rows = Math.ceil(n / cols)
    const cellW = Math.floor(termW / cols)
    const cellH = Math.floor((termH - chromeTop - 1) / rows)
    const gc = Math.floor((col - 1) / cellW)
    const gr = Math.floor((row - chromeTop) / cellH)
    const idx = gr * cols + gc
    return (idx >= 0 && idx < n) ? idx : -1
  }

  // ─── Usage bars for footer ────────────────────────────

  private fmtUsageBars(): string {
    const u = app.cachedUsage
    if (!u) return ""
    const BAR_W = 10
    const sPct = pct(u.totalCost, PLAN_LIMITS.session)
    const sBar = makeBar(u.totalCost, PLAN_LIMITS.session, BAR_W)
    const wPct = pct(u.weekTotal, PLAN_LIMITS.weeklyAll)
    const wBar = makeBar(u.weekTotal, PLAN_LIMITS.weeklyAll, BAR_W)
    const sClr = sPct >= 80 ? hexFg("#e0af68") : sPct >= 50 ? hexFg("#7dcfff") : hexFg("#9ece6a")
    const wClr = wPct >= 80 ? hexFg("#e0af68") : wPct >= 50 ? hexFg("#7dcfff") : hexFg("#9ece6a")
    return `${DIM}ses${RESET} ${sClr}${sBar}${RESET} ${BOLD}${sPct}%${RESET} ${DIM}│ wk${RESET} ${wClr}${wBar}${RESET} ${BOLD}${wPct}%${RESET}`
  }

  // ─── Chrome ────────────────────────────────────────────

  drawChrome() {
    if (!this.running) return
    const termW = process.stdout.columns || 120
    const termH = process.stdout.rows || 40

    let out = SYNC_START

    // Tab bar (row 1) — includes inline pane names
    out += this.drawTabBar(termW)

    // Header (row 2)
    const n = this.panes.length
    const fi = this._focusIndex + 1
    let headerLeft: string, headerRight: string
    if (this.isExpanded) {
      headerLeft = `  ${BOLD}cladm grid${RESET} — ${hexFg("#7dcfff")}${BOLD}EXPANDED${RESET} │ ${fi}/${n}`
      headerRight = `${DIM}${hexFg("#f7768e")}[●]${RESET}${DIM} close │ ${hexFg("#e0af68")}[●]${RESET}${DIM} restore │ ctrl+s textedit │ ctrl+space picker${RESET}`
    } else if (this.isSoftExpanded) {
      headerLeft = `  ${BOLD}cladm grid${RESET} — ${hexFg("#bb9af7")}${BOLD}FOCUS${RESET} │ ${fi}/${n}`
      headerRight = `${DIM}click pane to focus │ ${hexFg("#9ece6a")}[●]${RESET}${DIM} fullscreen │ ctrl+s textedit │ ctrl+e toggle${RESET}`
    } else {
      headerLeft = `  ${BOLD}cladm grid${RESET} — ${n} sessions │ focus: ${fi}/${n}`
      headerRight = `${DIM}shift+arrows nav │ ${hexFg("#f7768e")}[●]${RESET}${DIM} close ${hexFg("#9ece6a")}[●]${RESET}${DIM} expand │ ctrl+s textedit │ ctrl+space picker${RESET}`
    }
    out += `\x1b[2;1H\x1b[${termW}X${headerLeft}   ${headerRight}`

    // Pane borders + titles
    if (this.isExpanded) {
      out += this.drawPaneBorder(this._expandedIndex)
    } else {
      for (let i = 0; i < this.panes.length; i++) {
        out += this.drawPaneBorder(i)
      }
    }

    // Footer (last row) — usage bars + scratch button
    const pane = this.focusedPane
    const usageStr = this.fmtUsageBars()
    const scratchLabel = `${hexFg("#9ece6a")}[+ claude]${RESET}`
    const scratchVisLen = 10
    const scratchStart = termW - scratchVisLen
    this.scratchBtnHit = { startCol: scratchStart, endCol: termW }

    out += `\x1b[${termH};1H\x1b[${termW}X`
    if (this.isExpanded && pane) {
      const color = getColor(pane.session.colorIndex)
      out += `  ${hexFg(color)}▸${RESET} ${BOLD}${pane.session.projectName}${RESET}   ${DIM}expanded${RESET}`
    } else if (pane) {
      const color = getColor(pane.session.colorIndex)
      const sid = pane.session.sessionId ? ` ${DIM}#${pane.session.sessionId.slice(0, 8)}${RESET}` : ""
      out += `  ${hexFg(color)}▸${RESET} ${BOLD}${pane.session.projectName}${RESET}${sid}`
    } else {
      out += `  ${DIM}No sessions${RESET}`
    }
    // Usage bars — right-aligned before scratch button
    if (usageStr) {
      const usageCol = scratchStart - 42 // enough room for bars
      if (usageCol > 20) out += `\x1b[${termH};${usageCol}H${usageStr}`
    }
    out += `\x1b[${termH};${scratchStart}H${scratchLabel}`

    out += SYNC_END
    this.writeRaw(out)
  }

  private drawTabBar(termW: number): string {
    this.tabBarHitRegions = []
    this.tabCloseHitRegions = []
    this.paneListHitRegions = []
    this.tabBarAddBtnCol = -1

    const RED_FG = hexFg("#f7768e")
    const TAB_BG_ACTIVE = hexBg("#24283b")
    const TAB_BORDER = hexFg("#3b4261")

    let out = `\x1b[1;1H\x1b[${termW}X`
    let col = 1

    // Picker tab (id = -1, meaning: switch to picker)
    const pickerActive = app.viewMode === "picker"
    if (pickerActive) {
      out += `${TAB_BORDER}╭${RESET}${TAB_BG_ACTIVE} ${CYAN_FG}${BOLD}● Picker${RESET}${TAB_BG_ACTIVE} ${RESET}${TAB_BORDER}╮${RESET}`
    } else {
      out += ` ${DIM}○ Picker${RESET} `
    }
    const pickerStart = pickerActive ? col + 1 : col + 1
    this.tabBarHitRegions.push({ tabId: -1, startCol: pickerStart, endCol: pickerStart + 7 })
    col += 10

    // Grid tabs — inline pane names instead of tab names
    for (const tab of app.gridTabs) {
      const isActive = this._activeTabId === tab.id && app.viewMode === "grid"
      const isPending = this._pendingCloseTabId === tab.id
      const tabPanes = this.tabPanes.get(tab.id) ?? []

      // Build pane name list for this tab
      const paneLabels: { name: string, color: string, status: PaneStatus, isFocused: boolean, isPulsing: boolean }[] = []
      for (let pi = 0; pi < tabPanes.length; pi++) {
        const p = tabPanes[pi]!
        const name = p.session.projectName
        const short = name.length > 14 ? name.slice(0, 12) + "…" : name
        paneLabels.push({
          name: short,
          color: getColor(p.session.colorIndex),
          status: p.status,
          isFocused: isActive && this._focusIndex === pi,
          isPulsing: this.pulseTimers.has(p.session.name),
        })
      }

      // Close button text
      const closeText = isPending ? `${RED_FG}${BOLD}[●]${RESET}` : `${DIM}[×]${RESET}`
      const closeVisLen = 3

      const tabStartCol = col

      if (isActive) {
        // Active tab: ╭ ● pane1 · ◉ pane2  × ╮
        out += `${TAB_BORDER}╭${RESET}${TAB_BG_ACTIVE} `
        col += 2 // ╭ + space

        for (let pi = 0; pi < paneLabels.length; pi++) {
          const pl = paneLabels[pi]!
          const pulseOn = pl.isPulsing && Math.floor(Date.now() / 500) % 2 === 0
          let icon: string
          if (pl.status === "busy") icon = `${hexFg("#9ece6a")}●${RESET}`
          else if (pl.status === "idle" && pulseOn) icon = `${hexFg("#ff9e64")}${BOLD}◉${RESET}`
          else if (pl.status === "idle") icon = `${hexFg("#e0af68")}◉${RESET}`
          else icon = `${DIM}○${RESET}`

          const paneStartCol = col
          if (pl.isFocused) {
            out += `${TAB_BG_ACTIVE}${icon} ${hexFg(pl.color)}${BOLD}${pl.name}${RESET}`
          } else if (pulseOn) {
            out += `${TAB_BG_ACTIVE}${icon} ${hexFg("#ff9e64")}${pl.name}${RESET}`
          } else {
            out += `${TAB_BG_ACTIVE}${icon} ${DIM}${pl.name}${RESET}`
          }
          col += 2 + pl.name.length // icon + space + name
          this.paneListHitRegions.push({ tabId: tab.id, paneIndex: pi, startCol: paneStartCol, endCol: col - 1 })

          if (pi < paneLabels.length - 1) {
            out += `${TAB_BG_ACTIVE}${DIM} · ${RESET}`
            col += 3
          }
        }

        if (paneLabels.length === 0) {
          out += `${TAB_BG_ACTIVE}${DIM}empty${RESET}`
          col += 5
        }

        out += `${TAB_BG_ACTIVE} ${closeText}${TAB_BG_ACTIVE} ${RESET}${TAB_BORDER}╮${RESET}`
        const closeStartCol = col + 1
        col += 1 + closeVisLen + 1 + 1 // space + [×] + space + ╮
        this.tabCloseHitRegions.push({ tabId: tab.id, startCol: closeStartCol, endCol: closeStartCol + closeVisLen - 1 })
        this.tabBarHitRegions.push({ tabId: tab.id, startCol: tabStartCol, endCol: col - 1 })
      } else {
        // Inactive tab: ○ pane1 · pane2  × │
        const hasIdle = this.hasIdleInTab(tab.id)
        out += ` `
        col += 1

        for (let pi = 0; pi < paneLabels.length; pi++) {
          const pl = paneLabels[pi]!
          const pulseOn = pl.isPulsing && Math.floor(Date.now() / 500) % 2 === 0
          let icon: string
          if (pl.status === "idle" && pulseOn) icon = `${hexFg("#ff9e64")}${BOLD}◉${RESET}`
          else if (pl.status === "idle") icon = `${YELLOW_FG}◉${RESET}`
          else if (pl.status === "busy") icon = `${DIM}●${RESET}`
          else icon = `${DIM}○${RESET}`

          const paneStartCol = col
          if (pulseOn) {
            out += `${icon} ${hexFg("#ff9e64")}${pl.name}${RESET}`
          } else {
            out += `${icon} ${DIM}${pl.name}${RESET}`
          }
          col += 2 + pl.name.length
          this.paneListHitRegions.push({ tabId: tab.id, paneIndex: pi, startCol: paneStartCol, endCol: col - 1 })

          if (pi < paneLabels.length - 1) {
            out += `${DIM} · ${RESET}`
            col += 3
          }
        }

        if (paneLabels.length === 0) {
          out += `${DIM}empty${RESET}`
          col += 5
        }

        out += ` ${closeText} ${DIM}│${RESET}`
        const closeStartCol = col + 1
        col += 1 + closeVisLen + 1 + 1 // space + [×] + space + │
        this.tabCloseHitRegions.push({ tabId: tab.id, startCol: closeStartCol, endCol: closeStartCol + closeVisLen - 1 })
        this.tabBarHitRegions.push({ tabId: tab.id, startCol: tabStartCol, endCol: col - 1 })
      }
    }

    // [+] button
    out += ` ${DIM}[+]${RESET}`
    col += 1
    this.tabBarAddBtnCol = col
    col += 3

    return out
  }



  private drawPaneBorder(index: number): string {
    const pane = this.panes[index]!
    const dp = pane.directPane
    const isFocused = index === this._focusIndex
    const isPulsing = this.pulseTimers.has(pane.session.name)
    const isSoftExp = this._softExpandIndex === index

    const color = getColor(pane.session.colorIndex)
    // During pulse: alternate between orange and pane color every 500ms
    const pulseOn = isPulsing && Math.floor(Date.now() / 500) % 2 === 0
    let borderColor: string
    if (isFocused) borderColor = WHITE
    else if (isSoftExp) borderColor = hexFg("#bb9af7")
    else if (pulseOn) borderColor = hexFg("#ff9e64")
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

    // Top border with traffic-light buttons — framed for visibility
    const RED_BTN = `${hexFg("#f7768e")}[●]${RESET}`       // close pane
    const YELLOW_BTN = `${hexFg("#e0af68")}[●]${RESET}`    // minimize / collapse
    const GREEN_BTN = `${hexFg("#9ece6a")}[●]${RESET}`     // expand / maximize
    const DIM_BTN = `${DIM}[●]${RESET}`

    const BLUE_BTN = `${hexFg("#7dcfff")}[●]${RESET}`     // open folder
    const CYAN_PLUS = `${hexFg("#7dcfff")}[+]${RESET}`   // new session

    let btnSection: string
    let btnVisibleLen: number
    let leftSection = ""
    let leftVisibleLen = 0
    if (this.isExpanded) {
      // Expanded: new-session · folder · gap · select · minimize · close
      btnSection = `${borderColor}${hz}${RESET}${CYAN_PLUS}${borderColor} ${hz}${RESET}${BLUE_BTN}${borderColor} ${hz}${RESET}${DIM_BTN} ${YELLOW_BTN} ${RED_BTN}${borderColor}`
      btnVisibleLen = 1 + 3 + 1 + 1 + 3 + 1 + 1 + 3 + 1 + 3 + 1 + 3 // ─[+] ─[●] ─[●] [●] [●]
    } else {
      // Grid: new-session · folder · gap · textedit · expand · close
      btnSection = `${borderColor}${hz}${RESET}${CYAN_PLUS}${borderColor} ${hz}${RESET}${BLUE_BTN}${borderColor} ${hz}${RESET}${DIM_BTN} ${GREEN_BTN} ${RED_BTN}${borderColor}`
      btnVisibleLen = 1 + 3 + 1 + 1 + 3 + 1 + 1 + 3 + 1 + 3 + 1 + 3 // ─[+] ─[●] ─[●] [●] [●]
      // Arrow buttons on left for pane reordering (only in grid with 2+ panes)
      if (this.panes.length > 1) {
        leftSection = `${borderColor}${hz}${RESET}${DIM}[◀] [▲] [▼] [▶]${RESET}${borderColor}`
        leftVisibleLen = 1 + 15 // ─[◀] [▲] [▼] [▶]
      }
    }
    const hzFill = Math.max(0, bw - 2 - btnVisibleLen - leftVisibleLen - 1)
    out += `\x1b[${by};${bx}H${borderColor}${tl}${leftSection}${hz.repeat(hzFill)}${btnSection}${hz}${tr}${RESET}`

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

    // Side borders for content rows + scrollbar on right border
    const scrollInfo = getScrollInfo(pane.session.name)
    const hasScrollbar = scrollInfo !== null && scrollInfo.scrollbackLength > 0
    let thumbTop = 0, thumbSize = 0
    if (hasScrollbar) {
      const trackHeight = dp.height
      const totalLines = scrollInfo.scrollbackLength + scrollInfo.screenHeight
      thumbSize = Math.max(1, Math.floor(trackHeight * trackHeight / totalLines))
      const maxScroll = scrollInfo.scrollbackLength
      thumbTop = maxScroll > 0
        ? Math.floor((maxScroll - scrollInfo.offset) / maxScroll * (trackHeight - thumbSize))
        : trackHeight - thumbSize
    }

    for (let r = 0; r < dp.height; r++) {
      out += `\x1b[${dp.screenY + r};${bx}H${borderColor}${vt}${RESET}`
      out += `\x1b[${dp.screenY + r};${bx + bw - 1}H${borderColor}${vt}${RESET}`
      if (hasScrollbar) {
        // Draw scrollbar inside the frame, one column left of the right border
        const scrollCol = bx + bw - 2
        const isThumb = r >= thumbTop && r < thumbTop + thumbSize
        if (isThumb) {
          const thumbColor = isFocused ? WHITE : hexFg(color)
          out += `\x1b[${dp.screenY + r};${scrollCol}H${thumbColor}█${RESET}`
        } else {
          out += `\x1b[${dp.screenY + r};${scrollCol}H${DIM}░${RESET}`
        }
      }
    }

    // Bottom border
    out += `\x1b[${by + bh - 1};${bx}H${borderColor}${bl}${hz.repeat(bw - 2)}${br}${RESET}`

    return out
  }

  // ─── Scrollbar hit-test ──────────────────────────────────

  checkScrollbarClick(col: number, row: number): { paneIndex: number, sessionName: string, trackTop: number, trackHeight: number, thumbSize: number, scrollbackLength: number } | null {
    const indicesToCheck = this.isExpanded ? [this._expandedIndex] : this.panes.map((_, i) => i)
    for (const i of indicesToCheck) {
      const pane = this.panes[i]
      if (!pane) continue
      const dp = pane.directPane
      const bx = dp.screenX - 1
      const bw = dp.width + 2
      const scrollCol = bx + bw - 2  // one column inside the right border

      if (col !== scrollCol) continue
      if (row < dp.screenY || row >= dp.screenY + dp.height) continue

      const scrollInfo = getScrollInfo(pane.session.name)
      if (!scrollInfo || scrollInfo.scrollbackLength <= 0) continue

      const trackHeight = dp.height
      const totalLines = scrollInfo.scrollbackLength + scrollInfo.screenHeight
      const thumbSize = Math.max(1, Math.floor(trackHeight * trackHeight / totalLines))

      return {
        paneIndex: i,
        sessionName: pane.session.name,
        trackTop: dp.screenY,
        trackHeight,
        thumbSize,
        scrollbackLength: scrollInfo.scrollbackLength,
      }
    }
    return null
  }

  scrollbarRowToOffset(trackTop: number, trackHeight: number, thumbSize: number, scrollbackLength: number, mouseRow: number): number {
    const relRow = mouseRow - trackTop
    const maxThumbTop = trackHeight - thumbSize
    if (maxThumbTop <= 0) return 0
    // Center the thumb on the click point
    const thumbTop = Math.max(0, Math.min(relRow - Math.floor(thumbSize / 2), maxThumbTop))
    // thumbTop=0 → offset=scrollbackLength (top), thumbTop=maxThumbTop → offset=0 (bottom/live)
    return Math.round(scrollbackLength * (1 - thumbTop / maxThumbTop))
  }

  // ─── Content rendering ─────────────────────────────────

  private drawPane(index: number, lines: string[]) {
    if (this.isExpanded && index !== this._expandedIndex) return
    const pane = this.panes[index]
    if (!pane) return
    const frame = pane.directPane.buildFrame(lines)
    this.writeRaw(SYNC_START + frame + SYNC_END)
  }

  forceRedrawAll() {
    if (!this.running) return
    for (let i = 0; i < this.panes.length; i++) {
      const pane = this.panes[i]!
      resetHash(`dp_${pane.session.name}`)
      const frame = getLatestFrame(pane.session.name)
      if (frame) this.drawPane(i, frame.lines)
    }
    this.drawChrome()
  }

  // ─── Input ─────────────────────────────────────────────

  sendInputToFocused(rawSequence: string) {
    const pane = this.focusedPane
    if (!pane) return
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
    scrollPane(pane.session.name, direction, lines)
    this.drawChrome()
  }

  // ─── Status ────────────────────────────────────────────

  markIdle(sessionName: string) {
    const pane = this.findPaneAcrossTabs(sessionName)
    if (!pane) return
    if (pane.status !== "idle") { pane.status = "idle"; pane.statusSince = Date.now() }
    this.startPulse(sessionName)
    this.drawChrome()
  }

  markBusy(sessionName: string) {
    const pane = this.findPaneAcrossTabs(sessionName)
    if (!pane) return
    if (pane.status !== "busy") { pane.status = "busy"; pane.statusSince = Date.now() }
    this.clearPulse(sessionName)
    this.drawChrome()
  }

  clearMark(sessionName: string) {
    const pane = this.findPaneAcrossTabs(sessionName)
    if (!pane) return
    pane.status = null; pane.statusSince = 0
    this.clearPulse(sessionName)
    this.drawChrome()
  }

  private findPaneAcrossTabs(sessionName: string): GridPaneInfo | null {
    for (const [, panes] of this.tabPanes) {
      const p = panes.find(p => p.session.name === sessionName)
      if (p) return p
    }
    return null
  }

  isPulsing(sessionName: string): boolean {
    return this.pulseTimers.has(sessionName)
  }

  private startPulse(sessionName: string) {
    if (this.pulseTimers.has(sessionName)) return
    const timer = setInterval(() => this.drawChrome(), 500)
    this.pulseTimers.set(sessionName, timer)
    // Auto-stop after 10 seconds
    const stopTimer = setTimeout(() => {
      this.clearPulse(sessionName)
      this.drawChrome()
    }, 10_000)
    this.pulseStopTimers.set(sessionName, stopTimer)
  }

  private clearPulse(sessionName: string) {
    const timer = this.pulseTimers.get(sessionName)
    if (timer) { clearInterval(timer); this.pulseTimers.delete(sessionName) }
    const stopTimer = this.pulseStopTimers.get(sessionName)
    if (stopTimer) { clearTimeout(stopTimer); this.pulseStopTimers.delete(sessionName) }
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
    const chromeTop = 3 // row 1 = tab bar (with inline panes), row 2 = header, content starts row 3
    const { cols, rows } = this.calcGrid(n)
    const cellW = Math.floor(termW / cols)
    const cellH = Math.floor((termH - chromeTop - 1) / rows) // -1 for footer

    const regions: { screenX: number, screenY: number, contentW: number, contentH: number }[] = []
    for (let i = 0; i < n; i++) {
      const gc = i % cols
      const gr = Math.floor(i / cols)
      const contentW = cellW - 2
      const contentH = cellH - 4
      const screenX = gc * cellW + 2
      const screenY = chromeTop + gr * cellH + 3
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
    const termW = process.stdout.columns || 120
    const termH = process.stdout.rows || 40
    const chromeTop = 3

    if (this.isExpanded) {
      // Fullscreen: expanded pane gets all space
      const contentW = termW - 2
      const contentH = termH - chromeTop - 1 - 4  // -1 footer, -4 border chrome
      const pane = this.panes[this._expandedIndex]!
      pane.directPane.reposition(2, chromeTop + 3, Math.max(contentW, 10), Math.max(contentH, 2))
      resizeSession(pane.session.name, Math.max(contentW, 10), Math.max(contentH, 2))
      resizeCapture(pane.session.name, Math.max(contentW, 10), Math.max(contentH, 2))
      resetHash(`dp_${pane.session.name}`)
    } else if (this.isSoftExpanded) {
      // Weighted grid: focused pane's col/row get 70%, others split the rest
      const sei = this._softExpandIndex
      const n = this.panes.length
      const { cols, rows } = this.calcGrid(n)
      const focusCol = sei % cols
      const focusRow = Math.floor(sei / cols)
      const availW = termW
      const availH = termH - chromeTop - 1

      // Compute column widths: focused col gets 70%, others split 30%
      const colWidths: number[] = []
      const otherCols = cols - 1
      const focusColW = otherCols > 0 ? Math.floor(availW * 0.7) : availW
      const otherColW = otherCols > 0 ? Math.floor((availW - focusColW) / otherCols) : 0
      for (let c = 0; c < cols; c++) colWidths.push(c === focusCol ? focusColW : otherColW)

      // Compute row heights: focused row gets 70%, others split 30%
      const rowHeights: number[] = []
      const otherRows = rows - 1
      const focusRowH = otherRows > 0 ? Math.floor(availH * 0.7) : availH
      const otherRowH = otherRows > 0 ? Math.floor((availH - focusRowH) / otherRows) : 0
      for (let r = 0; r < rows; r++) rowHeights.push(r === focusRow ? focusRowH : otherRowH)

      // Compute column X offsets
      const colX: number[] = [0]
      for (let c = 1; c < cols; c++) colX.push(colX[c - 1]! + colWidths[c - 1]!)

      // Compute row Y offsets
      const rowY: number[] = [0]
      for (let r = 1; r < rows; r++) rowY.push(rowY[r - 1]! + rowHeights[r - 1]!)

      for (let i = 0; i < n; i++) {
        const gc = i % cols
        const gr = Math.floor(i / cols)
        const contentW = Math.max(colWidths[gc]! - 2, 10)
        const contentH = Math.max(rowHeights[gr]! - 4, 2)
        const screenX = colX[gc]! + 2
        const screenY = chromeTop + rowY[gr]! + 3
        const pane = this.panes[i]!
        pane.directPane.reposition(screenX, screenY, contentW, contentH)
        resizeSession(pane.session.name, contentW, contentH)
        resizeCapture(pane.session.name, contentW, contentH)
        resetHash(`dp_${pane.session.name}`)
      }
    } else {
      // Equal grid
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
    this.tabPanes.clear()
    this.tabFocus.clear()
    this.tabExpanded.clear()
    this.tabSoftExpand.clear()
    this._activeTabId = -1
  }
}
