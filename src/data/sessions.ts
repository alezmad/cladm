import { readdirSync } from "node:fs"
import { join } from "node:path"
import type { SessionInfo } from "../lib/types"

const PROJECTS_DIR = `${Bun.env.HOME}/.claude/projects`

export async function loadSessions(projectPath: string): Promise<SessionInfo[]> {
  const dirName = projectPath.replaceAll("/", "-")
  const projDir = join(PROJECTS_DIR, dirName)

  let files: string[]
  try {
    files = readdirSync(projDir).filter((f) => f.endsWith(".jsonl"))
  } catch {
    return []
  }

  const sessions = await Promise.all(
    files.map((f) => extractSessionInfo(join(projDir, f), f.replace(".jsonl", "")))
  )

  return sessions
    .filter((s): s is SessionInfo => s !== null)
    .sort((a, b) => b.timestamp - a.timestamp)
}

async function extractSessionInfo(
  filePath: string,
  sessionId: string
): Promise<SessionInfo | null> {
  try {
    const file = Bun.file(filePath)
    const size = file.size
    if (size === 0) return null

    const headSize = Math.min(size, 15 * 1024)
    const headText = await file.slice(0, headSize).text()
    const headLines = headText.split("\n")

    const tailSize = Math.min(size, 60 * 1024)
    const tailText = await file.slice(Math.max(0, size - tailSize), size).text()
    const tailLines = tailText.split("\n")
    if (tailSize < size) tailLines.shift()

    let title = ""
    let firstTimestamp = 0
    let branch = ""

    for (const line of headLines) {
      if (!line.trim()) continue
      try {
        const d = JSON.parse(line)
        if (!firstTimestamp && d.timestamp) {
          firstTimestamp = new Date(d.timestamp).getTime()
        }
        if (!branch && d.gitBranch) branch = d.gitBranch
        if (d.type === "user") {
          const text = extractUserText(d)
          if (text) { title = text; break }
        }
      } catch {}
    }

    let lastUserPrompt = ""
    let lastAssistantMsg = ""
    let lastTimestamp = 0

    for (let i = tailLines.length - 1; i >= 0; i--) {
      if (lastUserPrompt && lastAssistantMsg) break
      const line = tailLines[i]
      if (!line?.trim()) continue
      try {
        const d = JSON.parse(line)
        if (d.timestamp) {
          const ts = new Date(d.timestamp).getTime()
          if (ts > lastTimestamp) lastTimestamp = ts
        }
        if (!lastUserPrompt && d.type === "user") {
          const text = extractUserText(d)
          if (text) lastUserPrompt = text
        }
        if (!lastAssistantMsg && d.type === "assistant" && Array.isArray(d.message?.content)) {
          for (const block of d.message.content) {
            if (block.type === "text" && block.text) {
              lastAssistantMsg = block.text
              break
            }
          }
        }
      } catch {}
    }

    if (!title && !lastUserPrompt) return null

    return {
      id: sessionId,
      timestamp: lastTimestamp || firstTimestamp,
      title: cleanText(title || lastUserPrompt, 120),
      lastUserPrompt: cleanText(lastUserPrompt, 300),
      lastAssistantMsg: cleanText(lastAssistantMsg, 300),
      branch,
      sizeBytes: size,
    }
  } catch {
    return null
  }
}

const SYSTEM_TAG_RE = /^<(local-command|command-name|command-message|command-args|system-reminder)/

function extractUserText(d: any): string {
  const content = d.message?.content
  if (typeof content === "string") {
    if (SYSTEM_TAG_RE.test(content.trim())) return ""
    return content
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text.trim()
        if (text && !SYSTEM_TAG_RE.test(text)) return text
      }
    }
  }
  return ""
}

function cleanText(text: string, maxLen: number): string {
  const cleaned = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim()
  if (cleaned.length > maxLen) return cleaned.slice(0, maxLen - 3) + "..."
  return cleaned
}
