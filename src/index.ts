#!/usr/bin/env bun
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
} from "@opentui/core"
import { discoverProjects } from "./data/history"
import { loadGitMetadata } from "./data/git"
import { loadSessions } from "./data/sessions"
import { generateMockProjects, generateMockSessions, generateMockBusySessions } from "./data/mock"
import { detectActiveSessions, updateProjectSessions, generateMockActiveSessions, checkTransitions, snapshotBusy, playDoneSound, bounceDock, getSessionStatus, populateMockSessionStatus } from "./data/monitor"
import type { Project } from "./lib/types"
import { getUsageSummary } from "./data/usage"
import { getSessions, refreshAlive } from "./pty/session-manager"
import { stopAllCaptures } from "./pty/capture"
import { DIM_CLR } from "./lib/theme"
import { app } from "./lib/state"
import { updateAll, rebuildDisplayRows, updateUsagePanel, updateColumnHeaders } from "./ui/panels"
import { stdinHandler } from "./input/handlers"
import { resizeGridPanes } from "./grid/view-switch"
import { loadSavedSession, extractSessionState, saveSessionSync } from "./data/session-store"

function refreshMockSessions(projects: Project[]) {
  generateMockActiveSessions(projects)
  generateMockBusySessions(projects)
  for (const p of projects) {
    if (p.activeSessions > 0 && !p.sessions) {
      p.sessions = generateMockSessions(p.path)
      p.sessionCount = p.sessions.length
    }
    populateMockSessionStatus(p)
  }
}

