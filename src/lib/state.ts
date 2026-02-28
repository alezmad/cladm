import type { CliRenderer } from "@opentui/core"
import type { BoxRenderable, TextRenderable, ScrollBoxRenderable } from "@opentui/core"
import type { Project, DisplayRow } from "./types"
import type { DirectGridRenderer } from "../components/direct-grid"
import type { UsageSummary } from "../data/usage"
import type { IdleSessionInfo } from "../data/monitor"

export type ViewMode = "picker" | "grid"

export const app = {
  // Config
  demoMode: Bun.argv.includes("--demo"),

  // Data
  projects: [] as Project[],
  selectedProjects: new Set<string>(),
  selectedSessions: new Set<string>(),
  selectedBranches: new Map<string, string>(),
  cursor: 0,
  sortMode: 0,
  sortLabels: ["recent", "name", "commit", "sessions"] as const,
  sortedIndices: [] as number[],
  displayRows: [] as DisplayRow[],

  // Monitor
  monitorInterval: null as ReturnType<typeof setInterval> | null,
  prevBusySnapshot: new Map<string, number>(),
  bottomPanelMode: "preview" as "preview" | "idle",
  destroyed: false,
  idleCursor: 0,
  cachedIdleSessions: [] as IdleSessionInfo[],

  // Grid mode
  viewMode: "picker" as ViewMode,
  directGrid: null as DirectGridRenderer | null,
  mainBox: null as BoxRenderable | null,
  rawStdoutWrite: null as unknown as (s: string) => boolean,

  // UI refs (set during init)
  renderer: null as unknown as CliRenderer,
  headerText: null as unknown as TextRenderable,
  colHeaderText: null as unknown as TextRenderable,
  listBox: null as unknown as ScrollBoxRenderable,
  bottomRow: null as unknown as BoxRenderable,
  previewBox: null as unknown as BoxRenderable,
  previewText: null as unknown as TextRenderable,
  usageBox: null as unknown as BoxRenderable,
  footerText: null as unknown as TextRenderable,
  cachedUsage: null as UsageSummary | null,
}
