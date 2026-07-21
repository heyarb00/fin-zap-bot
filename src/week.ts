const TZ = 'America/Sao_Paulo';

interface DateParts {
  y: number;
  m: number;
  d: number;
}

// Current calendar date in São Paulo timezone.
function spDateParts(now: Date): DateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function toYmd({ y, m, d }: DateParts): number {
  return y * 10000 + m * 100 + d;
}

// Parses "DD/MM/YYYY[ HH:mm:ss]" into a YYYYMMDD integer, or null.
export function parseBrDateToYmd(input: string): number | null {
  if (typeof input !== 'string') return null;
  const m = input.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return y * 10000 + mo * 100 + d;
}

// Monday..Sunday (São Paulo) of the week containing `now`, as YYYYMMDD ints.
export function weekRangeYmd(now: Date): { start: number; end: number } {
  const { y, m, d } = spDateParts(now);
  // Use a UTC date purely for calendar arithmetic (no DST at whole-day steps).
  const base = new Date(Date.UTC(y, m - 1, d));
  const dow = base.getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7;
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() - backToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const asYmd = (dt: Date): number =>
    toYmd({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
  return { start: asYmd(monday), end: asYmd(sunday) };
}

export function isInCurrentWeek(dateStr: string, now: Date): boolean {
  const ymd = parseBrDateToYmd(dateStr);
  if (ymd === null) return false;
  const { start, end } = weekRangeYmd(now);
  return ymd >= start && ymd <= end;
}
