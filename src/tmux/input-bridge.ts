// Forwards raw terminal input sequences to a tmux session

export async function sendKeys(sessionName: string, rawSequence: string): Promise<void> {
  // Use -l for literal text to avoid tmux key-name interpretation
  // But special keys need to be sent without -l
  const special = mapSpecialSequence(rawSequence)

  if (special) {
    const proc = Bun.spawn(["tmux", "send-keys", "-t", sessionName, special], {
      stdout: "ignore", stderr: "ignore",
    })
    await proc.exited
  } else {
    // Literal text - send as hex to avoid escaping issues
    const hexBytes = [...rawSequence].map(c => {
      const code = c.charCodeAt(0)
      return code.toString(16).padStart(2, "0")
    })
    const proc = Bun.spawn(["tmux", "send-keys", "-t", sessionName, "-H", ...hexBytes], {
      stdout: "ignore", stderr: "ignore",
    })
    await proc.exited
  }
}

// Map known ANSI escape sequences to tmux key names
function mapSpecialSequence(seq: string): string | null {
  // Common escape sequences -> tmux key names
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
