import { app } from "../lib/state"
import { updateAll, rebuildDisplayRows } from "../ui/panels"
import { ensureGridView, createNewGridTab, switchToGridTab } from "../grid/view-switch"
import { loadSessions } from "../data/sessions"
import { createSession } from "../pty/session-manager"

export async function doLaunch() {
  if (app.selectedProjects.size === 0 && app.selectedSessions.size === 0) return
  if (app.demoMode) {
    app.selectedProjects.clear()
    app.selectedSessions.clear()
    app.selectedBranches.clear()
    rebuildDisplayRows()
    updateAll()
    return
  }

  type LaunchItem = { path: string; name: string; tabNum: number; sessionId?: string; targetBranch?: string }
  const items: LaunchItem[] = []

  for (const [path, tabNum] of app.selectedProjects) {
    const project = app.projects.find(p => p.path === path)
    if (!project) continue
    const targetBranch = app.selectedBranches.get(path)
    const needsBranch = targetBranch && targetBranch !== project.branch
    if (!project.sessions) {
      project.sessions = await loadSessions(project.path)
      project.sessionCount = project.sessions.length
    }
    const lastSessionId = project.sessions[0]?.id
    items.push({ path, name: project.name, tabNum, sessionId: lastSessionId, targetBranch: needsBranch ? targetBranch : undefined })
  }

  for (const project of app.projects) {
    if (!project.sessions) continue
    for (const session of project.sessions) {
      if (app.selectedSessions.has(session.id)) {
        const targetBranch = app.selectedBranches.get(project.path)
        const needsBranch = targetBranch && targetBranch !== project.branch
        // Sessions without explicit tab number go to tab 1
        items.push({ path: project.path, name: project.name, tabNum: 1, sessionId: session.id, targetBranch: needsBranch ? targetBranch : undefined })
      }
    }
  }

  if (items.length === 0) return

  // Group items by tab number
  const byTab = new Map<number, LaunchItem[]>()
  for (const item of items) {
    if (!byTab.has(item.tabNum)) byTab.set(item.tabNum, [])
    byTab.get(item.tabNum)!.push(item)
  }

  ensureGridView()

  // Launch each tab group into its own grid tab
  for (const [tabNum, tabItems] of byTab) {
    // Find existing grid tab for this number, or create one
    let targetTabId: number
    const existingTab = app.gridTabs.find(t => t.name === `Tab ${tabNum}`)
    if (existingTab) {
      targetTabId = existingTab.id
    } else {
      targetTabId = createNewGridTab()
      // Rename to match the picker tab number
      const tab = app.gridTabs.find(t => t.id === targetTabId)
      if (tab) {
        tab.name = `Tab ${tabNum}`
        app.gridTabs.sort((a, b) => {
          const na = parseInt(a.name.replace(/\D/g, "")) || 0
          const nb = parseInt(b.name.replace(/\D/g, "")) || 0
          return na - nb
        })
      }
    }

    const termW = process.stdout.columns || 120
    const termH = process.stdout.rows || 40
    const totalPanes = tabItems.length + (app.directGrid?.getTabPaneCount(targetTabId) || 0)
    const cols = totalPanes <= 1 ? 1 : totalPanes <= 2 ? 2 : totalPanes <= 4 ? 2 : 3
    const rows = Math.ceil(totalPanes / cols)
    const paneW = Math.max(Math.floor(termW / cols) - 2, 20)
    const paneH = Math.max(Math.floor((termH - 2) / rows) - 4, 6)

    for (const item of tabItems) {
      const session = await createSession({
        projectPath: item.path,
        projectName: item.name,
        sessionId: item.sessionId,
        targetBranch: item.targetBranch,
        width: paneW,
        height: paneH,
      })
      await app.directGrid!.addPane(session, targetTabId)
    }

    switchToGridTab(targetTabId)
  }

  app.selectedProjects.clear()
  app.selectedSessions.clear()
  app.selectedBranches.clear()
}
