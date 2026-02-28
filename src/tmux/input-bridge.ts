// Forwards raw terminal input to tmux sessions via a persistent shell.
// Zero process-spawn overhead per keystroke — writes to stdin of a long-lived sh.

import type { Subprocess } from "bun"

let shell: Subprocess<"ignore", "pipe", "ignore"> | null = null

function getShell() {
  if (shell && !shell.killed) return shell
  shell = Bun.spawn(["sh"], {
    stdin: "pipe",
    stdout: "ignore",
    stderr: "ignore",
  })
  return shell
}

export function sendKeys(sessionName: string, rawSequence: string): void {
  const sh = getShell()
  const special = mapSpecialSequence(rawSequence)

  let cmd: string
  if (special) {
    cmd = `tmux send-keys -t '${sessionName}' ${special}\n`
  } else {
    const hex = [...rawSequence].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ")
    cmd = `tmux send-keys -t '${sessionName}' -H ${hex}\n`
  }

  sh.stdin.write(cmd)
}

// Forward mouse events to tmux as SGR escape sequences
export function sendMouseEvent(sessionName: string, x: number, y: number, btn: number, release: boolean): void {
  const sh = getShell()
  const end = release ? "m" : "M"
  const seq = `\x1b[<${btn};${x};${y}${end}`
  const hex = [...seq].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ")
  const cmd = `tmux send-keys -t '${sessionName}' -H ${hex}\n`
  sh.stdin.write(cmd)
}

// Scroll a tmux pane using copy-mode (works with any application in the pane)
export function sendScroll(sessionName: string, direction: "up" | "down", lines = 3): void {
  const sh = getShell()
  if (direction === "up") {
    // Enter copy mode (no-op if already in it) then scroll up
    sh.stdin.write(`tmux copy-mode -t '${sessionName}' 2>/dev/null; tmux send-keys -t '${sessionName}' -X -N ${lines} scroll-up 2>/dev/null\n`)
  } else {
    // Scroll down in copy mode; if we hit bottom, exit copy mode
    sh.stdin.write(`tmux send-keys -t '${sessionName}' -X -N ${lines} scroll-down 2>/dev/null\n`)
  }
}

// Exit copy mode (e.g., when user starts typing)
export function exitCopyMode(sessionName: string): void {
  const sh = getShell()
  sh.stdin.write(`tmux send-keys -t '${sessionName}' -X cancel 2>/dev/null\n`)
}

export function cleanupInputQueue(_sessionName: string) {
  // No per-session cleanup needed with shared shell
}

export function destroyShell() {
  if (shell && !shell.killed) {
    shell.stdin.end()
    shell.kill()
  }
  shell = null
}

// Map known ANSI escape sequences to tmux key names
function mapSpecialSequence(seq: string): string | null {
  const MAP: Record<string, string> = {
    "\r": "Enter",
    "\n": "Enter",
    "\t": "Tab",
    "\x1b": "Escape",
    "\x7f": "BSpace",
    "\x1b[A": "Up",
    "\x1b[B": "Down",
    "\x1b[C": "Right",
    "\x1b[D": "Left",
    "\x1b[H": "Home",
    "\x1b[F": "End",
    "\x1b[3~": "DC",       // Delete
    "\x1b[5~": "PageUp",
    "\x1b[6~": "PageDown",
    "\x1b[2~": "IC",       // Insert
    "\x1bOP": "F1",
    "\x1bOQ": "F2",
    "\x1bOR": "F3",
    "\x1bOS": "F4",
    "\x1b[15~": "F5",
    "\x1b[17~": "F6",
    "\x1b[18~": "F7",
    "\x1b[19~": "F8",
    "\x1b[20~": "F9",
    "\x1b[21~": "F10",
    "\x1b[23~": "F11",
    "\x1b[24~": "F12",
    "\x1b[Z": "BTab",      // Shift-Tab
  }

  if (MAP[seq]) return MAP[seq]

  // Ctrl+letter: 0x01-0x1a → C-a through C-z
  if (seq.length === 1) {
    const code = seq.charCodeAt(0)
    if (code >= 1 && code <= 26) {
      return "C-" + String.fromCharCode(code + 96)
    }
  }

  return null
}
