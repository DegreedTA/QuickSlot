import type { LinkRow, ManagerLinkData, SuggestedSlot } from './types';
import type { Status } from '../components/ui';
import { FEW_THRESHOLD_MINUTES, WEEKEND_USES_NEXT_WEEK } from './statusConfig';
import { SLOT_MS, addDays, mondayOf, todayIn, zonedToUtc } from './time';

/** [start, end) of the Mon-Fri window that counts as "this week", in the recruiter's zone. */
export function weekWindow(tz: string, now = Date.now()): [number, number] {
  const today = todayIn(tz, now);
  const dow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay(); // 0 Sun, 6 Sat
  const weekend = dow === 0 || dow === 6;
  const mon = weekend && WEEKEND_USES_NEXT_WEEK ? addDays(mondayOf(today), 7) : mondayOf(today);
  const sat = addDays(mon, 5);
  return [zonedToUtc(mon.y, mon.m, mon.d, 0, 0, tz), zonedToUtc(sat.y, sat.m, sat.d, 0, 0, tz)];
}

/** What the status rules need. A dashboard LinkRow already has all of it. */
export type StatusInput = Pick<LinkRow, 'has_unseen_change' | 'slot_count' | 'ranked_count' | 'suggested_count' | 'upcoming_slots' | 'upcoming_picks'>;

/** The detail page has the full link, so build the same input from it. Opening a link marks it seen, hence no unseen change. */
export function statusInputFromLink(d: ManagerLinkData): StatusInput {
  const picked = new Set(d.ranked_choices.map((x) => Date.parse(x)));
  const picks: SuggestedSlot[] = d.suggested_slots.filter((x) => picked.has(Date.parse(x.start)));
  return {
    has_unseen_change: false,
    slot_count: d.slots.length,
    ranked_count: d.ranked_choices.length,
    suggested_count: d.suggested_slots.length,
    upcoming_slots: d.slots,
    upcoming_picks: picks,
  };
}

/** Minutes of valid time: candidate availability + picks that start in the future inside the window. Overlaps count once. */
export function validMinutes(l: StatusInput, tz: string, now = Date.now()): number {
  const [from, to] = weekWindow(tz, now);
  const spans: [number, number][] = [];
  for (const s of l.upcoming_slots) spans.push([Date.parse(s), Date.parse(s) + SLOT_MS]);
  for (const p of l.upcoming_picks) spans.push([Date.parse(p.start), Date.parse(p.start) + p.minutes * 60000]);
  const valid = spans.filter(([a]) => a > now && a >= from && a < to).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of valid) {
    const start = Math.max(a, end);
    if (b > start) total += b - start;
    end = Math.max(end, b);
  }
  return Math.round(total / 60000);
}

/** Exactly one status per active link, evaluated in this order. */
export function linkStatus(l: StatusInput, tz: string, now = Date.now()): Status {
  if (l.has_unseen_change) return 'New update';
  const answered = l.slot_count + l.ranked_count > 0;
  if (!answered) return l.suggested_count > 0 ? 'Waiting for picks' : 'Waiting for availability';
  const mins = validMinutes(l, tz, now);
  if (mins === 0) return 'No valid times this week';
  if (mins < FEW_THRESHOLD_MINUTES) return 'Few valid times this week';
  return 'Up to date';
}

export const isWaiting = (s: Status) => s === 'Waiting for picks' || s === 'Waiting for availability';

/** The time shown in "Last update" and used for sorting. Waiting rows use creation time (there is no "sent" timestamp). */
export const lastUpdateAt = (l: LinkRow, s: Status) => Date.parse(isWaiting(s) ? l.created_at : l.updated_at);

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

/** A batch has no stored name. Labels are created as "<name> 1", "<name> 2"...; recover <name> when they all agree. */
export function batchLabel(labels: string[]): string {
  const bases = labels.map((x) => x.replace(/\s+\d+$/, '').trim());
  if (bases[0] && bases.every((b) => b === bases[0])) return bases[0];
  return labels.find((x) => x.trim()) ?? 'Untitled batch';
}
