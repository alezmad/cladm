export interface CaptureResult {
  lines: string[]
  cursorX: number
  cursorY: number
  width: number
  height: number
}

export async function capturePane(sessionName: string): Promise<CaptureResult | null> {
  try {
    const [contentProc, infoProc] = [
      Bun.spawn(["tmux", "capture-pane", "-t", sessionName, "-p", "-e"], { stdout: "pipe", stderr: "ignore" }),
      Bun.spawn(["tmux", "display-message", "-t", sessionName, "-p", "#{cursor_x} #{cursor_y} #{pane_width} #{pane_height}"], { stdout: "pipe", stderr: "ignore" }),
    ]

    const [contentText, infoText] = await Promise.all([
      new Response(contentProc.stdout).text(),
      new Response(infoProc.stdout).text(),
    ])

    const [codeContent, codeInfo] = await Promise.all([contentProc.exited, infoProc.exited])
    if (codeContent !== 0 || codeInfo !== 0) return null

    const parts = infoText.trim().split(" ")
    const cursorX = parseInt(parts[0]) || 0
    const cursorY = parseInt(parts[1]) || 0
    const width = parseInt(parts[2]) || 80
    const height = parseInt(parts[3]) || 24

    const lines = contentText.split("\n")
    // Remove trailing empty line from split
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

    return { lines, cursorX, cursorY, width, height }
  } catch {
    return null
  }
}

// Hash for diffing - skip re-render if nothing changed
let lastHash = ""

export function hasChanged(lines: string[]): boolean {
  // Simple fast hash: join first+last few lines + length
  const h = lines.length + ":" + (lines[0] || "") + (lines[lines.length - 1] || "")
  if (h === lastHash) return false
  lastHash = h
  return true
}

export function resetHash() {
  lastHash = ""
}
