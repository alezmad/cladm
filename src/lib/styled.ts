import { StyledText, type TextChunk } from "@opentui/core"

type StyledPart = string | StyledText | TextChunk

export function st(...parts: StyledPart[]): StyledText {
  const chunks: TextChunk[] = []
  for (const p of parts) {
    if (p instanceof StyledText) chunks.push(...p.chunks)
    else if (p && typeof p === "object" && "__isChunk" in p) chunks.push(p)
    else if (typeof p === "string") {
      if (p.length > 0) chunks.push({ __isChunk: true, text: p } as TextChunk)
    }
  }
  return new StyledText(chunks)
}
