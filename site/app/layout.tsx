import type { Metadata } from "next";
import { JetBrains_Mono, Silkscreen } from "next/font/google";
import "./globals.css";

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const pixel = Silkscreen({
  variable: "--font-pixel",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "cladm — TUI launcher for Claude Code",
  description:
    "Browse all your projects, see git status at a glance, expand into sessions and branches, then launch everything in parallel Terminal windows.",
  openGraph: {
    title: "cladm",
    description: "TUI launcher for Claude Code sessions",
    url: "https://claudm.com",
    siteName: "cladm",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "cladm",
    description: "TUI launcher for Claude Code sessions",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${mono.variable} ${pixel.variable} bg-bg text-text`}>
        {children}
      </body>
    </html>
  );
}
