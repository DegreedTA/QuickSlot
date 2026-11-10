// Time zone helpers built on Intl only (no date library).
// Availability is stored as UTC instants (ms since epoch), one per free 15 minute block.

/** One calendar row: availability and suggested times snap to 15 minutes. */
export const SLOT_MS = 15 * 60 * 1000;
export const SLOTS_PER_HOUR = 4;
export const DAY_START_HOUR = 6; // first row starts at 6:00 AM
export const DAY_END_HOUR = 21; // last row ends at 9:00 PM
export const ROWS = (DAY_END_HOUR - DAY_START_HOUR) * SLOTS_PER_HOUR;
export const WINDOW_DAYS = 30;
/** Nobody can pick a slot that starts sooner than this from now. */
export const LEAD_MINUTES = 180;
export const LEAD_MS = LEAD_MINUTES * 60 * 1000;

export interface Parts {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  mi: number;
  /** 0 = Sunday */
  dow: number;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function partsInZone(ts: number, tz: string): Parts {
  const out: Record<string, string> = {};
  for (const p of dtf(tz).formatToParts(new Date(ts))) out[p.type] = p.value;
  return {
    y: +out.year,
    m: +out.month,
    d: +out.day,
    h: +out.hour % 24,
    mi: +out.minute,
    dow: DOW[out.weekday] ?? 0,
  };
}

/** Offset of `tz` from UTC at instant `ts`, in minutes (positive = ahead of UTC). */
export function tzOffsetMinutes(ts: number, tz: string): number {
  const p = partsInZone(ts, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, 0);
  return Math.round((asUtc - Math.floor(ts / 60000) * 60000) / 60000);
}

/** Wall-clock time in `tz` to a UTC instant. Handles DST by re-checking the offset. */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi, 0);
  let ts = guess - tzOffsetMinutes(guess, tz) * 60000;
  const off2 = tzOffsetMinutes(ts, tz);
  ts = guess - off2 * 60000;
  return ts;
}

/** A calendar date, independent of any zone. */
export interface CalDate {
  y: number;
  m: number;
  d: number;
}

export function addDays(c: CalDate, n: number): CalDate {
  const dt = new Date(Date.UTC(c.y, c.m - 1, c.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function calKey(c: CalDate): string {
  return `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

export function todayIn(tz: string, now = Date.now()): CalDate {
  const p = partsInZone(now, tz);
  return { y: p.y, m: p.m, d: p.d };
}

/** Monday on or before this date. */
export function mondayOf(c: CalDate): CalDate {
  const dow = new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay(); // 0 Sun
  return addDays(c, -((dow + 6) % 7));
}

export function calDiffDays(a: CalDate, b: CalDate): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

// ------------------------------------------------------------- formatting
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${key}|${tz}`;
  let f = fmtCache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
    fmtCache.set(k, f);
  }
  return f;
}

export function formatTime(ts: number, tz: string): string {
  return fmt('t', tz, { hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
}

export function formatDayLong(ts: number, tz: string): string {
  return fmt('dl', tz, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ts));
}

export function formatDateTime(ts: number, tz: string): string {
  return fmt('dt', tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
    new Date(ts),
  );
}

export function formatStamp(ts: number, tz: string): string {
  return fmt('st', tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
}

export function formatCalShort(c: CalDate): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(c.y, c.m - 1, c.d)),
  );
}

export function formatCalWeekday(c: CalDate): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(c.y, c.m - 1, c.d)),
  );
}

export function formatCalFull(c: CalDate): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(c.y, c.m - 1, c.d)),
  );
}

/** "9:00 to 11:30 AM". Avoids repeating AM/PM when both ends share it. */
export function rangeLabel(startTs: number, endTs: number, tz: string): string {
  const a = formatTime(startTs, tz);
  const b = formatTime(endTs, tz);
  const ap = a.slice(-2);
  const bp = b.slice(-2);
  return ap === bp ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
}

