import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const PROJECTS_DIR = `${Bun.env.HOME}/.claude/projects`
const WINDOW_MS = 5 * 60 * 60 * 1000 // 5 hours

// Configurable plan limits (cost-based estimates)
// Adjust these to match your Claude plan's actual limits
export const PLAN_LIMITS = {
  session: 750,          // $ per 5h window (Max plan opus-heavy estimate)
  weeklyAll: 10000,      // $ per week all models
  weeklySonnet: 2000,    // $ per week sonnet only
  extraMonthly: 20,      // € per month extra usage cap
}

interface TokenUsage {
  input: number
  output: number
  cacheCreation: number
  cacheRead: number
}

interface ModelUsage extends TokenUsage {
  cost: number
  requests: number
}

export interface DayCost {
  label: string  // "Mon", "Tue", etc.
  date: string   // "2026-02-24"
  cost: number
  requests: number
}

export interface UsageSummary {
  windowMs: number
  sessionResetMs: number
  totalCost: number
  totalInput: number
  totalOutput: number
  totalCacheCreation: number
  totalCacheRead: number
  totalRequests: number
  costPerHour: number
  byModel: Map<string, ModelUsage>
  weekDays: DayCost[]   // last 7 days, oldest first
  weekTotal: number
  weeklySonnetCost: number
  monthlyTotalCost: number
}

// Per-million-token pricing
const PRICING: Record<string, { input: number; output: number; cacheCreation: number; cacheRead: number }> = {
  "opus":    { input: 15.0,  output: 75.0,  cacheCreation: 18.75, cacheRead: 1.50 },
  "sonnet":  { input: 3.0,   output: 15.0,  cacheCreation: 3.75,  cacheRead: 0.30 },
  "haiku":   { input: 0.80,  output: 4.0,   cacheCreation: 1.00,  cacheRead: 0.08 },
}

function normalizeModel(model: string): string {
  const l = model.toLowerCase()
  if (l.includes("opus")) return "opus"
  if (l.includes("haiku")) return "haiku"
  if (l.includes("sonnet")) return "sonnet"
  return "sonnet"
}

function modelLabel(model: string): string {
  const l = model.toLowerCase()
  if (l.includes("opus")) {
    if (l.includes("4-6") || l.includes("4.6")) return "opus-4.6"
    if (l.includes("4-5") || l.includes("4.5")) return "opus-4.5"
    return "opus"
  }
  if (l.includes("sonnet")) {
    if (l.includes("4-6") || l.includes("4.6")) return "sonnet-4.6"
    if (l.includes("4-5") || l.includes("4.5")) return "sonnet-4.5"
    if (l.includes("3-5") || l.includes("3.5")) return "sonnet-3.5"
    return "sonnet"
  }
  if (l.includes("haiku")) {
    if (l.includes("4-5") || l.includes("4.5")) return "haiku-4.5"
    if (l.includes("3-5") || l.includes("3.5")) return "haiku-3.5"
    return "haiku"
  }
  return model.slice(0, 12)
}

function calcCost(normalized: string, tokens: TokenUsage): number {
  const p = PRICING[normalized] || PRICING["sonnet"]
  return (
    (tokens.input / 1_000_000) * p.input +
    (tokens.output / 1_000_000) * p.output +
    (tokens.cacheCreation / 1_000_000) * p.cacheCreation +
    (tokens.cacheRead / 1_000_000) * p.cacheRead
  )
}

// Cache: file path → { mtime, entries }
const fileCache = new Map<string, { mtime: number; entries: Array<{ model: string; tokens: TokenUsage; ts: number }> }>()

async function scanFile(filePath: string, cutoff: number): Promise<Array<{ model: string; tokens: TokenUsage; ts: number }>> {
  let mtime: number
  try {
    mtime = statSync(filePath).mtimeMs
  } catch {
    return []
  }

  // Skip files not modified since cutoff
  if (mtime < cutoff) return []

  // Use cache if file unchanged
  const cached = fileCache.get(filePath)
  if (cached && cached.mtime === mtime) {
    return cached.entries.filter(e => e.ts >= cutoff)
  }

  // Parse file
  const entries: Array<{ model: string; tokens: TokenUsage; ts: number }> = []
  try {
    const text = await Bun.file(filePath).text()
    for (const line of text.split("\n")) {
      if (!line.includes('"usage"')) continue
      try {
        const d = JSON.parse(line)
        const msg = d.message
        if (!msg?.usage) continue
        const u = msg.usage
        const input = u.input_tokens || 0
        const output = u.output_tokens || 0
        if (!input && !output) continue

        const ts = d.timestamp ? new Date(d.timestamp).getTime() : mtime
        entries.push({
          model: msg.model || "unknown",
          tokens: {
            input,
            output,
            cacheCreation: u.cache_creation_input_tokens || 0,
            cacheRead: u.cache_read_input_tokens || 0,
          },
          ts,
        })
      } catch {}
    }
  } catch {}

  fileCache.set(filePath, { mtime, entries })
  return entries.filter(e => e.ts >= cutoff)
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function dateKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function dayLabel(ts: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(ts).getDay()]
}

