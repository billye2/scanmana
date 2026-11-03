import Link from "next/link";
import { briefText, type MorningBrief } from "@/lib/paper-engine";

/**
 * "At the open" — tomorrow morning's paper actions in one line, written by
 * `morningBrief` from the book's rows. On the home page it links to /paper;
 * on /paper it is the header line.
 */
export default function MorningLine({ brief, href, className = "" }: { brief: MorningBrief; href?: string; className?: string }) {
  const body = (
    <>
      <span className={`text-[11px] font-semibold uppercase tracking-wide ${brief.empty ? "text-neutral-500" : "text-emerald-400"}`}>At the open</span>
      <p className={`mt-0.5 text-xs leading-snug ${brief.empty ? "text-neutral-500" : "text-neutral-200"}`}>{briefText(brief)}</p>
    </>
  );
  const cls = `block rounded-xl bg-neutral-900 px-3 py-2 ${className}`;
  return href ? (
    <Link href={href} className={`${cls} active:bg-neutral-800`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