export function gmtLabel(tz: string, at = Date.now()): string {
  const off = tzOffsetMinutes(at, tz);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

export function cityOf(tz: string): string {
  const parts = tz.split('/');
  const last = (parts[parts.length - 1] ?? tz).replace(/_/g, ' ');
  // America/Indiana/Knox -> "Knox (Indiana)"
  return parts.length > 2 ? `${last} (${parts[1].replace(/_/g, ' ')})` : last;
}

/**
 * What the time zone box offers before anyone types, in this order. Time zones, not cities: a
 * city only shows up once someone types it (and picking it selects that city's zone).
 * Arizona is left out on purpose: it is Mountain Time, and typing "Arizona" still finds it.
 */
export const SUGGESTED_ZONES = [
  'America/New_York', // US Eastern
  'America/Denver', // US Mountain
  'America/Chicago', // US Central
  'America/Los_Angeles', // US Pacific
  'America/Sao_Paulo', // Brasília
  'Asia/Kolkata', // India
  'Europe/London', // UK & Ireland
  'Europe/Paris', // Central Europe
  'Europe/Athens', // Eastern Europe
];

/** Zones most candidates and recruiters will use, with names people recognise. */
export const COMMON_ZONES: [string, string][] = [
  ['America/New_York', 'US Eastern Time'],
  ['America/Denver', 'US Mountain Time'],
  ['America/Chicago', 'US Central Time'],
  ['America/Los_Angeles', 'US Pacific Time'],
  ['America/Phoenix', 'Arizona'],
  ['America/Halifax', 'Atlantic Canada'],
  ['America/Anchorage', 'Alaska'],
  ['Pacific/Honolulu', 'Hawaii'],
  ['America/Mexico_City', 'Mexico City'],
  ['America/Bogota', 'Bogota'],
  ['America/Sao_Paulo', 'Brasília Time'],
  ['America/Argentina/Buenos_Aires', 'Buenos Aires'],
  ['UTC', 'UTC'],
  ['Europe/London', 'UK & Ireland Time'],
  ['Europe/Dublin', 'Dublin'],
  ['Europe/Lisbon', 'Lisbon'],
  ['Europe/Berlin', 'Central Europe, Berlin'],
  ['Europe/Paris', 'Central European Time'],
  ['Europe/Madrid', 'Central Europe, Madrid'],
  ['Europe/Athens', 'Eastern European Time'],
  ['Europe/Istanbul', 'Istanbul'],
  ['Europe/Moscow', 'Moscow'],
  ['Africa/Lagos', 'Lagos'],
  ['Africa/Cairo', 'Cairo'],
  ['Africa/Johannesburg', 'Johannesburg'],
  ['Africa/Nairobi', 'Nairobi'],
  ['Asia/Dubai', 'Dubai'],
  ['Asia/Karachi', 'Karachi'],
  ['Asia/Kolkata', 'India Standard Time'],
  ['Asia/Dhaka', 'Dhaka'],
  ['Asia/Bangkok', 'Bangkok'],
  ['Asia/Singapore', 'Singapore'],
  ['Asia/Hong_Kong', 'Hong Kong'],
  ['Asia/Shanghai', 'China, Shanghai'],
  ['Asia/Manila', 'Manila'],
  ['Asia/Tokyo', 'Tokyo'],
  ['Asia/Seoul', 'Seoul'],
  ['Australia/Perth', 'Perth'],
  ['Australia/Sydney', 'Sydney'],
  ['Pacific/Auckland', 'Auckland'],
];
const FRIENDLY = new Map(COMMON_ZONES);
// Older names some browsers report for the same places.
FRIENDLY.set('Asia/Calcutta', 'India Standard Time');
FRIENDLY.set('America/Buenos_Aires', 'Buenos Aires');
FRIENDLY.set('Asia/Saigon', 'Ho Chi Minh City');

export const isFriendlyZone = (tz: string) => FRIENDLY.has(tz);

export function zoneName(tz: string): string {
  return FRIENDLY.get(tz) ?? cityOf(tz);
}

export function tzLabel(tz: string, at = Date.now()): string {
  if (tz === 'UTC') return 'UTC';
  return `${zoneName(tz)} (${gmtLabel(tz, at)})`;
}

export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

let zonesCache: string[] | null = null;
export function allZones(): string[] {
  if (zonesCache) return zonesCache;
  let z: string[] = [];
  try {
    z = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    z = [];
  }
  if (!z.includes('UTC')) z = [...z, 'UTC'];
  const br = browserZone();
  if (!z.includes(br)) z = [...z, br];
  zonesCache = z;
  return z;
}

// -------------------------------------------------------------- grouping
export interface Range {
  start: number;
  end: number;
}

/** Merge contiguous 15 minute blocks into ranges. */
export function mergeSlots(starts: number[]): Range[] {
  const s = [...new Set(starts)].sort((a, b) => a - b);
  const out: Range[] = [];
  for (const t of s) {
    const last = out[out.length - 1];
    if (last && last.end === t) last.end = t + SLOT_MS;
    else out.push({ start: t, end: t + SLOT_MS });
  }
  return out;
}

export interface DayGroup {
  key: string;
  label: string;
  ranges: Range[];
}

export function isWeekend(ts: number, tz: string): boolean {
  const d = partsInZone(ts, tz).dow;
  return d === 0 || d === 6;
}

/** Group ranges by local weekday in `tz`. Weekends are left out: nobody interviews on them. */
export function groupByDay(starts: number[], tz: string, from = Date.now() - SLOT_MS): DayGroup[] {
  const future = starts.filter((t) => t + SLOT_MS > from);
  const days = new Map<string, number[]>();
  for (const t of future) {
    const p = partsInZone(t, tz);
    if (p.dow === 0 || p.dow === 6) continue;
    const k = calKey(p);
    if (!days.has(k)) days.set(k, []);
    days.get(k)!.push(t);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, ts]) => ({ key, label: formatDayLong(ts[0], tz), ranges: mergeSlots(ts) }));
}

export function summaryText(starts: number[], tz: string, from?: number): string {
  const groups = groupByDay(starts, tz, from);
  if (!groups.length) return '';
  const lines = groups.map((g) => `${g.label}: ${g.ranges.map((r) => rangeLabel(r.start, r.end, tz)).join(', ')}`);
  return `Availability (times in ${tzLabel(tz)})\n${lines.join('\n')}`;
}

export function slotInstantFor(cal: CalDate, row: number, tz: string): number {
  const minutes = DAY_START_HOUR * 60 + row * (60 / SLOTS_PER_HOUR);
  return zonedToUtc(cal.y, cal.m, cal.d, Math.floor(minutes / 60), minutes % 60, tz);
}
