import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { cancelOrder } from "@/lib/paper-db";

export const dynamic = "force-dynamic";

/** Remove an armed manual order before it fills (a broker's cancel). The ticker can be taken again afterwards. */
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as { orderId?: unknown };
  const orderId = Number(body.orderId);
  if (!Number.isInteger(orderId)) return NextResponse.json({ error: "orderId required" }, { status: 400 });
  const r = await cancelOrder(userId, orderId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
