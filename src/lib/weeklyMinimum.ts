import { MIN_MINUTES_NEXT_WEEK, MIN_MINUTES_THIS_WEEK, NEAR_MINIMUM_EXTRA_MINUTES } from './statusConfig.ts';
import { ROWS, SLOT_MS, addDays, mondayOf, slotInstantFor, todayIn, zonedToUtc, type CalDate } from './time.ts';

export interface Pick {
  start: number;
  minutes: number;
}

export interface WeekRequirements {
  /** The week we are in (Mon-Fri). null from Friday on: interviews are rarely booked the same day, so only next week counts. */
  current: { mon: CalDate; min: number } | null;
  /** The coming week. `required` on Friday, Saturday and Sunday; otherwise only asked for politely. */
  next: { mon: CalDate; min: number; required: boolean };
}

/**
 * Which weeks need how much, from today's weekday in `tz`.
 * Monday to Thursday: this week 4 h (next week is only asked for politely). Friday, Saturday, Sunday: next week
 * 4 h is required and the current week is not asked for at all.
 */
export function weekRequirements(tz: string, now = Date.now()): WeekRequirements {
  const today = todayIn(tz, now);
  const dow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay(); // 0 Sun .. 6 Sat
  const thisMon = mondayOf(today);
  const nextMon = addDays(thisMon, 7);
  if (dow === 0 || dow === 5 || dow === 6) return { current: null, next: { mon: nextMon, min: MIN_MINUTES_NEXT_WEEK, required: true } };
  return {
    current: { mon: thisMon, min: MIN_MINUTES_THIS_WEEK },
    next: { mon: nextMon, min: MIN_MINUTES_NEXT_WEEK, required: false },
  };
}

/** [start, end) of the Mon-Fri block that starts on `mon`, in `tz`. */
export function weekBounds(mon: CalDate, tz: string): [number, number] {
  const sat = addDays(mon, 5);
  return [zonedToUtc(mon.y, mon.m, mon.d, 0, 0, tz), zonedToUtc(sat.y, sat.m, sat.d, 0, 0, tz)];
}

/** Minutes of future time in [from, to) covered by free 15 minute blocks and picked times. Overlaps count once. */
export function coveredMinutes(slots: Iterable<number>, picks: Pick[], from: number, to: number, now = Date.now()): number {
  const spans: [number, number][] = [];
  for (const s of slots) spans.push([s, s + SLOT_MS]);
  for (const p of picks) spans.push([p.start, p.start + p.minutes * 60000]);
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

export interface WeekStatus {
  mon: CalDate;
  /** What the rule asks for. */
  min: number;
  /** What can still be asked: never more than the time left that can actually be marked. */
  need: number;
  have: number;
  required: boolean;
}

export interface WeeklyCheck {
  current: WeekStatus | null;
  next: WeekStatus;
  /** Weeks that are required and not yet met. Empty = the candidate may finish. */
  unmet: ('current' | 'next')[];
  /** Everything required is met, but only barely: ask politely for more next week. */
  appeal: boolean;
}

/**
 * Where the candidate stands against the weekly minimums.
 * `leadMs` is how soon a block may start (the app's notice period), so a requirement is never
 * higher than the time that can still be marked.
 */
export function checkWeeks(tz: string, slots: Iterable<number>, picks: Pick[], leadMs: number, now = Date.now()): WeeklyCheck {
  const req = weekRequirements(tz, now);
  const list = [...slots];
  const status = (w: { mon: CalDate; min: number }, required: boolean): WeekStatus => {
    const [from, to] = weekBounds(w.mon, tz);
    let room = 0; // minutes that can still be marked in this week
    for (let d = 0; d < 5; d++) {
      for (let r = 0; r < ROWS; r++) if (slotInstantFor(addDays(w.mon, d), r, tz) >= now + leadMs) room += 15;
    }
    return { mon: w.mon, min: w.min, need: Math.min(w.min, room), have: coveredMinutes(list, picks, from, to, now), required };
  };
  const current = req.current ? status(req.current, true) : null;
  const next = status(req.next, req.next.required);
  const unmet: ('current' | 'next')[] = [];
  if (current && current.have < current.need) unmet.push('current');
  if (next.required && next.have < next.need) unmet.push('next');
  // Mon-Thu: only the minimum this week and next week still thin. Fri-Sun: only the minimum for next week.
  const appeal =
    unmet.length === 0 &&
    (current !== null
      ? current.have < current.need + NEAR_MINIMUM_EXTRA_MINUTES && next.have < next.need
      : next.have < next.need + NEAR_MINIMUM_EXTRA_MINUTES);
  return { current, next, unmet, appeal };
}
