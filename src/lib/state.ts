import type { CliRenderer } from "@opentui/core"
import type { BoxRenderable, TextRenderable, ScrollBoxRenderable } from "@opentui/core"
import type { Project, DisplayRow, SavedSession } from "./types"
import type { DirectGridRenderer } from "../components/direct-grid"
import type { UsageSummary } from "../data/usage"
import type { IdleSessionInfo } from "../data/monitor"

export type ViewMode = "picker" | "grid"

export interface GridTab {
  id: number
  name: string
}

export const app = {
  // Config
  demoMode: Bun.argv.includes("--demo"),

  // Data
  projects: [] as Project[],
  selectedProjects: new Map<string, number>(),  // path → tab number
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

  // Tabs
  activeTabIndex: 0,               // 0 = picker, 1+ = grid tab index+1
  gridTabs: [] as GridTab[],       // grid tabs only (not picker)
  nextTabId: 1,                    // auto-increment for tab ids
  clickExpand: true,               // click-to-expand feature toggle
  lastGridTabIndex: 0,             // last active grid tab for Ctrl+Space toggle
  savedSession: null as SavedSession | null,
  restoreMode: null as "pending" | null,

  // UI refs (set during init)
  renderer: null as unknown as CliRenderer,
  headerText: null as unknown as TextRenderable,
  tabBarText: null as unknown as TextRenderable,
  paneListText: null as unknown as TextRenderable,
  colHeaderText: null as unknown as TextRenderable,
  listBox: null as unknown as ScrollBoxRenderable,
  bottomRow: null as unknown as BoxRenderable,
  previewBox: null as unknown as BoxRenderable,
  previewText: null as unknown as TextRenderable,
  usageBox: null as unknown as BoxRenderable,
  footerText: null as unknown as TextRenderable,
  cachedUsage: null as UsageSummary | null,
}
