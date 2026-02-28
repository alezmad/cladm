import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs"
import { join, dirname } from "path"
import { app } from "../lib/state"
import type { SavedSession, SavedTab, SavedPane } from "../lib/types"
import { createSession } from "../pty/session-manager"
import { ensureGridView, switchToGridTab } from "../grid/view-switch"

const SESSION_PATH = join(process.env.HOME ?? "", ".config", "cladm", "session.json")

export function extractSessionState(): SavedSession | null {
  const dg = app.directGrid
  if (!dg || app.gridTabs.length === 0) return null

  const tabs: SavedTab[] = []
  for (const tab of app.gridTabs) {
    const paneInfos = dg.getTabPanes(tab.id)
    const panes: SavedPane[] = []
    for (const p of paneInfos) {
      if (!p.session.alive) continue
      panes.push({
        projectPath: p.session.projectPath,
        projectName: p.session.projectName,
        sessionId: p.session.sessionId,
        targetBranch: p.session.targetBranch,
      })
    }
    if (panes.length > 0) {
      tabs.push({ id: tab.id, name: tab.name, panes })
    }
  }

  if (tabs.length === 0) return null

  const activeIdx = app.gridTabs.findIndex(t => t.id === dg.activeTabId)
  return {
    version: 1,
    savedAt: Date.now(),
    activeTabIndex: Math.max(0, activeIdx),
    nextTabId: app.nextTabId,
    tabs,
  }
}

export function saveSessionSync(data: SavedSession): void {
  const dir = dirname(SESSION_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(SESSION_PATH, JSON.stringify(data, null, 2))
}

export async function loadSavedSession(): Promise<SavedSession | null> {
  try {
    const file = Bun.file(SESSION_PATH)
    if (!await file.exists()) return null
    const data = await file.json() as SavedSession
    if (data.version !== 1 || !Array.isArray(data.tabs)) return null
    return data
  } catch {
    return null
  }
}

export function deleteSavedSession(): void {
  try { unlinkSync(SESSION_PATH) } catch {}
}

export async function restoreSession(saved: SavedSession, useResume: boolean): Promise<void> {
  ensureGridView()

  const termW = process.stdout.columns || 120
  const termH = process.stdout.rows || 40

  let firstTabId: number | null = null

  for (const savedTab of saved.tabs) {
    const tabId = app.nextTabId++
    const tab = { id: tabId, name: savedTab.name }
    app.gridTabs.push(tab)
    app.directGrid!.addTab(tab)
    if (firstTabId === null) firstTabId = tabId

    const validPanes = savedTab.panes.filter(p => existsSync(p.projectPath))
    const n = validPanes.length
    const cols = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 2 : 3
    const rows = Math.ceil(n / cols)
    const paneW = Math.max(Math.floor(termW / cols) - 2, 20)
    const paneH = Math.max(Math.floor((termH - 2) / rows) - 4, 6)

    for (const pane of validPanes) {
      const session = await createSession({
        projectPath: pane.projectPath,
        projectName: pane.projectName,
        sessionId: useResume ? pane.sessionId : undefined,
        targetBranch: pane.targetBranch,
        width: paneW,
        height: paneH,
      })
      await app.directGrid!.addPane(session, tabId)
    }
  }

  // Sort tabs by name
  app.gridTabs.sort((a, b) => {
    const na = parseInt(a.name.replace(/\D/g, "")) || 0
    const nb = parseInt(b.name.replace(/\D/g, "")) || 0
    return na - nb
  })

  // Switch to saved active tab
  const targetIdx = Math.min(saved.activeTabIndex, app.gridTabs.length - 1)
  if (targetIdx >= 0 && app.gridTabs[targetIdx]) {
    switchToGridTab(app.gridTabs[targetIdx].id)
  } else if (firstTabId !== null) {
    switchToGridTab(firstTabId)
  }

  deleteSavedSession()
  app.savedSession = null
  app.restoreMode = null
}
