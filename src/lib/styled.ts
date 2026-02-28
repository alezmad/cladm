import { StyledText } from "@opentui/core"

type Chunk = { __isChunk: true; text: string; attributes: number; fg?: unknown; bg?: unknown }
type StyledPart = string | StyledText | Chunk

// Concatenate styled text parts into a single StyledText.
// OpenTUI's t`` tag doesn't handle StyledText interpolation — it calls
// toString() which produces "[object Object]". This helper merges chunks
// from multiple t`` results, TextChunks, and plain strings.
export function st(...parts: StyledPart[]): StyledText {
  const chunks: Chunk[] = []
  for (const p of parts) {
    if (p instanceof StyledText) chunks.push(...p.chunks)
    else if (p && typeof p === "object" && "__isChunk" in p) chunks.push(p as Chunk)
    else if (typeof p === "string") {
      if (p.length > 0) chunks.push({ __isChunk: true, text: p, attributes: 0 } as Chunk)
    }
  }
  return new StyledText(chunks)
}
