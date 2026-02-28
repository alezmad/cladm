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

  const items: { path: string; name: string; sessionId?: string; targetBranch?: string }[] = []

  for (const path of app.selectedProjects) {
    const project = app.projects.find(p => p.path === path)
    if (!project) continue
    const targetBranch = app.selectedBranches.get(path)
    const needsBranch = targetBranch && targetBranch !== project.branch
    if (!project.sessions) {
      project.sessions = await loadSessions(project.path)
      project.sessionCount = project.sessions.length
    }
    const lastSessionId = project.sessions[0]?.id
    items.push({ path, name: project.name, sessionId: lastSessionId, targetBranch: needsBranch ? targetBranch : undefined })
  }

  for (const project of app.projects) {
    if (!project.sessions) continue
    for (const session of project.sessions) {
      if (app.selectedSessions.has(session.id)) {
        const targetBranch = app.selectedBranches.get(project.path)
        const needsBranch = targetBranch && targetBranch !== project.branch
        items.push({ path: project.path, name: project.name, sessionId: session.id, targetBranch: needsBranch ? targetBranch : undefined })
      }
    }
  }

  if (items.length === 0) return

  // Determine target tab: use active grid tab or create a new one
  let targetTabId: number
  if (app.viewMode === "grid" && app.directGrid && app.gridTabs.length > 0) {
    targetTabId = app.directGrid.activeTabId
  } else {
    targetTabId = createNewGridTab()
  }

  ensureGridView()

  const termW = process.stdout.columns || 120
  const termH = process.stdout.rows || 40
  const totalPanes = items.length + (app.directGrid?.getTabPaneCount(targetTabId) || 0)
  const cols = totalPanes <= 1 ? 1 : totalPanes <= 2 ? 2 : totalPanes <= 4 ? 2 : 3
  const rows = Math.ceil(totalPanes / cols)
  const paneW = Math.max(Math.floor(termW / cols) - 2, 20)
  const paneH = Math.max(Math.floor((termH - 2) / rows) - 4, 6)

  for (const item of items) {
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

  app.selectedProjects.clear()
  app.selectedSessions.clear()
  app.selectedBranches.clear()
}