export async function getUsageSummary(): Promise<UsageSummary> {
  const now = Date.now()
  const sessionCutoff = now - WINDOW_MS
  const weekCutoff = now - WEEK_MS

  // Monthly cutoff: 1st of current month
  const monthStart = new Date(now)
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const monthlyCutoff = monthStart.getTime()

  // Use the earliest cutoff for scanning
  const scanCutoff = Math.min(weekCutoff, monthlyCutoff)

  const allEntries: Array<{ model: string; tokens: TokenUsage; ts: number }> = []

  try {
    const dirs = readdirSync(PROJECTS_DIR)
    const filePromises: Promise<Array<{ model: string; tokens: TokenUsage; ts: number }>>[] = []

    for (const dir of dirs) {
      const dirPath = join(PROJECTS_DIR, dir)
      try {
        const files = readdirSync(dirPath).filter(f => f.endsWith(".jsonl"))
        for (const f of files) {
          filePromises.push(scanFile(join(dirPath, f), scanCutoff))
        }
      } catch {}
    }

    const results = await Promise.all(filePromises)
    for (const entries of results) {
      allEntries.push(...entries)
    }
  } catch {}

  // Deduplicate
  const seen = new Set<string>()
  type Deduped = { model: string; tokens: TokenUsage; ts: number; normalized: string; label: string; cost: number }
  const deduped: Deduped[] = []

  for (const entry of allEntries) {
    const dedupeKey = `${entry.ts}:${entry.model}:${entry.tokens.output}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const normalized = normalizeModel(entry.model)
    const label = modelLabel(entry.model)
    const cost = calcCost(normalized, entry.tokens)
    deduped.push({ ...entry, normalized, label, cost })
  }

  // Session aggregation (5h window)
  const byModel = new Map<string, ModelUsage>()
  let totalCost = 0, totalInput = 0, totalOutput = 0
  let totalCacheCreation = 0, totalCacheRead = 0, totalRequests = 0
  let earliestTs = now

  for (const e of deduped) {
    if (e.ts < sessionCutoff) continue
    totalCost += e.cost
    totalInput += e.tokens.input
    totalOutput += e.tokens.output
    totalCacheCreation += e.tokens.cacheCreation
    totalCacheRead += e.tokens.cacheRead
    totalRequests++
    if (e.ts < earliestTs) earliestTs = e.ts

    let m = byModel.get(e.label)
    if (!m) m = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, cost: 0, requests: 0 }
    m.input += e.tokens.input
    m.output += e.tokens.output
    m.cacheCreation += e.tokens.cacheCreation
    m.cacheRead += e.tokens.cacheRead
    m.cost += e.cost
    m.requests++
    byModel.set(e.label, m)
  }

  // Weekly per-day aggregation + sonnet weekly cost
  const dayMap = new Map<string, { cost: number; requests: number; ts: number }>()
  let weeklySonnetCost = 0
  for (const e of deduped) {
    if (e.ts < weekCutoff) continue
    const dk = dateKey(e.ts)
    let day = dayMap.get(dk)
    if (!day) { day = { cost: 0, requests: 0, ts: e.ts }; dayMap.set(dk, day) }
    day.cost += e.cost
    day.requests += 1
    if (e.normalized === "sonnet") weeklySonnetCost += e.cost
  }

  // Build 7-day array (oldest to newest)
  const weekDays: DayCost[] = []
  let weekTotal = 0
  for (let i = 6; i >= 0; i--) {
    const dayTs = now - i * 24 * 60 * 60 * 1000
    const dk = dateKey(dayTs)
    const day = dayMap.get(dk)
    weekDays.push({
      label: dayLabel(dayTs),
      date: dk,
      cost: day?.cost || 0,
      requests: day?.requests || 0,
    })
    weekTotal += day?.cost || 0
  }

  // Monthly total cost
  let monthlyTotalCost = 0
  for (const e of deduped) {
    if (e.ts >= monthlyCutoff) monthlyTotalCost += e.cost
  }

  const windowMs = totalRequests > 0 ? now - earliestTs : 0
  const sessionResetMs = totalRequests > 0 ? Math.max(0, WINDOW_MS - windowMs) : 0
  const hours = windowMs / 3_600_000 || 1

  return {
    windowMs,
    sessionResetMs,
    totalCost,
    totalInput,
    totalOutput,
    totalCacheCreation,
    totalCacheRead,
    totalRequests,
    costPerHour: totalCost / hours,
    byModel,
    weekDays,
    weekTotal,
    weeklySonnetCost,
    monthlyTotalCost,
  }
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K"
  return String(n)
}

export function formatCost(n: number): string {
  if (n >= 10) return "$" + n.toFixed(1)
  if (n >= 1) return "$" + n.toFixed(2)
  return "$" + n.toFixed(3)
}

export function formatWindow(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m > 0 ? m + "m" : ""}`
  return `${m}m`
}

export function makeBar(value: number, max: number, width: number): string {
  if (max <= 0) return "░".repeat(width)
  const filled = Math.round((value / max) * width)
  const clamped = Math.min(filled, width)
  return "█".repeat(clamped) + "░".repeat(width - clamped)
}

export function pct(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(Math.round((value / max) * 100), 100)
}
