"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type Phase = "boot" | "prompt" | "sending" | "done";

const BOOT_LINES = [
  { text: "$ cladm --subscribe", delay: 0 },
  { text: "Scanning newsletters...", delay: 400, dim: true },
  { text: "Found: cladm releases, new tools, project updates", delay: 800, dim: true },
  { text: "", delay: 1100 },
  { text: "Ready. Enter your email to subscribe.", delay: 1200, accent: true },
];

export function SubscribeModal() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("boot");
  const [bootIndex, setBotIndex] = useState(0);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Show modal after 15s or on scroll past 60%
  useEffect(() => {
    if (sessionStorage.getItem("cladm-subscribed")) return;

    const timer = setTimeout(() => setOpen(true), 15000);

    function onScroll() {
      const pct = window.scrollY / (document.body.scrollHeight - window.innerHeight);
      if (pct > 0.6) {
        setOpen(true);
        window.removeEventListener("scroll", onScroll);
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Boot sequence
  useEffect(() => {
    if (!open || phase !== "boot") return;
    if (bootIndex >= BOOT_LINES.length) {
      setPhase("prompt");
      return;
    }
    const t = setTimeout(
      () => setBotIndex((i) => i + 1),
      (BOOT_LINES[bootIndex]?.delay ?? 0) - (bootIndex > 0 ? BOOT_LINES[bootIndex - 1]?.delay ?? 0 : 0) || 300
    );
    return () => clearTimeout(t);
  }, [open, phase, bootIndex]);

  // Focus input when prompt phase starts
  useEffect(() => {
    if (phase === "prompt") inputRef.current?.focus();
  }, [phase]);

  const dismiss = useCallback(() => {
    setOpen(false);
    setPhase("boot");
    setBotIndex(0);
    setEmail("");
    setError("");
  }, []);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setPhase("sending");
    setError("");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), project: "cladm" }),
      });
      const data = await res.json();
      if (data.ok) {
        setPhase("done");
        sessionStorage.setItem("cladm-subscribed", "1");
      } else {
        setError(data.error || "failed");
        setPhase("prompt");
      }
    } catch {
      setError("network error");
      setPhase("prompt");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && dismiss()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Terminal */}
      <div className="relative w-full max-w-lg pixel-border bg-surface overflow-hidden cascade-in">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-2 bg-surface-2 border-b-2 border-border">
          <button
            onClick={dismiss}
            className="w-3 h-3 bg-[#ff5f56] hover:brightness-125 cursor-pointer"
            aria-label="Close"
          />
          <div className="w-3 h-3 bg-[#ffbd2e]" />
          <div className="w-3 h-3 bg-[#27c93f]" />
          <span className="ml-3 font-[family-name:var(--font-mono)] text-dim text-xs">
            cladm — subscribe
          </span>
        </div>

        {/* Terminal body */}
        <div className="p-5 font-[family-name:var(--font-mono)] text-xs leading-relaxed min-h-[180px]">
          {/* Boot lines */}
          {BOOT_LINES.slice(0, bootIndex).map((line, i) => (
            <div
              key={i}
              className={
                line.accent ? "text-accent" : line.dim ? "text-dim" : "text-green"
              }
            >
              {line.text || "\u00A0"}
            </div>
          ))}

          {/* Prompt */}
          {phase === "prompt" && (
            <>
              <form onSubmit={handleSubmit} className="flex items-center gap-0 mt-2">
                <span className="text-accent font-[family-name:var(--font-pixel)] text-[10px] mr-2">
                  email&gt;
                </span>
                <input
                  ref={inputRef}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="flex-1 bg-transparent text-text outline-none placeholder:text-dim/40 caret-accent font-[family-name:var(--font-mono)] text-xs"
                  autoComplete="email"
                  required
                />
                <span className="cursor-blink text-accent">_</span>
              </form>
              {error && <div className="text-[#ff5f56] mt-1">Error: {error}</div>}
              <div className="text-dim text-[10px] mt-3">
                press <span className="text-text">Enter</span> to subscribe{" "}
                &middot; <span className="text-text">Esc</span> to dismiss
              </div>
            </>
          )}

          {/* Sending */}
          {phase === "sending" && (
            <div className="text-yellow mt-2">Subscribing...</div>
          )}

          {/* Done */}
          {phase === "done" && (
            <div className="mt-2 space-y-1">
              <div className="text-green">Subscribed successfully.</div>
              <div className="text-dim">
                You&apos;ll hear about new releases and tools.
              </div>
              <div className="text-dim text-[10px] mt-3">
                press <span className="text-text">Esc</span> or click outside to close
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
