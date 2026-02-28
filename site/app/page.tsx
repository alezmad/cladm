import Image from "next/image";
import { EmailReveal } from "./email-reveal";
import { NewsletterForm } from "./newsletter-form";
import { SubscribeModal } from "./subscribe-modal";
import { TerminalCascade } from "./terminal-cascade";
import {
  SearchIcon,
  GithubIcon,
  TerminalIcon,
  FolderIcon,
  NetworkIcon,
  GamepadIcon,
  BlocksIcon,
  LinkedinIcon,
  SpaceInvadersIcon,
  EyeIcon,
  BellIcon,
  TrendingUpIcon,
  ThunderIcon,
} from "raster-react";

function PixelDivider() {
  return (
    <div className="w-full py-8 flex items-center justify-center select-none" aria-hidden>
      <div className="flex gap-1">
        {Array.from({ length: 40 }).map((_, i) => (
          <div
            key={i}
            className="w-2 h-2"
            style={{
              background: i % 5 === 0 ? "#e07850" : i % 3 === 0 ? "#333" : "#222",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Keycap({ children }: { children: React.ReactNode }) {
  return <span className="keycap">{children}</span>;
}

function TerminalWindow({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pixel-border bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-surface-2 border-b-2 border-border">
        <div className="w-3 h-3 bg-[#ff5f56]" />
        <div className="w-3 h-3 bg-[#ffbd2e]" />
        <div className="w-3 h-3 bg-[#27c93f]" />
        <span className="ml-3 font-[family-name:var(--font-mono)] text-dim text-xs">
          {title}
        </span>
      </div>
      <div className="p-1">{children}</div>
    </div>
  );
}

function FeatureBlock({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="border-2 border-border p-5 bg-surface hover:border-accent transition-colors group">
      <div className="mb-3 text-dim group-hover:text-accent transition-colors">
        {icon}
      </div>
      <h3 className="font-[family-name:var(--font-pixel)] text-accent text-sm mb-2 uppercase tracking-wider">
        {title}
      </h3>
      <p className="font-[family-name:var(--font-mono)] text-dim text-xs leading-relaxed">
        {desc}
      </p>
    </div>
  );
}

function GridPaneMockup({
  name,
  status,
  elapsed,
  children,
  focused,
}: {
  name: string;
  status: "busy" | "idle";
  elapsed?: string;
  children: React.ReactNode;
  focused?: boolean;
}) {
  return (
    <div className={`bg-bg border ${focused ? "border-accent" : "border-border"}`}>
      {/* Pane title bar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border bg-surface-2/60">
        <div className="font-[family-name:var(--font-mono)] text-[10px] flex items-center gap-1.5">
          {status === "busy" ? (
            <span className="text-green">●</span>
          ) : (
            <>
              <span className="text-yellow">◉</span>
              {elapsed && <span className="text-dim">{elapsed}</span>}
            </>
          )}
          <span className="text-text">{name}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-cyan text-[8px]">●</span>
          <span className="text-dim text-[8px]">─</span>
          <span className="text-[#27c93f] text-[8px]">●</span>
          <span className="text-[#ff5f56] text-[8px]">●</span>
        </div>
      </div>
      {/* Pane content */}
      <div className="p-3 font-[family-name:var(--font-mono)] text-[10px] text-dim leading-relaxed">
        {children}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-bg selection:bg-accent/30">
      <SubscribeModal />

      {/* ══════ HERO ══════ */}
      <section className="relative overflow-hidden scanlines">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(#e07850 1px, transparent 1px), linear-gradient(90deg, #e07850 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <div className="relative max-w-6xl mx-auto px-6 pt-16 pb-20">
          {/* Nav */}
          <nav className="flex items-center justify-between mb-16">
            <div className="font-[family-name:var(--font-pixel)] text-accent text-lg tracking-widest flex items-center gap-2">
              <SpaceInvadersIcon size={20} />
              CLADM
            </div>
            <a
              href="https://github.com/alezmad/cladm"
              target="_blank"
              rel="noopener noreferrer"
              className="font-[family-name:var(--font-mono)] text-dim text-xs border-2 border-border px-4 py-2 hover:border-accent hover:text-accent transition-colors uppercase tracking-wider flex items-center gap-2"
            >
              <GithubIcon size={16} />
              GitHub
            </a>
          </nav>

          {/* Two-column hero */}
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Left — text + CTA */}
            <div className="flex-1 flex flex-col items-center lg:items-start text-center lg:text-left">
              <Image
                src="/logo.png"
                alt="cladm pixel art logo"
                width={240}
                height={160}
                className="pixel-render float mb-6"
                priority
              />

              <h1 className="font-[family-name:var(--font-pixel)] text-4xl md:text-5xl text-text mb-4 leading-tight">
                CLADM
              </h1>

              <p className="font-[family-name:var(--font-pixel)] text-accent text-lg md:text-xl mb-5">
                CLAUDE CODE COMMAND CENTER
              </p>

              <p className="font-[family-name:var(--font-mono)] text-dim text-sm max-w-md leading-relaxed mb-8">
                Manage all your Claude Code sessions from one terminal.
                An embedded PTY grid with tabbed workspaces, pane controls,
                real-time status tracking, and full keyboard-driven workflow.
              </p>

              {/* Install command */}
              <div className="pixel-border-accent bg-surface px-8 py-4 mb-4">
                <code className="font-[family-name:var(--font-mono)] text-green text-sm">
                  <span className="text-dim">$</span> bun install -g cladm
                  <span className="cursor-blink text-accent">_</span>
                </code>
              </div>

              <p className="font-[family-name:var(--font-mono)] text-dim text-xs">
                requires{" "}
                <a href="https://bun.sh" className="text-accent hover:underline">
                  bun
                </a>{" "}
                &gt;= 1.3 + macOS
              </p>
            </div>

            {/* Right — terminal cascade: picker → grid */}
            <div className="flex-1 w-full max-w-xl">
              <TerminalCascade />
            </div>
          </div>
        </div>

        {/* Bottom edge - pixel staircase */}
        <div className="w-full h-4 bg-accent" />
        <div className="w-full flex">
          <div className="h-4 bg-accent" style={{ width: "90%" }} />
        </div>
        <div className="w-full flex">
          <div className="h-4 bg-accent" style={{ width: "75%" }} />
        </div>
      </section>

      {/* ══════ THE WORKSPACE ══════ */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-4">
          <h2 className="font-[family-name:var(--font-pixel)] text-accent text-sm uppercase tracking-[0.3em] mb-3">
            // THE WORKSPACE
          </h2>
          <p className="font-[family-name:var(--font-mono)] text-dim text-xs max-w-2xl mx-auto leading-relaxed">
            Every Claude Code session runs in an embedded terminal pane — no separate windows.
            See all your projects at once, switch focus with a click, and never lose track of what Claude is doing.
          </p>
        </div>

        {/* Grid workspace mockup */}
        <div className="mt-10">
          <div className="pixel-border bg-surface overflow-hidden">
            {/* Tab bar */}
            <div className="flex items-center bg-surface-2 border-b-2 border-border">
              <div className="px-4 py-2 border-b-2 border-accent font-[family-name:var(--font-mono)] text-xs">
                <span className="text-green">●</span>
                <span className="text-text"> acme-api</span>
                <span className="text-dim"> · </span>
                <span className="text-yellow">◉</span>
                <span className="text-text"> quantum-dash</span>
              </div>
              <div className="px-4 py-2 font-[family-name:var(--font-mono)] text-xs text-dim border-b-2 border-transparent">
                <span className="text-green">●</span>
                <span> ml-pipeline</span>
                <span className="text-dim"> · </span>
                <span className="text-green">●</span>
                <span> infra-k8s</span>
              </div>
              <div className="ml-auto px-3 py-2 font-[family-name:var(--font-mono)] text-[10px] text-dim">
                <span className="text-accent">+</span> add pane
              </div>
            </div>

            {/* Pane grid */}
            <div className="grid grid-cols-2 gap-[2px] p-[2px]">
              {/* Pane 1: acme-api */}
              <GridPaneMockup name="acme-api" status="busy" focused>
                <div className="text-green mb-1">&gt; I&apos;ll analyze the authentication module and</div>
                <div className="text-green">{"  "}fix the token refresh bug you mentioned.</div>
                <div className="mt-2">
                  <span className="text-accent">⏺</span> Reading src/auth/token.ts
                </div>
                <div>
                  <span className="text-accent">⏺</span> Reading src/auth/middleware.ts
                </div>
                <div>
                  <span className="text-accent">⏺</span> Grep: refreshToken pattern
                </div>
                <div className="text-green mt-1">
                  Found 3 files with stale token logic.
                  <span className="cursor-blink text-accent">_</span>
                </div>
              </GridPaneMockup>

              {/* Pane 2: quantum-dash */}
              <GridPaneMockup name="quantum-dash" status="idle" elapsed="4m">
                <div className="text-text">I&apos;ve updated the chart component to use</div>
                <div className="text-text">the new streaming data format. Changes:</div>
                <div className="mt-2">
                  <span className="text-green">✓</span> src/components/chart.tsx
                </div>
                <div>
                  <span className="text-green">✓</span> src/hooks/useChartData.ts
                </div>
                <div>
                  <span className="text-green">✓</span> src/types/stream.d.ts
                </div>
                <div className="mt-2 text-yellow">Waiting for your input...</div>
              </GridPaneMockup>

              {/* Pane 3: ml-pipeline */}
              <GridPaneMockup name="ml-pipeline" status="busy">
                <div className="text-green">&gt; Building the BERT fine-tuning pipeline</div>
                <div className="text-green">{"  "}with the new training dataset.</div>
                <div className="mt-2">
                  <span className="text-accent">⏺</span> Writing src/train.py
                </div>
                <div className="mt-1">
                  Processing: epoch 3/10{" "}
                  <span className="text-accent">████████</span>
                  <span className="text-border">░░░░░░░░░░░░</span>{" "}
                  <span className="text-text">30%</span>
                </div>
              </GridPaneMockup>

              {/* Pane 4: infra-k8s */}
              <GridPaneMockup name="infra-k8s" status="busy">
                <div className="text-green">&gt; Updating the Kubernetes deployment</div>
                <div className="text-green">{"  "}manifests for staging.</div>
                <div className="mt-2">
                  <span className="text-accent">⏺</span> Reading k8s/staging/deployment.yaml
                </div>
                <div>
                  <span className="text-accent">⏺</span> Reading k8s/staging/service.yaml
                </div>
                <div className="mt-1 text-green">
                  Scaling replicas 2 → 4 for load test
                  <span className="cursor-blink text-accent">_</span>
                </div>
              </GridPaneMockup>
            </div>
          </div>
        </div>

        {/* Feature callouts */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
          <div className="text-center">
            <div className="font-[family-name:var(--font-pixel)] text-accent text-xs uppercase tracking-wider mb-2">
              Embedded PTY Grid
            </div>
            <p className="font-[family-name:var(--font-mono)] text-dim text-[10px] leading-relaxed">
              Each pane runs a real pseudo-terminal via forkpty(). Full I/O, ANSI colors, resize — no tmux needed.
            </p>
          </div>
          <div className="text-center">
            <div className="font-[family-name:var(--font-pixel)] text-accent text-xs uppercase tracking-wider mb-2">
              Tabbed Workspaces
            </div>
            <p className="font-[family-name:var(--font-mono)] text-dim text-[10px] leading-relaxed">
              Group sessions into tabs. Inline pane names with status icons show what&apos;s running at a glance.
            </p>
          </div>
          <div className="text-center">
            <div className="font-[family-name:var(--font-pixel)] text-accent text-xs uppercase tracking-wider mb-2">
              Pane Controls
            </div>
            <p className="font-[family-name:var(--font-mono)] text-dim text-[10px] leading-relaxed">
              Traffic-light buttons on every pane: close, expand, minimize, plus a folder-open button. Fully mouse-driven.
            </p>
          </div>
        </div>
      </section>

      <PixelDivider />

      {/* ══════ SMART PICKER ══════ */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-4">
          <h2 className="font-[family-name:var(--font-pixel)] text-accent text-sm uppercase tracking-[0.3em] mb-3">
            // THE SMART PICKER
          </h2>
          <p className="font-[family-name:var(--font-mono)] text-dim text-xs max-w-2xl mx-auto leading-relaxed">
            It starts with a smart project picker. cladm reads{" "}
            <code className="text-accent">~/.claude/history.jsonl</code> to discover every project
            you&apos;ve used with Claude Code — git branch, sync status, dirty state, session history, stack detection — all loaded in parallel.
            Select what you need, hit Enter, and the grid workspace takes over.
          </p>
        </div>

        <div className="mt-8">
          <TerminalWindow title="cladm — 8 projects">
            <Image
              src="/demo.gif"
              alt="cladm smart picker showing project navigation and selection"
              width={980}
              height={500}
              className="w-full"
              unoptimized
            />
          </TerminalWindow>
        </div>

        {/* Picker screenshots */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
          <div>
            <div className="flex items-center gap-4 mb-3">
              <div className="h-[2px] flex-1 bg-border" />
              <h3 className="font-[family-name:var(--font-pixel)] text-text text-xs uppercase tracking-wider whitespace-nowrap">
                PROJECT LIST
              </h3>
              <div className="h-[2px] flex-1 bg-border" />
            </div>
            <p className="font-[family-name:var(--font-mono)] text-dim text-[10px] text-center mb-4">
              Sorted by recent Claude usage. Git metadata, session count, and stack tags at a glance.
            </p>
            <TerminalWindow title="cladm — project list">
              <Image
                src="/screenshot-main.png"
                alt="cladm main project list view"
                width={980}
                height={500}
                className="w-full"
              />
            </TerminalWindow>
          </div>

          <div>
            <div className="flex items-center gap-4 mb-3">
              <div className="h-[2px] flex-1 bg-border" />
              <h3 className="font-[family-name:var(--font-pixel)] text-text text-xs uppercase tracking-wider whitespace-nowrap">
                EXPANDED VIEW
              </h3>
              <div className="h-[2px] flex-1 bg-border" />
            </div>
            <p className="font-[family-name:var(--font-mono)] text-dim text-[10px] text-center mb-4">
              Browse branches, past sessions with conversation previews. Resume any session directly.
            </p>
            <TerminalWindow title="cladm — expanded">
              <Image
                src="/screenshot-expanded.png"
                alt="cladm expanded view with sessions"
                width={980}
                height={600}
                className="w-full"
              />
            </TerminalWindow>
          </div>
        </div>
      </section>

      <PixelDivider />

      {/* ══════ LIVE MONITORING ══════ */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="font-[family-name:var(--font-pixel)] text-accent text-sm uppercase tracking-[0.3em] mb-12 text-center">
          // REAL-TIME STATUS
        </h2>

        <div className="max-w-3xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Status indicators */}
            <div className="pixel-border bg-surface p-6">
              <h3 className="font-[family-name:var(--font-pixel)] text-text text-xs uppercase tracking-wider mb-4">
                Session Status
              </h3>
              <div className="space-y-3 font-[family-name:var(--font-mono)] text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-green text-base">●</span>
                  <span className="text-text">Busy</span>
                  <span className="text-dim">— Claude is actively working</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-yellow text-base">◉</span>
                  <span className="text-dim">3m</span>
                  <span className="text-text">Idle</span>
                  <span className="text-dim">— waiting for your input</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-dim text-base">○</span>
                  <span className="text-text ml-[22px]">No session</span>
                  <span className="text-dim">— not running</span>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-border">
                <p className="font-[family-name:var(--font-mono)] text-dim text-[10px] leading-relaxed">
                  Status visible in both picker rows and grid pane headers.
                  Sound + dock bounce on idle transitions.
                </p>
              </div>
            </div>

            {/* Usage tracking */}
            <div className="pixel-border bg-surface p-6">
              <h3 className="font-[family-name:var(--font-pixel)] text-text text-xs uppercase tracking-wider mb-4">
                Usage Tracking
              </h3>
              <div className="space-y-3 font-[family-name:var(--font-mono)] text-[10px]">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-dim">session (5h)</span>
                    <span className="text-text">$2.40 / $5.00</span>
                  </div>
                  <div className="h-2 bg-bg border border-border">
                    <div className="h-full bg-accent" style={{ width: "48%" }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-dim">weekly all-model</span>
                    <span className="text-text">$18.50 / $100</span>
                  </div>
                  <div className="h-2 bg-bg border border-border">
                    <div className="h-full bg-green" style={{ width: "18.5%" }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-dim">monthly total</span>
                    <span className="text-text">$67.20</span>
                  </div>
                  <div className="h-2 bg-bg border border-border">
                    <div className="h-full bg-cyan" style={{ width: "33.6%" }} />
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-border">
                <p className="font-[family-name:var(--font-mono)] text-dim text-[10px] leading-relaxed">
                  Press <Keycap>u</Keycap> in picker mode. Tracks session, weekly,
                  and monthly costs against configurable plan limits.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <PixelDivider />

      {/* ══════ FEATURES ══════ */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="font-[family-name:var(--font-pixel)] text-accent text-sm uppercase tracking-[0.3em] mb-12 text-center">
          // FEATURES
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureBlock
            icon={<TerminalIcon size={28} />}
            title="EMBEDDED GRID"
            desc="Run multiple Claude Code sessions side by side in a tiled terminal grid. Each pane is a real PTY with full I/O — no separate windows needed."
          />
          <FeatureBlock
            icon={<BlocksIcon size={28} />}
            title="TABBED WORKSPACES"
            desc="Group sessions into named tabs. Inline pane indicators show project names and busy/idle status at a glance."
          />
          <FeatureBlock
            icon={<GamepadIcon size={28} />}
            title="PANE CONTROLS"
            desc="Traffic-light buttons on every pane: close, minimize, expand to full screen. Blue button opens the project folder."
          />
          <FeatureBlock
            icon={<SearchIcon size={28} />}
            title="SELECT MODE"
            desc="Double-click any pane to enter select mode. Copy text from the full scrollback buffer — up to 5,000 lines of history."
          />
          <FeatureBlock
            icon={<EyeIcon size={28} />}
            title="LIVE MONITORING"
            desc="Track busy/idle status across all sessions in real time. Elapsed timers show how long each session has been waiting."
          />
          <FeatureBlock
            icon={<TrendingUpIcon size={28} />}
            title="USAGE TRACKING"
            desc="Session, weekly, and monthly cost bars against configurable plan limits. Track all-model and sonnet-only usage."
          />
          <FeatureBlock
            icon={<BellIcon size={28} />}
            title="NOTIFICATIONS"
            desc="Sound + dock bounce when any session finishes. Never miss a completed task across dozens of parallel sessions."
          />
          <FeatureBlock
            icon={<FolderIcon size={28} />}
            title="AUTO-DISCOVERY"
            desc="Reads ~/.claude/history.jsonl to find every project. Git branch, sync status, dirty state — all loaded in parallel."
          />
          <FeatureBlock
            icon={<ThunderIcon size={28} />}
            title="DIRECT PTY"
            desc="Native pseudo-terminal management via forkpty(). No tmux dependency. Zero configuration. Just works."
          />
        </div>
      </section>

      <PixelDivider />

      {/* ══════ CONTROLS ══════ */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="font-[family-name:var(--font-pixel)] text-accent text-sm uppercase tracking-[0.3em] mb-12 text-center">
          // CONTROLS
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* Picker mode */}
          <div className="pixel-border bg-surface p-6">
            <h3 className="font-[family-name:var(--font-pixel)] text-accent text-xs uppercase tracking-wider mb-4 text-center">
              Picker Mode
            </h3>
            <div className="grid grid-cols-2 gap-y-2 font-[family-name:var(--font-mono)] text-xs">
              {[
                ["↑ ↓", "Navigate"],
                ["Space", "Toggle select"],
                ["→", "Expand project"],
                ["←", "Collapse"],
                ["Enter", "Launch grid"],
                ["/", "Filter"],
                ["a", "Select all"],
                ["n", "Deselect all"],
                ["s", "Cycle sort"],
                ["u", "Usage panel"],
                ["i", "Idle sessions"],
                ["f", "Open folder"],
                ["g", "Go to session"],
                ["q", "Quit"],
              ].map(([key, desc]) => (
                <div key={key} className="contents">
                  <div className="text-accent">{key}</div>
                  <div className="text-dim">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Grid mode */}
          <div className="pixel-border bg-surface p-6">
            <h3 className="font-[family-name:var(--font-pixel)] text-accent text-xs uppercase tracking-wider mb-4 text-center">
              Grid Mode
            </h3>
            <div className="grid grid-cols-2 gap-y-2 font-[family-name:var(--font-mono)] text-xs">
              {[
                ["Click", "Focus pane"],
                ["Dbl-click", "Select mode"],
                ["Alt+1-9", "Switch tab"],
                ["Alt+n/p", "Next/prev tab"],
                ["+ button", "Add pane"],
                ["Esc", "Back to picker"],
              ].map(([key, desc]) => (
                <div key={key} className="contents">
                  <div className="text-accent">{key}</div>
                  <div className="text-dim">{desc}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-border">
              <div className="font-[family-name:var(--font-pixel)] text-text text-[10px] uppercase tracking-wider mb-2">
                Pane Buttons
              </div>
              <div className="grid grid-cols-2 gap-y-2 font-[family-name:var(--font-mono)] text-xs">
                {[
                  ["● blue", "Open folder"],
                  ["● green", "Expand pane"],
                  ["● yellow", "Minimize"],
                  ["● red", "Close pane"],
                ].map(([key, desc], i) => (
                  <div key={key} className="contents">
                    <div className={
                      i === 0 ? "text-cyan" :
                      i === 1 ? "text-[#27c93f]" :
                      i === 2 ? "text-yellow" :
                      "text-[#ff5f56]"
                    }>{key}</div>
                    <div className="text-dim">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <PixelDivider />

      {/* ══════ QUICK START ══════ */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="font-[family-name:var(--font-pixel)] text-accent text-sm uppercase tracking-[0.3em] mb-12 text-center">
          // QUICK START
        </h2>

        <div className="max-w-2xl mx-auto">
          <TerminalWindow title="~">
            <div className="p-4 font-[family-name:var(--font-mono)] text-sm space-y-2">
              <div>
                <span className="text-dim">$</span>{" "}
                <span className="text-green">git clone</span>{" "}
                <span className="text-cyan">
                  https://github.com/alezmad/cladm.git
                </span>
              </div>
              <div>
                <span className="text-dim">$</span>{" "}
                <span className="text-green">cd</span> cladm
              </div>
              <div>
                <span className="text-dim">$</span>{" "}
                <span className="text-green">bun install</span>
              </div>
              <div>
                <span className="text-dim">$</span>{" "}
                <span className="text-green">bun link</span>
                <span className="text-dim">
                  {" "}
                  # registers `cladm` globally
                </span>
              </div>
              <div className="pt-2 border-t border-border mt-2">
                <span className="text-dim">$</span>{" "}
                <span className="text-accent">cladm</span>
                <span className="cursor-blink text-accent ml-1">_</span>
              </div>
            </div>
          </TerminalWindow>

          <div className="mt-6 text-center">
            <p className="font-[family-name:var(--font-mono)] text-dim text-xs">
              Try with mock data:{" "}
              <code className="text-yellow">cladm --demo</code>
            </p>
          </div>
        </div>
      </section>

      {/* ══════ NEWSLETTER ══════ */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="max-w-md mx-auto">
          <NewsletterForm />
        </div>
      </section>

      <PixelDivider />

      {/* ══════ AUTHOR ══════ */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="border-2 border-border bg-surface p-8 max-w-md mx-auto text-center">
          <div className="font-[family-name:var(--font-pixel)] text-accent text-xs uppercase tracking-[0.3em] mb-4">
            // BUILT BY
          </div>
          <div className="font-[family-name:var(--font-pixel)] text-text text-lg mb-4">
            Alejandro Mourente
          </div>
          <div className="flex items-center justify-center gap-6 font-[family-name:var(--font-mono)] text-xs">
            <a
              href="https://github.com/alezmad"
              target="_blank"
              rel="noopener noreferrer"
              className="text-dim hover:text-accent transition-colors flex items-center gap-1.5"
            >
              <GithubIcon size={14} />
              github
            </a>
            <a
              href="https://www.linkedin.com/in/alejandro-mourente/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-dim hover:text-accent transition-colors flex items-center gap-1.5"
            >
              <LinkedinIcon size={14} />
              linkedin
            </a>
            <EmailReveal />
          </div>
        </div>
      </section>

      {/* ══════ FOOTER ══════ */}
      <footer className="border-t-4 border-accent mt-8">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="font-[family-name:var(--font-pixel)] text-accent text-sm tracking-widest">
              CLADM
            </div>
            <div className="font-[family-name:var(--font-mono)] text-dim text-xs flex gap-6">
              <a
                href="https://github.com/alezmad/cladm"
                className="hover:text-accent transition-colors"
              >
                GitHub
              </a>
              <a
                href="https://github.com/alezmad/cladm/issues"
                className="hover:text-accent transition-colors"
              >
                Issues
              </a>
              <span>MIT License</span>
            </div>
          </div>
          <div className="mt-6 font-[family-name:var(--font-mono)] text-dim text-[10px] text-center">
            Built with Bun + OpenTUI. Direct PTY grid, no tmux. Pixel art by the cladm creatures.
          </div>
        </div>
      </footer>
    </div>
  );
}
