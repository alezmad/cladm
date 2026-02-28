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
  app.rawStdoutWrite("\x1b[?1000h")
  app.rawStdoutWrite("\x1b[?1006h")

  if (isNew || app.directGrid.paneCount === 0) {
    app.directGrid.start()
  } else {
    app.directGrid.resume()
  }
}

export function resizeGridPanes() {
  if (!app.directGrid || app.directGrid.paneCount === 0) return
  app.directGrid.repositionAll()
}
