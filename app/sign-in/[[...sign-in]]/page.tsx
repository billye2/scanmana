import { SignIn } from "@clerk/nextjs";

export const metadata = { title: "Sign in — Scanmana" };

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <h1 className="text-lg font-bold tracking-tight">
        <span className="text-emerald-400">◎</span> Scanmana
      </h1>
      <p className="text-sm text-neutral-400">Sign in with your email code.</p>
      <SignIn
        appearance={{
          variables: {
            colorBackground: "#0a0e14",
            colorPrimary: "#34d399",
            colorForeground: "#e5e5e5",
            colorMutedForeground: "#8b949e",
            colorInput: "#111827",
            colorInputForeground: "#e5e5e5",
            colorNeutral: "#e5e5e5",
            borderRadius: "0.5rem",
          },
        }}
      />
    </main>
  );
}