async function main() {
  process.stdout.write("\x1b[2J\x1b[H")
  process.stdout.write("\x1b[1m  cladm\x1b[0m\n")

  if (app.demoMode) {
    process.stdout.write("\x1b[2m  [Demo mode] Loading mock projects...\x1b[0m\n")
    app.projects = generateMockProjects()
  } else {
    process.stdout.write("\x1b[2m  Loading projects...\x1b[0m\n")
    app.projects = await discoverProjects()
    if (app.projects.length === 0) {
      console.log("  No projects found in ~/.claude/history.jsonl")
      process.exit(1)
    }
    process.stdout.write(
      `\x1b[2m  Found ${app.projects.length} projects. Loading git metadata...\x1b[0m\n`
    )
    await Promise.all(app.projects.map((p) => loadGitMetadata(p)))
  }

  app.sortedIndices = app.projects.map((_, i) => i)
  rebuildDisplayRows()

  // Load saved session for restore hint
  app.savedSession = await loadSavedSession()

  // Save raw stdout.write BEFORE OpenTUI intercepts it
  app.rawStdoutWrite = process.stdout.write.bind(process.stdout) as (s: string) => boolean

  app.renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useAlternateScreen: true,
    useMouse: false,
    onDestroy: () => {
      app.destroyed = true
      // Save session state before cleanup
      try {
        const state = extractSessionState()
        if (state) saveSessionSync(state)
      } catch (err) { console.error("[session-save]", err) }
      if (app.monitorInterval) { clearInterval(app.monitorInterval); app.monitorInterval = null }
      if (app.directGrid) app.directGrid.destroyAll()
      stopAllCaptures()
    },
  })

  // Enable mouse reporting manually (SGR mode for full coordinates)
  process.stdout.write("\x1b[?1000h")
  process.stdout.write("\x1b[?1006h")

  // Build layout
  app.mainBox = new BoxRenderable(app.renderer, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
  })

  app.tabBarText = new TextRenderable(app.renderer, {
    width: "100%",
    height: 1,
    flexShrink: 0,
  })

  app.paneListText = new TextRenderable(app.renderer, {
    width: "100%",
    height: 1,
    flexShrink: 0,
  })

  app.headerText = new TextRenderable(app.renderer, {
    width: "100%",
    height: 1,
    flexShrink: 0,
  })

  app.colHeaderText = new TextRenderable(app.renderer, {
    width: "100%",
    height: 1,
    flexShrink: 0,
  })

  app.listBox = new ScrollBoxRenderable(app.renderer, {
    scrollY: true,
    flexGrow: 1,
    viewportCulling: true,
  })

  app.bottomRow = new BoxRenderable(app.renderer, {
    flexDirection: "row",
    height: 10,
    flexShrink: 0,
    width: "100%",
  })

  app.previewBox = new BoxRenderable(app.renderer, {
    flexGrow: 1,
    height: "100%",
    borderStyle: "single",
    border: ["top"],
    borderColor: DIM_CLR,
    title: " Preview ",
    titleAlignment: "left",
    flexDirection: "column",
    paddingLeft: 0,
  })

  app.previewText = new TextRenderable(app.renderer, {
    width: "100%",
    flexGrow: 1,
    wrapMode: "word",
  })
  app.previewBox.add(app.previewText)

  app.usageBox = new BoxRenderable(app.renderer, {
    width: 34,
    height: "100%",
    flexShrink: 0,
    borderStyle: "single",
    border: ["top", "left"],
    borderColor: DIM_CLR,
    title: " Usage (5h) ",
    titleAlignment: "left",
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
  })

  app.bottomRow.add(app.previewBox)
  app.bottomRow.add(app.usageBox)

  app.footerText = new TextRenderable(app.renderer, {
    width: "100%",
    height: 1,
    flexShrink: 0,
  })

  app.mainBox.add(app.tabBarText)
  app.mainBox.add(app.paneListText)
  app.mainBox.add(app.headerText)
  app.mainBox.add(app.colHeaderText)
  app.mainBox.add(app.listBox)
  app.mainBox.add(app.bottomRow)
  app.mainBox.add(app.footerText)

  app.renderer.root.add(app.mainBox)

  updateColumnHeaders()
  updateUsagePanel()
  updateAll()

  // Load initial usage data
  getUsageSummary().then(u => {
    app.cachedUsage = u
    updateUsagePanel()
  }).catch(err => console.error("[usage]", err))

  // Resize PTY panes when terminal window is resized
  process.stdout.on("resize", () => {
    if (app.viewMode !== "grid" || !app.directGrid) return
    resizeGridPanes()
  })

  // Take over stdin completely
  process.stdin.removeAllListeners("data")
  process.stdin.on("data", stdinHandler)

  // Live session monitoring
  if (app.demoMode) {
    refreshMockSessions(app.projects)
    app.prevBusySnapshot = snapshotBusy(app.projects)
    updateAll()
  } else {
    detectActiveSessions().then((sessions) => {
      if (updateProjectSessions(app.projects, sessions)) updateAll()
      app.prevBusySnapshot = snapshotBusy(app.projects)
    })
  }

  let usageTick = 0
  app.monitorInterval = setInterval(async () => {
    if (app.destroyed) return

    usageTick++
    if (usageTick % 6 === 0) {
      try {
        app.cachedUsage = await getUsageSummary()
        updateUsagePanel()
      } catch (err) { console.error("[usage-poll]", err) }
    }

    if (app.demoMode) {
      for (const p of app.projects) { p.activeSessions = 0; p.busySessions = 0 }
      refreshMockSessions(app.projects)
      const transitioned = checkTransitions(app.projects, app.prevBusySnapshot)
      app.prevBusySnapshot = snapshotBusy(app.projects)
      if (transitioned.length > 0) {
        playDoneSound()
        bounceDock()
        app.bottomPanelMode = "idle"
      }
      updateAll()
    } else {
      const sessions = await detectActiveSessions()
      const changed = updateProjectSessions(app.projects, sessions)
      const transitioned = checkTransitions(app.projects, app.prevBusySnapshot)
      for (const p of app.projects) {
        if (p.activeSessions > 0 && (!p.sessions || transitioned.length > 0)) {
          p.sessions = await loadSessions(p.path)
          p.sessionCount = p.sessions.length
        }
      }
      app.prevBusySnapshot = snapshotBusy(app.projects)
      if (transitioned.length > 0) {
        playDoneSound()
        bounceDock()
        app.bottomPanelMode = "idle"
      }
      if (changed) updateAll()

      if (app.directGrid && app.viewMode === "grid") {
        await refreshAlive()
        for (const [, s] of getSessions()) {
          const status = getSessionStatus(s.projectPath, s.sessionId)
          if (status === "idle") app.directGrid.markIdle(s.name)
          else if (status === "busy") app.directGrid.markBusy(s.name)
          else app.directGrid.clearMark(s.name)
        }
      }
    }
  }, 5000)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
