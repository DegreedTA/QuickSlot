import {
  COMFORTABLE_MINUTES_NEXT_WEEK,
  MIN_MINUTES_MON_WED,
  MIN_MINUTES_NEXT_WEEK,
  MIN_MINUTES_THU,
  NEAR_MINIMUM_EXTRA_MINUTES,
} from './statusConfig.ts';
import {
  ROWS,
  SLOT_MS,
  addDays,
  calDiffDays,
  calKey,
  mondayOf,
  slotInstantFor,
  todayIn,
  zonedToUtc,
  type CalDate,
} from './time.ts';

/**
 * A week's minimum, scaled down by the days the candidate marked unavailable, then rounded UP to a
 * whole hour so the ask is always a round number. From the 4 h minimum: 2 free days ask 2 h, 3 days
 * 3 h, 4 days 4 h (a single day off does not lower the bar), 5 days 4 h. No free days: nothing.
 */
export function scaleMinutes(minutes: number, freeDays: number): number {
  if (freeDays <= 0) return 0;
  return Math.ceil((minutes * freeDays) / 5 / 60) * 60;
}

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
 * Monday to Wednesday: this week 4 h. Thursday: this week 2 h. Next week is only asked for politely on Monday to
 * Thursday. Friday, Saturday, Sunday: next week 4 h is required and the current week is not asked for at all.
 */
export function weekRequirements(tz: string, now = Date.now()): WeekRequirements {
  const today = todayIn(tz, now);
  const dow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay(); // 0 Sun .. 6 Sat
  const thisMon = mondayOf(today);
  const nextMon = addDays(thisMon, 7);
  if (dow === 0 || dow === 5 || dow === 6) return { current: null, next: { mon: nextMon, min: MIN_MINUTES_NEXT_WEEK, required: true } };
  return {
    current: { mon: thisMon, min: dow <= 3 ? MIN_MINUTES_MON_WED : MIN_MINUTES_THU },
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
  /** Days Monday to Friday that are not marked unavailable. 0 means nothing is asked of this week. */
  freeDays: number;
  /** Where the week sits relative to today, for the wording of the notice. */
  when: 'this' | 'next' | 'later';
}

export interface WeeklyCheck {
  current: WeekStatus | null;
  next: WeekStatus;
  /**
   * The week the minimum rolled to because the week normally asked for is entirely unavailable.
   * Null when nothing rolled.
   */
  rolled: WeekStatus | null;
  /** Weeks that are required and not yet met. Empty = nothing more is being asked for. */
  unmet: WeekStatus[];
  /**
   * Everything required is met, but only barely: which polite request to show.
   * 'this_week' (Mon-Wed, only the 4 h), 'next_week' (Thu, only the 2 h and little next week),
   * 'more' (Fri-Sun, less than 6 h next week; the candidate is already on that week, so the text
   * must not say "next week" or it reads as the week after).
   */
  appeal: 'this_week' | 'next_week' | 'more' | null;
}

/**
 * Where the candidate stands against the weekly minimums.
 * `leadMs` is how soon a block may start (the app's notice period), so a requirement is never
 * higher than the time that can still be marked. `offDays` are whole days the candidate marked
 * unavailable ('YYYY-MM-DD' in `tz`): they offer no room and scale the minimum down.
 */
export function checkWeeks(
  tz: string,
  slots: Iterable<number>,
  picks: Pick[],
  leadMs: number,
  now = Date.now(),
  offDays: Iterable<string> = [],
): WeeklyCheck {
  const req = weekRequirements(tz, now);
  const list = [...slots];
  const off = new Set(offDays);
  const thisMon = mondayOf(todayIn(tz, now));
  const status = (w: { mon: CalDate; min: number }, required: boolean): WeekStatus => {
    const [from, to] = weekBounds(w.mon, tz);
    let room = 0; // minutes that can still be marked in this week
    let freeDays = 0;
    for (let d = 0; d < 5; d++) {
      const day = addDays(w.mon, d);
      if (off.has(calKey(day))) continue; // an unavailable day offers no room and is not counted
      freeDays++;
      for (let r = 0; r < ROWS; r++) if (slotInstantFor(day, r, tz) >= now + leadMs) room += 15;
    }
    const weeksOut = Math.round(calDiffDays(thisMon, w.mon) / 7);
    return {
      mon: w.mon,
      min: w.min, // the rule's own figure; `need` is what is actually asked for
      need: Math.min(scaleMinutes(w.min, freeDays), room),
      have: coveredMinutes(list, picks, from, to, now),
      required,
      freeDays,
      when: weeksOut <= 0 ? 'this' : weeksOut === 1 ? 'next' : 'later',
    };
  };
  const current = req.current ? status(req.current, true) : null;
  const next = status(req.next, req.next.required);

  // A week with no free days can be asked for nothing, but the candidate still has to offer time
  // somewhere: the minimum rolls forward to the first later week that has a day left.
  const target = current ?? next;
  let rolled: WeekStatus | null = null;
  if (target.freeDays === 0) {
    for (let k = 1, mon = addDays(target.mon, 7); k <= 4; k++, mon = addDays(mon, 7)) {
      const st = status({ mon, min: MIN_MINUTES_NEXT_WEEK }, true);
      if (st.freeDays > 0) {
        rolled = st;
        break;
      }
    }
  }

  const unmet: WeekStatus[] = [];
  if (rolled) {
    if (rolled.have < rolled.need) unmet.push(rolled);
  } else {
    if (current && current.have < current.need) unmet.push(current);
    if (next.required && next.have < next.need) unmet.push(next);
  }

  // Nothing is nudged while something is still required, and a week with no free days is never nudged.
  let appeal: WeeklyCheck['appeal'] = null;
  if (unmet.length === 0) {
    const comfort = (w: WeekStatus) => Math.max(w.need, scaleMinutes(COMFORTABLE_MINUTES_NEXT_WEEK, w.freeDays));
    if (rolled) {
      if (rolled.have < comfort(rolled)) appeal = 'more';
    } else if (current === null) {
      if (next.freeDays > 0 && next.have < comfort(next)) appeal = 'more';
    } else if (current.freeDays > 0 && current.have < current.need + NEAR_MINIMUM_EXTRA_MINUTES) {
      if (current.min === MIN_MINUTES_MON_WED) appeal = 'this_week';
      else if (next.freeDays > 0 && next.have < next.need) appeal = 'next_week';
    }
  }
  return { current, next, rolled, unmet, appeal };
}
