import Image from "next/image";
import { EmailReveal } from "./email-reveal";
import { TerminalCascade } from "./terminal-cascade";
import {
  SearchIcon,
  GithubIcon,
  TerminalIcon,
  FolderIcon,
  NetworkIcon,
  GamepadIcon,
  BlocksIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  LinkedinIcon,
  MailIcon,
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

export default function Home() {
  return (
    <div className="min-h-screen bg-bg selection:bg-accent/30">
      {/* ══════ HERO ══════ */}
      <section className="relative overflow-hidden scanlines">
        {/* Grid background */}
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
                MULTI-PROJECT CLAUDE CODE MONITOR
              </p>

              <p className="font-[family-name:var(--font-mono)] text-dim text-sm max-w-md leading-relaxed mb-8">
                Track all your Claude Code sessions in one place. See
                busy/idle status in real time, monitor usage costs, get
                notified when Claude finishes, and launch everything in
                parallel Terminal windows.
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

            {/* Right — terminal cascade */}
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

      {/* ══════ DEMO GIF ══════ */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-10">
          <h2 className="font-[family-name:var(--font-pixel)] text-accent text-sm uppercase tracking-[0.3em] mb-3">
            // SEE IT IN ACTION
          </h2>
        </div>

        <TerminalWindow title="cladm">
          <Image
            src="/demo.gif"
            alt="cladm demo showing project navigation"
            width={980}
            height={500}
            className="w-full"
            unoptimized
          />
        </TerminalWindow>
      </section>

      <PixelDivider />

      {/* ══════ SCREENSHOTS ══════ */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="font-[family-name:var(--font-pixel)] text-accent text-sm uppercase tracking-[0.3em] mb-12 text-center">
          // SCREENSHOTS
        </h2>

        <div className="space-y-16">
          {/* Main view */}
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="h-[2px] flex-1 bg-border" />
              <h3 className="font-[family-name:var(--font-pixel)] text-text text-xs uppercase tracking-wider whitespace-nowrap">
                PROJECT LIST
              </h3>
              <div className="h-[2px] flex-1 bg-border" />
            </div>
            <p className="font-[family-name:var(--font-mono)] text-dim text-xs text-center mb-6">
              All your projects sorted by recent Claude usage. Git branch, sync
              status, dirty state, session count, and auto-detected stack at a
              glance.
            </p>
            <TerminalWindow title="cladm — 8 projects">
              <Image
                src="/screenshot-main.png"
                alt="cladm main project list view"
                width={980}
                height={500}
                className="w-full"
              />
            </TerminalWindow>
          </div>

          {/* Expanded view */}
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="h-[2px] flex-1 bg-border" />
              <h3 className="font-[family-name:var(--font-pixel)] text-text text-xs uppercase tracking-wider whitespace-nowrap">
                EXPANDED VIEW
              </h3>
              <div className="h-[2px] flex-1 bg-border" />
            </div>
            <p className="font-[family-name:var(--font-mono)] text-dim text-xs text-center mb-6">
              Press <Keycap>&rarr;</Keycap> to expand. Browse branches, see
              session conversations with last prompt and Claude&apos;s response.
              Running sessions show <span className="text-green">● running</span> or{" "}
              <span className="text-yellow">◉ idle</span> status inline. Resume any session directly.
            </p>
            <TerminalWindow title="cladm — 2 selected (1 branch switch)">
              <Image
                src="/screenshot-expanded.png"
                alt="cladm expanded view with sessions and branches"
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
          // LIVE SESSION MONITORING
        </h2>

        <div className="max-w-2xl mx-auto">
          <div className="pixel-border bg-surface p-6">
            <p className="font-[family-name:var(--font-mono)] text-dim text-xs leading-relaxed mb-5">
              cladm detects all running Claude Code sessions across every project and shows their real-time status.
              When any session finishes, a sound plays and the dock icon bounces — so you never miss it, even across dozens of parallel sessions.
            </p>

            <div className="space-y-3 font-[family-name:var(--font-mono)] text-xs">
              <div className="flex items-center gap-3">
                <span className="text-green text-base">●</span>
                <span className="text-text">Busy</span>
                <span className="text-dim">— Claude is actively processing</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-yellow text-base">◉</span>
                <span className="text-dim">3m</span>
                <span className="text-text">Idle</span>
                <span className="text-dim">— Claude finished 3 min ago, waiting for input</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-dim text-base">○</span>
                <span className="text-text ml-[22px]">No session</span>
                <span className="text-dim">— No active Claude process</span>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-border">
              <p className="font-[family-name:var(--font-mono)] text-dim text-[10px] leading-relaxed">
                Detection reads the tail of each session&apos;s JSONL in{" "}
                <code className="text-accent">~/.claude/projects/</code>. A session is
                busy if the file was written recently OR the last assistant message
                has a pending tool call. This prevents false idle triggers during
                long-running tools and subtasks.
              </p>
            </div>
          </div>
        </div>
      </section>

      <PixelDivider />

      {/* ══════ USAGE + IDLE PANELS ══════ */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="font-[family-name:var(--font-pixel)] text-accent text-sm uppercase tracking-[0.3em] mb-12 text-center">
          // USAGE & IDLE PANELS
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Usage panel mock */}
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="h-[2px] flex-1 bg-border" />
              <h3 className="font-[family-name:var(--font-pixel)] text-text text-xs uppercase tracking-wider whitespace-nowrap">
                USAGE TRACKING
              </h3>
              <div className="h-[2px] flex-1 bg-border" />
            </div>
            <div className="pixel-border bg-surface p-5">
              <div className="font-[family-name:var(--font-mono)] text-xs space-y-3">
                <div>
                  <div className="text-text font-bold mb-1">Session</div>
                  <div className="flex items-center gap-2">
                    <span className="text-green">{"████████"}</span>
                    <span className="text-dim">{"░░░░░░░░░░"}</span>
                    <span className="text-text font-bold">22%</span>
                  </div>
                  <div className="text-dim text-[10px] mt-0.5">resets 3h 2m &middot; $1.82/h</div>
                </div>
                <div>
                  <div className="text-text font-bold mb-1">All models <span className="text-dim font-normal">$412</span></div>
                  <div className="flex items-center gap-2">
                    <span className="text-cyan">{"████████████"}</span>
                    <span className="text-dim">{"░░░░░░"}</span>
                    <span className="text-text font-bold">69%</span>
                  </div>
                </div>
                <div>
                  <div className="text-text font-bold mb-1">Sonnet <span className="text-dim font-normal">$31</span></div>
                  <div className="flex items-center gap-2">
                    <span className="text-green">{"█"}</span>
                    <span className="text-dim">{"░░░░░░░░░░░░░░░░░"}</span>
                    <span className="text-text font-bold">5%</span>
                  </div>
                </div>
                <div>
                  <div className="text-text font-bold mb-1">Feb total <span className="text-dim font-normal">$1,847</span></div>
                  <div className="text-dim text-[10px]">$2.41/h avg &middot; 8,234 reqs</div>
                </div>
              </div>
            </div>
            <p className="font-[family-name:var(--font-mono)] text-dim text-[10px] mt-3 leading-relaxed">
              Press <Keycap>u</Keycap> to toggle. Tracks session (5h window), weekly
              all-model and sonnet-only costs against configurable plan limits.
            </p>
          </div>

          {/* Idle sessions panel mock */}
          <div>
            <div className="flex items-center gap-4 mb-4">
              <div className="h-[2px] flex-1 bg-border" />
              <h3 className="font-[family-name:var(--font-pixel)] text-text text-xs uppercase tracking-wider whitespace-nowrap">
                IDLE SESSIONS
              </h3>
              <div className="h-[2px] flex-1 bg-border" />
            </div>
            <div className="pixel-border bg-surface p-5">
              <div className="font-[family-name:var(--font-mono)] text-xs space-y-2">
                <div className="text-dim text-[10px] mb-2">
                  {"  TIME  PROJECT              SESSION"}
                </div>
                <div className="flex gap-2">
                  <span className="text-yellow">◉</span>
                  <span className="text-dim">12s</span>
                  <span className="text-text">acme-api</span>
                  <span className="text-dim ml-auto truncate max-w-[140px]">&quot;Fix rate limiter...&quot;</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-yellow">◉</span>
                  <span className="text-dim">2m{" "}</span>
                  <span className="text-text">quantum-dash</span>
                  <span className="text-dim ml-auto truncate max-w-[140px]">&quot;Build chart tooltip...&quot;</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-yellow">◉</span>
                  <span className="text-dim">8m{" "}</span>
                  <span className="text-text">ml-pipeline</span>
                  <span className="text-dim ml-auto truncate max-w-[140px]">&quot;Add BERT tokenizer...&quot;</span>
                </div>
              </div>
            </div>
            <p className="font-[family-name:var(--font-mono)] text-dim text-[10px] mt-3 leading-relaxed">
              Press <Keycap>i</Keycap> to toggle. Shows sessions waiting for your
              input, sorted by most recently idle. Press Enter to focus a session&apos;s
              Terminal tab directly.
            </p>
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
            icon={<EyeIcon size={28} />}
            title="LIVE MONITORING"
            desc="Track all Claude sessions across every project. Busy/idle status updates in real time with elapsed timers."
          />
          <FeatureBlock
            icon={<TrendingUpIcon size={28} />}
            title="USAGE TRACKING"
            desc="Session, weekly, and monthly cost bars. Track all-model and sonnet-only usage against configurable plan limits."
          />
          <FeatureBlock
            icon={<BellIcon size={28} />}
            title="NOTIFICATIONS"
            desc="Sound + dock bounce when any session finishes. Never miss a completed task across dozens of parallel sessions."
          />
          <FeatureBlock
            icon={<ThunderIcon size={28} />}
            title="FOCUS SESSION"
            desc="Press Enter on any idle session to instantly focus its Terminal tab. Flash animation highlights the window."
          />
          <FeatureBlock
            icon={<SearchIcon size={28} />}
            title="AUTO-DISCOVERY"
            desc="Reads ~/.claude/history.jsonl to find every project you've used with Claude Code. No config needed."
          />
          <FeatureBlock
            icon={<NetworkIcon size={28} />}
            title="GIT METADATA"
            desc="Branch, sync status (ahead/behind), last commit, dirty state — all loaded in parallel per project."
          />
          <FeatureBlock
            icon={<FolderIcon size={28} />}
            title="SESSION BROWSER"
            desc="Expand any project to browse past sessions. See conversation previews and resume directly."
          />
          <FeatureBlock
            icon={<TerminalIcon size={28} />}
            title="PARALLEL LAUNCH"
            desc="Select multiple projects and hit Enter. Each opens in a new Terminal.app window simultaneously."
          />
          <FeatureBlock
            icon={<BlocksIcon size={28} />}
            title="STACK DETECTION"
            desc="Auto-detects project stack: TypeScript, Python, Rust, Go, Docker, and more from config files."
          />
        </div>
      </section>

      <PixelDivider />

      {/* ══════ KEYBINDINGS ══════ */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="font-[family-name:var(--font-pixel)] text-accent text-sm uppercase tracking-[0.3em] mb-12 text-center">
          // CONTROLS
        </h2>

        <div className="max-w-2xl mx-auto">
          <div className="pixel-border bg-surface p-6">
            <div className="grid grid-cols-2 gap-y-3 font-[family-name:var(--font-mono)] text-xs">
              {[
                ["↑ ↓", "Navigate"],
                ["Space", "Toggle selection"],
                ["→", "Expand project"],
                ["←", "Collapse"],
                ["Enter", "Launch selected / focus session"],
                ["i", "Toggle idle sessions panel"],
                ["u", "Toggle usage panel"],
                ["/", "Filter projects"],
                ["a", "Select all"],
                ["n", "Deselect all"],
                ["s", "Cycle sort mode"],
                ["f", "Open folder in Finder"],
                ["g", "Go to active session"],
                ["PgUp PgDn", "Jump 15 rows"],
                ["q / Esc", "Quit"],
              ].map(([key, desc]) => (
                <div key={key} className="contents">
                  <div className="text-accent">{key}</div>
                  <div className="text-dim">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <PixelDivider />

      {/* ══════ INSTALL ══════ */}
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
              Or try with mock data:{" "}
              <code className="text-yellow">cladm --demo</code>
            </p>
          </div>
        </div>
      </section>

      {/* ══════ LAUNCH RESULT ══════ */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="font-[family-name:var(--font-pixel)] text-accent text-sm uppercase tracking-[0.3em] mb-4 text-center">
          // HIT ENTER
        </h2>
        <p className="font-[family-name:var(--font-mono)] text-dim text-xs text-center mb-10 max-w-lg mx-auto">
          Select your projects, press Enter, and watch them all launch in
          parallel. Each project opens a fresh Claude Code session in its own
          Terminal window.
        </p>

        <div className="flex flex-col md:flex-row items-center gap-6">
          {/* Mini cladm picker */}
          <div className="flex-1 w-full">
            <TerminalWindow title="cladm — 3 selected">
              <div className="p-3 font-[family-name:var(--font-mono)] text-[10px] leading-relaxed">
                <div className="text-dim mb-1">
                  {"     PROJECT              BRANCH   LAST USE"}
                </div>
                <div className="bg-[#283457] px-1">
                  <span className="text-green">●</span>
                  <span className="text-green"> [✓]</span>
                  <span className="text-text">
                    {" "}
                    acme-api{"             "}
                  </span>
                  <span className="text-magenta">main</span>
                  <span className="text-cyan">{"     "}25m ago</span>
                </div>
                <div className="px-1">
                  <span className="text-yellow">◉</span>
                  <span className="text-dim">2m</span>
                  <span className="text-green">[✓]</span>
                  <span className="text-text"> quantum-dashboard{"    "}</span>
                  <span className="text-magenta">feat/cha</span>
                  <span className="text-cyan">{"  "}1h ago</span>
                </div>
                <div className="px-1">
                  <span className="text-green">●</span>
                  <span className="text-green"> [✓]</span>
                  <span className="text-text"> ml-pipeline{"          "}</span>
                  <span className="text-magenta">exp/bert</span>
                  <span className="text-cyan">{" "}just now</span>
                </div>
                <div className="px-1">
                  <span className="text-dim">○</span>
                  <span className="text-dim"> [ ]</span>
                  <span className="text-dim"> pixel-engine{"          "}develop{"  "}3h ago</span>
                </div>
              </div>
            </TerminalWindow>
          </div>

          {/* Arrow */}
          <div className="font-[family-name:var(--font-pixel)] text-accent text-2xl flex-shrink-0 rotate-90 md:rotate-0">
            &gt;&gt;&gt;
          </div>

          {/* Claude Code terminals */}
          <div className="flex-1 w-full">
            <div className="relative">
              {/* Stacked terminal windows effect */}
              <div className="absolute top-3 left-3 right-[-3px] bottom-[-3px] border-2 border-border bg-surface-2 opacity-40" />
              <div className="absolute top-[6px] left-[6px] right-[-6px] bottom-[-6px] border-2 border-border bg-surface-2 opacity-20" />
              <TerminalWindow title="claude — acme-api">
                <Image
                  src="/claude-terminal.webp"
                  alt="Claude Code session launched in Terminal"
                  width={960}
                  height={518}
                  className="w-full"
                />
              </TerminalWindow>
            </div>
          </div>
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
            Built with Bun + OpenTUI. Pixel art by the cladm creatures.
          </div>
        </div>
      </footer>
    </div>
  );
}
