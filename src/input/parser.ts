// Extract only safe keyboard input from stdin data.
// WHITELIST approach: only recognized keyboard sequences pass through.
// Everything else (mouse events, terminal responses, OSC, DCS, etc.) is dropped.
export function extractKeyboardInput(data: string): string {
  let keyboard = ""
  let i = 0

  while (i < data.length) {
    const c = data.charCodeAt(i)

    // ESC sequences
    if (c === 0x1b) {
      if (i + 1 >= data.length) { keyboard += "\x1b"; i++; continue } // lone ESC = Escape key

      const next = data[i + 1]

      // OSC: \x1b] ... (terminated by BEL \x07 or ST \x1b\\) — drop entirely
      if (next === "]") {
        let j = i + 2
        while (j < data.length) {
          if (data[j] === "\x07") { j++; break }
          if (data[j] === "\x1b" && j + 1 < data.length && data[j + 1] === "\\") { j += 2; break }
          j++
        }
        i = j; continue
      }

      // DCS: \x1bP ... ST  |  APC: \x1b_ ... ST  |  PM: \x1b^ ... ST — drop entirely
      if (next === "P" || next === "_" || next === "^") {
        let j = i + 2
        while (j < data.length) {
          if (data[j] === "\x1b" && j + 1 < data.length && data[j + 1] === "\\") { j += 2; break }
          j++
        }
        i = j; continue
      }

      // CSI: \x1b[
      if (next === "[") {
        let j = i + 2
        // Consume parameter bytes (0x30-0x3F: digits, ;, <, =, >, ?)
        while (j < data.length && data.charCodeAt(j) >= 0x30 && data.charCodeAt(j) <= 0x3F) j++
        // Consume intermediate bytes (0x20-0x2F)
        while (j < data.length && data.charCodeAt(j) >= 0x20 && data.charCodeAt(j) <= 0x2F) j++
        // Final byte (0x40-0x7E)
        if (j < data.length && data.charCodeAt(j) >= 0x40 && data.charCodeAt(j) <= 0x7E) {
          const final = data[j]
          // Legacy X10 mouse: \x1b[M followed by 3 raw bytes (btn+32, col+32, row+32)
          if (final === "M" && j === i + 2) {
            i = Math.min(j + 4, data.length); continue
          }
          // ONLY keep: arrows (A-D), Home (H), End (F), shift-tab (Z), function keys (~)
          if ("ABCDHFZ~".includes(final)) {
            keyboard += data.slice(i, j + 1)
          }
          i = j + 1; continue
        }
        // Incomplete/malformed CSI — drop
        i = j; continue
      }

      // SS3: \x1bO + letter (F1-F4, keypad)
      if (next === "O" && i + 2 < data.length) {
        keyboard += data.slice(i, i + 3)
        i += 3; continue
      }

      // Alt+digit (1-9) and Alt+letter (n, p) — keep as keyboard shortcuts
      if ((next >= "1" && next <= "9") || next === "n" || next === "p") {
        keyboard += data.slice(i, i + 2)
        i += 2; continue
      }

      // Any other \x1b+char — drop (unknown escape sequence)
      i += 2; continue
    }

    // Regular character: printable ASCII, control chars, UTF-8 — keep
    keyboard += data[i]
    i++
  }

  return keyboard
}

// Parse SGR mouse events from raw data.
export function extractMouseEvents(data: string): { btn: number, col: number, row: number, release: boolean, start: number, end: number }[] {
  const events: { btn: number, col: number, row: number, release: boolean, start: number, end: number }[] = []
  const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g
  let m
  while ((m = re.exec(data)) !== null) {
    events.push({
      btn: parseInt(m[1]),
      col: parseInt(m[2]),
      row: parseInt(m[3]),
      release: m[4] === "m",
      start: m.index,
      end: m.index + m[0].length,
    })
  }
  return events
}
