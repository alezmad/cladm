"use client";

import { useState } from "react";

export function EmailReveal() {
  const [revealed, setRevealed] = useState(false);
  const email = [97,103,117,116,109,111,117,64,105,99,108,111,117,100,46,99,111,109]
    .map((c) => String.fromCharCode(c))
    .join("");

  return (
    <button
      className={`transition-colors cursor-pointer ${
        revealed
          ? "text-green"
          : "text-dim hover:text-accent"
      }`}
      onClick={() => setRevealed(true)}
      title="Click to reveal email"
    >
      {revealed ? email : "[reveal email]"}
    </button>
  );
}
