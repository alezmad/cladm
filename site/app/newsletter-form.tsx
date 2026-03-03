/// <reference lib="dom" />
"use client";

import { useState } from "react";

export function NewsletterForm({ project = "cladm" }: { project?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), project }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setStatus("ok");
        setMsg("subscribed");
        setEmail("");
      } else {
        setStatus("error");
        setMsg(data.error || "failed");
      }
    } catch {
      setStatus("error");
      setMsg("network error");
    }
  }

  if (status === "ok") {
    return (
      <div className="pixel-border bg-surface p-6 text-center">
        <div className="font-[family-name:var(--font-pixel)] text-green text-sm mb-2">
          SUBSCRIBED
        </div>
        <p className="font-[family-name:var(--font-mono)] text-dim text-xs">
          You&apos;ll hear about new features and launches.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="pixel-border bg-surface p-6">
      <div className="font-[family-name:var(--font-pixel)] text-accent text-xs uppercase tracking-[0.3em] mb-3 text-center">
        // STAY IN THE LOOP
      </div>
      <p className="font-[family-name:var(--font-mono)] text-dim text-xs text-center mb-5">
        Get notified about new features, releases, and tools I&apos;m building.
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setStatus("idle"); }}
          placeholder="you@example.com"
          required
          className="flex-1 bg-bg border-2 border-border px-4 py-2 font-[family-name:var(--font-mono)] text-text text-xs outline-none focus:border-accent transition-colors placeholder:text-dim/50"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="bg-accent text-bg px-5 py-2 font-[family-name:var(--font-pixel)] text-xs uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-50 cursor-pointer"
        >
          {status === "loading" ? "..." : "SUBSCRIBE"}
        </button>
      </div>
      {status === "error" && (
        <p className="font-[family-name:var(--font-mono)] text-red text-[10px] mt-2 text-center">
          {msg}
        </p>
      )}
    </form>
  );
}
