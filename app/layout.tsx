import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import SettingsSync from "@/components/SettingsSync";
import { settingsSignature } from "@/lib/nav";
import { readSettings } from "@/lib/settings";
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
  // The reader's text size (1.8.8): chosen on /sections, kept per account since 2.0.3; globals.css scales from the attribute.
  const settings = await readSettings();
  const text = settings.text;
  return (
    <html lang="en" data-text={text === "default" ? undefined : text}>
      <body className="min-h-dvh bg-[#0a0e14] font-sans text-neutral-100 antialiased">
        <ClerkProvider>{children}</ClerkProvider>
        {settings.userId && <SettingsSync sig={settingsSignature(settings)} />}
      </body>
    </html>
  );
}
