import webpush from "web-push";
import { getSql } from "./db";

export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };

function configured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

function setup(): boolean {
  if (!configured()) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  return true;
}

/**
 * Send one notification to one subscription. A 404/410 from the push service
 * means the device unsubscribed: the row is deleted and `false` returned.
 * Any other failure throws (the caller decides whether that is fatal).
 */
export async function sendTo(sub: PushSub, title: string, body: string): Promise<boolean> {
  if (!setup()) throw new Error("push not configured (VAPID env vars missing)");
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify({ title, body }));
    return true;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await getSql()`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
      return false;
    }
    throw err;
  }
}

/** Send a notification to every stored subscription; prune dead ones. */
export async function broadcast(title: string, body: string): Promise<number> {
  if (!configured()) return 0;
  const subs = (await getSql()`SELECT endpoint, keys FROM push_subscriptions`) as PushSub[];
  let sent = 0;
  for (const sub of subs) {
    try {
      if (await sendTo(sub, title, body)) sent++;
    } catch {
      // one bad endpoint must not stop the nightly broadcast
    }
  }
  return sent;
}
