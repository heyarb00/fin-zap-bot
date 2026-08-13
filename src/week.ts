const TZ = 'America/Sao_Paulo';

export interface DateParts {
  y: number;
  m: number;
  d: number;
}

// Current calendar date in São Paulo timezone.
export function spDateParts(now: Date): DateParts {
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

// Google Sheets serial (days since 1899-12-30) -> Date whose UTC parts equal
// the value as displayed in the sheet. 25569 = serial of 1970-01-01.
function serialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

// A Gastos column-A cell may come back as a "DD/MM/YYYY ..." string OR, when the
// cell holds a real datetime read UNFORMATTED, as a serial number. Normalize both.
export function cellToYmd(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const dt = serialToDate(v);
    return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
  }
  if (typeof v === 'string') return parseBrDateToYmd(v);
  return null;
}

// "DD/MM HH:mm" label from either a serial number or a "DD/MM/YYYY HH:mm:ss" string.
export function cellDateLabel(v: unknown): string {
  const p2 = (n: number): string => String(n).padStart(2, '0');
  if (typeof v === 'number' && Number.isFinite(v)) {
    const dt = serialToDate(v);
    return `${p2(dt.getUTCDate())}/${p2(dt.getUTCMonth() + 1)} ${p2(dt.getUTCHours())}:${p2(dt.getUTCMinutes())}`;
  }
  const s = String(v ?? '').trim();
  const ddmm = s.slice(0, 5);
  const hhmm = s.slice(11, 16);
  return hhmm ? `${ddmm} ${hhmm}` : ddmm;
}

// Sunday..Saturday (São Paulo) of the week containing `now`, as YYYYMMDD ints.
// Matches the Dashboard, whose week starts on Sunday (WEEKDAY type 1).
export function weekRangeYmd(now: Date): { start: number; end: number } {
  const { y, m, d } = spDateParts(now);
  // Use a UTC date purely for calendar arithmetic (no DST at whole-day steps).
  const base = new Date(Date.UTC(y, m - 1, d));
  const dow = base.getUTCDay(); // 0=Sun..6=Sat
  const sunday = new Date(base);
  sunday.setUTCDate(base.getUTCDate() - dow);
  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);
  const asYmd = (dt: Date): number =>
    toYmd({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
  return { start: asYmd(sunday), end: asYmd(saturday) };
}

export function isInCurrentWeek(cell: unknown, now: Date): boolean {
  const ymd = cellToYmd(cell);
  if (ymd === null) return false;
  const { start, end } = weekRangeYmd(now);
  return ymd >= start && ymd <= end;
}
