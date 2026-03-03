import { RGBA, TextAttributes } from "@opentui/core"

export interface TermCell {
  char: string
  fg: RGBA
  bg: RGBA
  attrs: number
}

export interface ParsedFrame {
  cells: TermCell[][]
  width: number
  height: number
}

// Standard 16 ANSI colors (Tokyo Night palette)
const ANSI_16: [number, number, number][] = [
  [0x1a, 0x1b, 0x26],   // 0 black
  [0xf7, 0x76, 0x8e],   // 1 red
  [0x9e, 0xce, 0x6a],   // 2 green
  [0xe0, 0xaf, 0x68],   // 3 yellow
  [0x7a, 0xa2, 0xf7],   // 4 blue
  [0xbb, 0x9a, 0xf7],   // 5 magenta
  [0x7d, 0xcf, 0xff],   // 6 cyan
  [0xa9, 0xb1, 0xd6],   // 7 white
  [0x56, 0x5f, 0x89],   // 8 bright black
  [0xf7, 0x76, 0x8e],   // 9 bright red
  [0x9e, 0xce, 0x6a],   // 10 bright green
  [0xe0, 0xaf, 0x68],   // 11 bright yellow
  [0x7a, 0xa2, 0xf7],   // 12 bright blue
  [0xbb, 0x9a, 0xf7],   // 13 bright magenta
  [0x7d, 0xcf, 0xff],   // 14 bright cyan
  [0xc0, 0xca, 0xf5],   // 15 bright white
]

const DEFAULT_FG = RGBA.fromInts(0xc0, 0xca, 0xf5, 255)
const DEFAULT_BG = RGBA.fromInts(0x1a, 0x1b, 0x26, 255)

function color256(n: number): RGBA {
  if (n < 16) {
    const [r, g, b] = ANSI_16[n]!
    return RGBA.fromInts(r, g, b, 255)
  }
  if (n < 232) {
    const idx = n - 16
    const r = Math.floor(idx / 36) * 51
    const g = Math.floor((idx % 36) / 6) * 51
    const b = (idx % 6) * 51
    return RGBA.fromInts(r, g, b, 255)
  }
  const v = 8 + (n - 232) * 10
  return RGBA.fromInts(v, v, v, 255)
}

export function parseAnsiFrame(lines: string[], width: number, height: number): ParsedFrame {
  const cells: TermCell[][] = []

  for (let row = 0; row < height; row++) {
    const line = row < lines.length ? lines[row]! : ""
    const rowCells = parseLine(line, width)
    cells.push(rowCells)
  }

  return { cells, width, height }
}

function parseLine(line: string, width: number): TermCell[] {
  const cells: TermCell[] = []
  let currentFg = DEFAULT_FG
  let currentBg = DEFAULT_BG
  let currentAttrs = TextAttributes.NONE
  let i = 0
  let col = 0

  while (i < line.length && col < width) {
    if (line[i] === "\x1b" && i + 1 < line.length && line[i + 1] === "[") {
      // Parse CSI sequence
      i += 2
      const params: number[] = []
      let num = ""

      while (i < line.length) {
        const ch = line[i]!
        if (ch >= "0" && ch <= "9") {
          num += ch
          i++
        } else if (ch === ";") {
          params.push(num === "" ? 0 : parseInt(num, 10))
          num = ""
          i++
        } else {
          params.push(num === "" ? 0 : parseInt(num, 10))
          i++
          if (ch === "m") {
            applyParams(params)
          }
          // Ignore other CSI sequences (cursor movement, etc.)
          break
        }
      }
      continue
    }

    cells.push({ char: line[i]!, fg: currentFg, bg: currentBg, attrs: currentAttrs })
    col++
    i++
  }

  // Pad remaining columns
  while (col < width) {
    cells.push({ char: " ", fg: DEFAULT_FG, bg: DEFAULT_BG, attrs: TextAttributes.NONE })
    col++
  }

  return cells

  function applyParams(params: number[]) {
    let j = 0
    while (j < params.length) {
      const p = params[j]
      switch (p) {
        case 0:
          currentFg = DEFAULT_FG
          currentBg = DEFAULT_BG
          currentAttrs = TextAttributes.NONE
          break
        case 1: currentAttrs |= TextAttributes.BOLD; break
        case 2: currentAttrs |= TextAttributes.DIM; break
        case 3: currentAttrs |= TextAttributes.ITALIC; break
        case 4: currentAttrs |= TextAttributes.UNDERLINE; break
        case 5: currentAttrs |= TextAttributes.BLINK; break
        case 7: currentAttrs |= TextAttributes.INVERSE; break
        case 8: currentAttrs |= TextAttributes.HIDDEN; break
        case 9: currentAttrs |= TextAttributes.STRIKETHROUGH; break
        case 22: currentAttrs &= ~(TextAttributes.BOLD | TextAttributes.DIM); break
        case 23: currentAttrs &= ~TextAttributes.ITALIC; break
        case 24: currentAttrs &= ~TextAttributes.UNDERLINE; break
        case 27: currentAttrs &= ~TextAttributes.INVERSE; break
        case 29: currentAttrs &= ~TextAttributes.STRIKETHROUGH; break
        // Foreground
        case 30: case 31: case 32: case 33: case 34: case 35: case 36: case 37: {
          const [r, g, b] = ANSI_16[p - 30]!
          currentFg = RGBA.fromInts(r, g, b, 255)
          break
        }
        case 38:
          if (params[j + 1] === 5 && j + 2 < params.length) {
            currentFg = color256(params[j + 2]!)
            j += 2
          } else if (params[j + 1] === 2 && j + 4 < params.length) {
            currentFg = RGBA.fromInts(params[j + 2]!, params[j + 3]!, params[j + 4]!, 255)
            j += 4
          }
          break
        case 39: currentFg = DEFAULT_FG; break
        // Background
        case 40: case 41: case 42: case 43: case 44: case 45: case 46: case 47: {
          const [r, g, b] = ANSI_16[p - 40]!
          currentBg = RGBA.fromInts(r, g, b, 255)
          break
        }
        case 48:
          if (params[j + 1] === 5 && j + 2 < params.length) {
            currentBg = color256(params[j + 2]!)
            j += 2
          } else if (params[j + 1] === 2 && j + 4 < params.length) {
            currentBg = RGBA.fromInts(params[j + 2]!, params[j + 3]!, params[j + 4]!, 255)
            j += 4
          }
          break
        case 49: currentBg = DEFAULT_BG; break
        // Bright foreground
        case 90: case 91: case 92: case 93: case 94: case 95: case 96: case 97: {
          const [r, g, b] = ANSI_16[p - 90 + 8]!
          currentFg = RGBA.fromInts(r, g, b, 255)
          break
        }
        // Bright background
        case 100: case 101: case 102: case 103: case 104: case 105: case 106: case 107: {
          const [r, g, b] = ANSI_16[p - 100 + 8]!
          currentBg = RGBA.fromInts(r, g, b, 255)
          break
        }
      }
      j++
    }
  }
}
