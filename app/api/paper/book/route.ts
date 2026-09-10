import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ensureAccounts, getBook } from "@/lib/paper-db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureAccounts(userId);
  return NextResponse.json(await getBook(userId));
}
