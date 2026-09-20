import { auth } from "@clerk/nextjs/server";
import PaperBook from "@/components/PaperBook";
import TopNav from "@/components/TopNav";
import { ensureAccounts, getBook, type Book } from "@/lib/paper-db";
import { getReplay, type ReplayRow } from "@/lib/research";
import { latestTape, type Tape } from "@/lib/tape";

export const metadata = { title: "Paper trading — Scanmana" };
export const dynamic = "force-dynamic";

/** The paper book: two ledgers priced on the stored EOD bars. Opening this page creates the accounts, and the nightly job serves them from then on. */
export default async function PaperPage() {
  const { userId } = await auth();
  let book: Book | null = null;
  let replay: ReplayRow[] = [];
  let tape: Tape | null = null;
  let error: string | null = null;
  if (userId) {
    try {
      await ensureAccounts(userId);
      book = await getBook(userId);
      replay = await getReplay();
      tape = await latestTape();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 lg:max-w-3xl lg:px-8 pt-[max(env(safe-area-inset-top),12px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <TopNav current="/paper" subtitle="Paper trading" />
      {book ? (
        <PaperBook book={book} replay={replay} tape={tape} />
      ) : (
        <p className="mt-16 text-center text-sm text-neutral-500">
          {error ? `Paper book unavailable — ${error} (run npm run migrate?)` : "Sign in to see your paper book."}
        </p>
      )}
    </main>
  );
}
