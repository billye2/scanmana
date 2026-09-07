import webpush from "web-push";
import { getSql } from "./db";

function configured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

/** Send a notification to every stored subscription; prune dead ones. */
export async function broadcast(title: string, body: string): Promise<number> {
  if (!configured()) return 0;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  const sql = getSql();
  const subs = (await sql`SELECT endpoint, keys FROM push_subscriptions`) as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }[];
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify({ title, body }),
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await sql`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
      }
    }
  }
  return sent;
}
