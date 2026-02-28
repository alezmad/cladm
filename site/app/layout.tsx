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
  title: "cladm — Claude Code Command Center",
  description:
    "Multiproject workspace for Claude Code. Embedded terminal grid with tabbed workspaces, pane controls, real-time status tracking, usage monitoring, and full keyboard-driven workflow.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "cladm — Claude Code Command Center",
    description: "Manage all your Claude Code sessions from one terminal. Embedded PTY grid, tabbed workspaces, live monitoring, and pane controls.",
    url: "https://claudm.com",
    siteName: "cladm",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "cladm — Claude Code Command Center",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "cladm — Claude Code Command Center",
    description: "Manage all your Claude Code sessions from one terminal. Embedded PTY grid, tabbed workspaces, live monitoring, and pane controls.",
    images: ["/og-image.png"],
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
