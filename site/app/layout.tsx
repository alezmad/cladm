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
  title: "cladm — Monitor & launch Claude Code sessions",
  description:
    "Multi-project Claude Code session monitor. Track busy/idle status in real time, see usage costs, get notified when Claude finishes, and launch everything in parallel.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "cladm",
    description: "Monitor & launch Claude Code sessions across all your projects",
    url: "https://claudm.com",
    siteName: "cladm",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "cladm — Monitor & launch Claude Code sessions",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "cladm",
    description: "Monitor & launch Claude Code sessions across all your projects",
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
