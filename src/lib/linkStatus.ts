import type { LinkRow, ManagerLinkData, SuggestedSlot } from './types';
import type { Status } from '../components/ui';
import { coveredMinutes, weekBounds, weekRequirements } from './weeklyMinimum.ts';

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

/** The week the dashboard judges, and the bar for "few": this week Monday to Thursday, the coming week from Friday on (same as the candidate page). */
export function statusTarget(tz: string, now = Date.now()): { from: number; to: number; min: number; nextWeek: boolean } {
  const req = weekRequirements(tz, now);
  const w = req.current ?? req.next; // from Friday on there is no current week: judge the coming one
  const [from, to] = weekBounds(w.mon, tz);
  return { from, to, min: w.min, nextWeek: req.current === null };
}

/** Minutes of valid time in the judged week: free blocks + picks that start in the future. Overlaps count once. */
export function validMinutes(l: StatusInput, tz: string, now = Date.now()): number {
  const { from, to } = statusTarget(tz, now);
  return coveredMinutes(l.upcoming_slots.map((s) => Date.parse(s)), l.upcoming_picks.map((p) => ({ start: Date.parse(p.start), minutes: p.minutes })), from, to, now);
}

/** Exactly one status per active link, evaluated in this order. */
export function linkStatus(l: StatusInput, tz: string, now = Date.now()): Status {
  // 1. the candidate changed something the recruiter has not seen
  if (l.has_unseen_change) return 'New update';
  // 2. the recruiter offered times and the candidate picked none: the next move is the candidate's,
  //    even if they shared availability earlier
  if (l.suggested_count > 0 && l.ranked_count === 0) return 'Waiting for picks';
  const answered = l.slot_count + l.ranked_count > 0;
  if (!answered) return 'Waiting for availability';
  // 3. answered and seen: is there enough valid time in the judged week?
  const mins = validMinutes(l, tz, now);
  const target = statusTarget(tz, now);
  if (mins === 0) return target.nextWeek ? 'No valid times next week' : 'No valid times this week';
  if (mins < target.min) return target.nextWeek ? 'Few valid times next week' : 'Few valid times this week';
  return 'Up to date';
}

export const isWaiting = (s: Status) => s === 'Waiting for picks' || s === 'Waiting for availability';

/** Has the candidate saved anything yet (availability or picks)? */
export const hasAnswered = (l: Pick<LinkRow, 'slot_count' | 'ranked_count'>) => l.slot_count + l.ranked_count > 0;

/**
 * The time shown in "Last update" and used for sorting: the candidate's last change. Recruiter edits do not
 * count. Before the candidate has saved anything it is the creation time (there is no "sent" timestamp).
 */
export const lastUpdateAt = (l: Pick<LinkRow, 'slot_count' | 'ranked_count' | 'created_at' | 'candidate_updated_at' | 'updated_at'>) =>
  Date.parse(hasAnswered(l) ? (l.candidate_updated_at ?? l.updated_at) : l.created_at); // `??`: older servers do not send candidate_updated_at yet

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
