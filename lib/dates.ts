const ET_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

/** A moment (ms epoch) as its US Eastern calendar date, YYYY-MM-DD. */
export function etDate(ms: number): string {
  return ET_FMT.format(new Date(ms));
}

/** Today's date in US Eastern time as YYYY-MM-DD. */
export function etToday(): string {
  return etDate(Date.now());
}

/** date string +/- n calendar days -> YYYY-MM-DD (UTC math, safe for date-only). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}
