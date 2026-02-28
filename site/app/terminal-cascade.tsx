"use client";

import { useEffect, useState, useCallback } from "react";

const projects = [
  { name: "acme-api", branch: "main", time: "25m ago", status: "busy" as const },
  { name: "quantum-dash", branch: "feat/charts", time: "1h ago", status: "idle" as const, elapsed: "4m" },
  { name: "ml-pipeline", branch: "exp/bert", time: "just now", status: "busy" as const },
];

type Phase =
  | "typing"
  | "selecting"
  | "enter"
  | "grid"
  | "hold"
  | "fadeout"
  | "pause";

export function TerminalCascade() {
  const [phase, setPhase] = useState<Phase>("typing");
  const [selectedCount, setSelectedCount] = useState(0);
  const [cycle, setCycle] = useState(0);

  const runCycle = useCallback(() => {
    setSelectedCount(0);
    setPhase("typing");

    const t1 = setTimeout(() => setPhase("selecting"), 800);
    const t2 = setTimeout(() => setSelectedCount(1), 1200);
    const t3 = setTimeout(() => setSelectedCount(2), 1600);
    const t4 = setTimeout(() => setSelectedCount(3), 2000);
    const t5 = setTimeout(() => setPhase("enter"), 2600);
    const t6 = setTimeout(() => setPhase("grid"), 3400);
    const t7 = setTimeout(() => setPhase("hold"), 4000);
    const t8 = setTimeout(() => setPhase("fadeout"), 7000);
    const t9 = setTimeout(() => {
      setPhase("pause");
      setCycle((c) => c + 1);
    }, 7800);

    return [t1, t2, t3, t4, t5, t6, t7, t8, t9];
  }, []);

  useEffect(() => {
    const delay = cycle === 0 ? 400 : 2000;
    const start = setTimeout(() => {
      const timers = runCycle();
      return () => timers.forEach(clearTimeout);
    }, delay);
    return () => clearTimeout(start);
  }, [cycle, runCycle]);

  const showPicker = phase === "typing" || phase === "selecting" || phase === "enter";
  const showGrid = phase === "grid" || phase === "hold" || phase === "fadeout";

  return (
    <div className="relative w-full min-h-[360px]">
      {/* ── Picker (select projects) ── */}
      <div
        className={`transition-all duration-500 ${
          showPicker ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none absolute inset-0"
        }`}
      >
        <div className="pixel-border bg-surface overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 bg-surface-2 border-b-2 border-border">
            <div className="w-3 h-3 bg-[#ff5f56]" />
            <div className="w-3 h-3 bg-[#ffbd2e]" />
            <div className="w-3 h-3 bg-[#27c93f]" />
            <span className="ml-3 font-[family-name:var(--font-mono)] text-dim text-xs">
              cladm — {selectedCount} selected
            </span>
          </div>
          <div className="p-3 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed">
            <div className="text-dim mb-1 text-[10px]">
              {"  PROJECT              BRANCH       LAST USE"}
            </div>
            {projects.map((proj, i) => {
              const checked = i < selectedCount;
              const isActive = i === selectedCount - 1 && phase === "selecting";
              const dot = proj.status === "busy"
                ? <span className="text-green">●</span>
                : <span className="text-yellow">◉</span>;
              const tag = proj.status === "idle" && proj.elapsed
                ? <span className="text-dim">{proj.elapsed.padEnd(2)}</span>
                : <span> </span>;
              return (
                <div
                  key={`${proj.name}-${cycle}`}
                  className={`px-1 transition-colors duration-150 ${
                    isActive ? "bg-[#283457]" : ""
                  }`}
                >
                  {dot}{tag}
                  <span className={checked ? "text-green" : "text-dim"}>
                    {checked ? "[✓]" : "[ ]"}
                  </span>
                  <span className="text-text"> {proj.name.padEnd(18)}</span>
                  <span className="text-magenta">{proj.branch.padEnd(13)}</span>
                  <span className="text-cyan">{proj.time}</span>
                </div>
              );
            })}
            <div className="px-1 text-dim">
              <span>○</span><span> </span>[ ] pixel-engine{"        "}develop{"      "}3h ago
            </div>

            <div className="mt-3 pt-2 border-t border-border text-[10px]">
              {phase === "enter" ? (
                <span className="text-accent font-bold cascade-flash">
                  ⏎ Launching 3 sessions into grid...
                </span>
              ) : (
                <span className="text-dim">
                  ↑↓ navigate · space toggle · enter launch grid
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Grid workspace (result) ── */}
      <div
        className={`transition-opacity duration-600 ${
          showGrid ? "opacity-100" : "opacity-0 pointer-events-none absolute inset-0"
        }`}
      >
        <div className={`pixel-border bg-surface overflow-hidden ${phase === "hold" ? "cascade-glow" : phase === "grid" ? "cascade-in" : ""}`}>
          {/* Tab bar */}
          <div className="flex items-center bg-surface-2 border-b-2 border-border">
            <div className="px-3 py-1.5 border-b-2 border-accent font-[family-name:var(--font-mono)] text-[9px]">
              <span className="text-green">●</span>
              <span className="text-text"> acme-api</span>
              <span className="text-dim"> · </span>
              <span className="text-yellow">◉</span>
              <span className="text-text"> quantum-dash</span>
            </div>
            <div className="px-3 py-1.5 font-[family-name:var(--font-mono)] text-[9px] text-dim border-b-2 border-transparent">
              <span className="text-green">●</span>
              <span> ml-pipeline</span>
            </div>
          </div>

          {/* Pane grid */}
          <div className="grid grid-cols-2 gap-px bg-border">
            {/* Pane 1: acme-api (busy) */}
            <div className="bg-surface">
              <div className="flex items-center justify-between px-2 py-[3px] border-b border-border">
                <div className="font-[family-name:var(--font-mono)] text-[8px]">
                  <span className="text-green">●</span>
                  <span className="text-text"> acme-api</span>
                </div>
                <div className="flex items-center gap-[3px]">
                  <span className="text-cyan text-[6px]">●</span>
                  <span className="text-[#27c93f] text-[6px]">●</span>
                  <span className="text-[#ff5f56] text-[6px]">●</span>
                </div>
              </div>
              <div className="p-2 font-[family-name:var(--font-mono)] text-[8px] text-dim leading-[1.6] h-[85px]">
                <div className="text-green">&gt; I&apos;ll fix the token refresh bug</div>
                <div>Reading src/auth/token.ts...</div>
                <div>Reading src/auth/middleware.ts...</div>
                <div>Grep: refreshToken pattern<span className="cursor-blink text-accent">_</span></div>
              </div>
            </div>

            {/* Pane 2: quantum-dash (idle) */}
            <div className="bg-surface">
              <div className="flex items-center justify-between px-2 py-[3px] border-b border-border">
                <div className="font-[family-name:var(--font-mono)] text-[8px]">
                  <span className="text-yellow">◉</span>
                  <span className="text-dim"> 4m </span>
                  <span className="text-text">quantum-dash</span>
                </div>
                <div className="flex items-center gap-[3px]">
                  <span className="text-cyan text-[6px]">●</span>
                  <span className="text-[#27c93f] text-[6px]">●</span>
                  <span className="text-[#ff5f56] text-[6px]">●</span>
                </div>
              </div>
              <div className="p-2 font-[family-name:var(--font-mono)] text-[8px] text-dim leading-[1.6] h-[85px]">
                <div className="text-text">Updated chart component</div>
                <div className="text-text">New hook: useChartData.ts</div>
                <div className="text-yellow mt-1">Waiting for input...</div>
              </div>
            </div>

            {/* Pane 3: ml-pipeline (busy, full width) */}
            <div className="bg-surface col-span-2">
              <div className="flex items-center justify-between px-2 py-[3px] border-b border-border">
                <div className="font-[family-name:var(--font-mono)] text-[8px]">
                  <span className="text-green">●</span>
                  <span className="text-text"> ml-pipeline</span>
                </div>
                <div className="flex items-center gap-[3px]">
                  <span className="text-cyan text-[6px]">●</span>
                  <span className="text-[#27c93f] text-[6px]">●</span>
                  <span className="text-[#ff5f56] text-[6px]">●</span>
                </div>
              </div>
              <div className="p-2 font-[family-name:var(--font-mono)] text-[8px] text-dim leading-[1.6] h-[65px]">
                <div className="text-green">&gt; Building BERT fine-tuning pipeline</div>
                <div>Processing dataset: train.jsonl</div>
                <div>Epoch 3/10 <span className="text-accent">████████</span><span className="text-border">░░░░░░░░░░░░</span> 30%</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
