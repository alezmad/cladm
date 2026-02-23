"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";

const projects = [
  { name: "acme-api", branch: "main", time: "25m ago" },
  { name: "quantum-dash", branch: "feat/charts", time: "1h ago" },
  { name: "ml-pipeline", branch: "exp/bert", time: "just now" },
];

type Phase =
  | "typing"      // cladm console visible, cursor selecting projects
  | "selecting"   // checkboxes toggling on one by one
  | "enter"       // "Enter" flash, cladm fades
  | "cascade"     // terminals fly in
  | "hold"        // terminals visible
  | "fadeout"     // everything fades, restart
  | "pause";      // brief gap before loop

export function TerminalCascade() {
  const [phase, setPhase] = useState<Phase>("typing");
  const [selectedCount, setSelectedCount] = useState(0);
  const [cycle, setCycle] = useState(0);

  const runCycle = useCallback(() => {
    setSelectedCount(0);
    setPhase("typing");

    // Typing/appear cladm console
    const t1 = setTimeout(() => setPhase("selecting"), 800);

    // Toggle checkboxes one by one
    const t2 = setTimeout(() => setSelectedCount(1), 1200);
    const t3 = setTimeout(() => setSelectedCount(2), 1600);
    const t4 = setTimeout(() => setSelectedCount(3), 2000);

    // Enter pressed
    const t5 = setTimeout(() => setPhase("enter"), 2600);

    // Cascade terminals in
    const t6 = setTimeout(() => setPhase("cascade"), 3200);

    // Hold
    const t7 = setTimeout(() => setPhase("hold"), 3800);

    // Fade out
    const t8 = setTimeout(() => setPhase("fadeout"), 6200);

    // Pause then restart
    const t9 = setTimeout(() => {
      setPhase("pause");
      setCycle((c) => c + 1);
    }, 7000);

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

  const showCladm = phase === "typing" || phase === "selecting" || phase === "enter";
  const showCascade = phase === "cascade" || phase === "hold" || phase === "fadeout";

  return (
    <div className="relative w-full min-h-[340px]">
      {/* ── CLADM console (cause) ── */}
      <div
        className={`transition-all duration-500 ${
          showCladm ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none absolute inset-0"
        }`}
      >
        <div className="pixel-border bg-surface overflow-hidden">
          {/* Title bar */}
          <div className="flex items-center gap-2 px-4 py-2 bg-surface-2 border-b-2 border-border">
            <div className="w-3 h-3 bg-[#ff5f56]" />
            <div className="w-3 h-3 bg-[#ffbd2e]" />
            <div className="w-3 h-3 bg-[#27c93f]" />
            <span className="ml-3 font-[family-name:var(--font-mono)] text-dim text-xs">
              cladm — {selectedCount} selected
            </span>
          </div>
          {/* Project rows */}
          <div className="p-3 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed">
            <div className="text-dim mb-1 text-[10px]">
              {"  PROJECT              BRANCH       LAST USE"}
            </div>
            {projects.map((proj, i) => {
              const checked = i < selectedCount;
              const isActive = i === selectedCount - 1 && phase === "selecting";
              return (
                <div
                  key={`${proj.name}-${cycle}`}
                  className={`px-1 transition-colors duration-150 ${
                    isActive ? "bg-[#283457]" : ""
                  }`}
                >
                  <span className={checked ? "text-green" : "text-dim"}>
                    {checked ? "[✓]" : "[ ]"}
                  </span>
                  <span className="text-text"> {proj.name.padEnd(20)}</span>
                  <span className="text-magenta">{proj.branch.padEnd(13)}</span>
                  <span className="text-cyan">{proj.time}</span>
                </div>
              );
            })}
            <div className="px-1 text-dim">
              [ ] pixel-engine{"          "}develop{"      "}3h ago
            </div>

            {/* Enter hint */}
            <div className="mt-3 pt-2 border-t border-border text-[10px]">
              {phase === "enter" ? (
                <span className="text-accent font-bold cascade-flash">
                  ⏎ Launching 3 projects...
                </span>
              ) : (
                <span className="text-dim">
                  ↑↓ navigate · space toggle · enter launch
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Terminal cascade (effect) ── */}
      <div
        className={`transition-opacity duration-500 ${
          showCascade ? "opacity-100" : "opacity-0 pointer-events-none absolute inset-0"
        }`}
      >
        <div className="relative h-[320px]">
          {projects.map((proj, i) => (
            <div
              key={`term-${proj.name}-${cycle}`}
              className={`absolute left-0 right-0 border-2 bg-surface overflow-hidden
                ${phase === "cascade" || phase === "hold" ? "cascade-in" : ""}
                ${phase === "hold" && i === projects.length - 1 ? "cascade-glow" : ""}`}
              style={{
                animationDelay: `${i * 0.2}s`,
                top: `${i * 80}px`,
                marginLeft: `${i * 16}px`,
                marginRight: `${(projects.length - 1 - i) * 16}px`,
                zIndex: i + 1,
                borderColor: "var(--color-border)",
              }}
            >
              <div className="flex items-center gap-1.5 px-3 py-1 bg-surface-2 border-b border-border">
                <div className="w-[7px] h-[7px] bg-[#ff5f56]" />
                <div className="w-[7px] h-[7px] bg-[#ffbd2e]" />
                <div className="w-[7px] h-[7px] bg-[#27c93f]" />
                <span className="ml-2 font-[family-name:var(--font-mono)] text-dim text-[9px] truncate">
                  claude — {proj.name}
                </span>
              </div>
              <Image
                src="/claude-welcome.png"
                alt="Claude Code welcome screen"
                width={570}
                height={260}
                className="w-full h-auto"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
