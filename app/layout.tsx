import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { cookies } from "next/headers";
import { TEXT_COOKIE, parseTextSize } from "@/lib/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scanmana",
  description: "End-of-day scanner for Kullamägi's 5-star breakout setup: finds leaders resting in a tight range and prices the night-before entry and stop",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Scanmana" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0a0e14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The reader's text size (1.8.8): chosen on /sections, kept per device; globals.css scales from the attribute.
  const text = parseTextSize((await cookies()).get(TEXT_COOKIE)?.value);
  return (
    <html lang="en" data-text={text === "default" ? undefined : text}>
      <body className="min-h-dvh bg-[#0a0e14] font-sans text-neutral-100 antialiased">
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
