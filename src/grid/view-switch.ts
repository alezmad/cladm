import { app } from "../lib/state"
import { DirectGridRenderer } from "../components/direct-grid"

export function ensureGridView() {
  if (app.viewMode === "grid" && app.directGrid) return
  switchToGrid()
}

export function switchToGrid() {
  app.viewMode = "grid"

  const isNew = !app.directGrid
  if (isNew) {
    app.directGrid = new DirectGridRenderer(app.rawStdoutWrite)
  }

  app.renderer.suspend()

  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.resume()
  app.rawStdoutWrite("\x1b[?1049h")
  app.rawStdoutWrite("\x1b[?1002h")  // button-event tracking (drag support)
  app.rawStdoutWrite("\x1b[?1006h")

  if (isNew || app.directGrid!.totalPaneCount === 0) {
    app.directGrid!.start()
  } else {
    app.directGrid!.resume()
  }
}

export function switchToGridTab(tabId: number) {
  const tab = app.gridTabs.find(t => t.id === tabId)
  if (!tab) return

  // Track last grid tab for Ctrl+Space toggle
  app.lastGridTabIndex = app.gridTabs.indexOf(tab)

  if (app.viewMode !== "grid") {
    switchToGrid()
  }

  app.activeTabIndex = app.gridTabs.indexOf(tab) + 1
  app.directGrid!.setActiveTab(tabId)
}

export function createNewGridTab(): number {
  const tabId = app.nextTabId++
  const tab = { id: tabId, name: `Tab ${tabId}` }
  app.gridTabs.push(tab)
  app.gridTabs.sort((a, b) => {
    const na = parseInt(a.name.replace(/\D/g, "")) || 0
    const nb = parseInt(b.name.replace(/\D/g, "")) || 0
    return na - nb
  })

  if (!app.directGrid) {
    app.directGrid = new DirectGridRenderer(app.rawStdoutWrite)
  }
  app.directGrid.addTab(tab)

  // Switch to the new tab
  switchToGridTab(tabId)

  return tabId
}

export function resizeGridPanes() {
  if (!app.directGrid || app.directGrid.paneCount === 0) return
  app.directGrid.repositionAll()
}
