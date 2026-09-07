import { safeNext } from "@/lib/auth";

export const metadata = { title: "Sign in — Scanmana" };
export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next ?? null);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xs flex-col justify-center px-4 pb-24">
      <h1 className="text-lg font-bold tracking-tight">
        <span className="text-emerald-400">◎</span> Scanmana
      </h1>
      <form method="post" action="/api/login" className="mt-4 flex flex-col gap-2">
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          className="rounded-xl bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100 outline-none ring-1 ring-neutral-800 focus:ring-emerald-500"
        />
        <button type="submit" className="rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white active:bg-emerald-500">
          Sign in
        </button>
        {sp.error && <p className="text-xs text-red-300">Wrong password.</p>}
      </form>
      <p className="mt-6 text-[11px] leading-relaxed text-neutral-600">
        You stay signed in on this device for three days. Sign in once inside the home-screen app on iPhone — it does not
        share Safari&apos;s cookies.
      </p>
    </main>
  );
}
