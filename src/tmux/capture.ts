// Captures tmux pane content via persistent streaming subprocesses.
// Push-based: notifies subscribers immediately when new frames arrive.
// Zero polling overhead on the JS side — callbacks fire on stream data.

import type { Subprocess } from "bun"

export interface CaptureResult {
  lines: string[]
  cursorX: number
  cursorY: number
  width: number
  height: number
}

const SEP = "%%CLADM_FRAME%%"

type FrameCallback = (frame: CaptureResult) => void

interface PaneCapture {
  proc: Subprocess<"ignore", "pipe", "ignore">
  latest: CaptureResult | null
  buf: string
  callbacks: Set<FrameCallback>
}

const panes = new Map<string, PaneCapture>()

export function startCapture(sessionName: string, intervalMs = 100): void {
  if (panes.has(sessionName)) return

  const script = `while true; do
tmux capture-pane -t '${sessionName}' -p -e 2>/dev/null
echo '${SEP}'
tmux display-message -t '${sessionName}' -p '#{cursor_x} #{cursor_y} #{pane_width} #{pane_height}' 2>/dev/null
echo '${SEP}END'
sleep ${(intervalMs / 1000).toFixed(3)}
done`

  const proc = Bun.spawn(["sh", "-c", script], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  })

  const state: PaneCapture = { proc, latest: null, buf: "", callbacks: new Set() }
  panes.set(sessionName, state)

  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()

  ;(async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        state.buf += decoder.decode(value, { stream: true })
        processBuffer(sessionName, state)
      }
    } catch {
      // Process died
    }
  })()
}

function processBuffer(sessionName: string, state: PaneCapture) {
  while (true) {
    const endMarker = SEP + "END"
    const endIdx = state.buf.indexOf(endMarker)
    if (endIdx < 0) break

    const frame = state.buf.slice(0, endIdx)
    state.buf = state.buf.slice(endIdx + endMarker.length)
    if (state.buf.startsWith("\n")) state.buf = state.buf.slice(1)

    const sepIdx = frame.indexOf(SEP)
    if (sepIdx < 0) continue

    const contentText = frame.slice(0, sepIdx)
    const infoText = frame.slice(sepIdx + SEP.length).trim()

    const parts = infoText.split(" ")
    const cursorX = parseInt(parts[0] ?? "") || 0
    const cursorY = parseInt(parts[1] ?? "") || 0
    const width = parseInt(parts[2] ?? "") || 80
    const height = parseInt(parts[3] ?? "") || 24

    const lines = contentText.split("\n")
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

    state.latest = { lines, cursorX, cursorY, width, height }

    // Push to all subscribers immediately
    for (const cb of state.callbacks) {
      try { cb(state.latest) } catch {}
    }
  }
}

// Subscribe to frame updates. Returns unsubscribe function.
export function onFrame(sessionName: string, cb: FrameCallback): () => void {
  const state = panes.get(sessionName)
  if (state) state.callbacks.add(cb)
  // Unsub looks up current state (handles setCaptureRate restarts)
  return () => {
    const s = panes.get(sessionName)
    if (s) s.callbacks.delete(cb)
  }
}

export function getLatestFrame(sessionName: string): CaptureResult | null {
  return panes.get(sessionName)?.latest ?? null
}

export function stopCapture(sessionName: string): void {
  const state = panes.get(sessionName)
  if (!state) return
  if (!state.proc.killed) state.proc.kill()
  state.callbacks.clear()
  panes.delete(sessionName)
}

// Change capture rate without losing subscribers
export function setCaptureRate(sessionName: string, intervalMs: number): void {
  const state = panes.get(sessionName)
  if (!state) return
  const savedCallbacks = new Set(state.callbacks)
  stopCapture(sessionName)
  startCapture(sessionName, intervalMs)
  const newState = panes.get(sessionName)
  if (newState) {
    for (const cb of savedCallbacks) newState.callbacks.add(cb)
  }
}

export function stopAllCaptures(): void {
  for (const [name] of panes) stopCapture(name)
}

// Legacy one-shot capture (for non-grid use)
export async function capturePane(sessionName: string): Promise<CaptureResult | null> {
  const latest = getLatestFrame(sessionName)
  if (latest) return latest

  try {
    const proc = Bun.spawn(["sh", "-c",
      `tmux capture-pane -t '${sessionName}' -p -e && echo '${SEP}' && tmux display-message -t '${sessionName}' -p '#{cursor_x} #{cursor_y} #{pane_width} #{pane_height}'`
    ], { stdout: "pipe", stderr: "ignore" })

    const text = await new Response(proc.stdout).text()
    const code = await proc.exited
    if (code !== 0) return null

    const sepIdx = text.lastIndexOf(SEP)
    if (sepIdx < 0) return null

    const contentText = text.slice(0, sepIdx)
    const infoText = text.slice(sepIdx + SEP.length).trim()

    const parts = infoText.split(" ")
    const cursorX = parseInt(parts[0] ?? "") || 0
    const cursorY = parseInt(parts[1] ?? "") || 0
    const width = parseInt(parts[2] ?? "") || 80
    const height = parseInt(parts[3] ?? "") || 24

    const lines = contentText.split("\n")
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

    return { lines, cursorX, cursorY, width, height }
  } catch {
    return null
  }
}

// Hash for diffing — skip re-render if nothing changed
const lastHashes = new Map<string, number>()

export function hasChanged(lines: string[], key = "_default"): boolean {
  let h = 5381
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
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
