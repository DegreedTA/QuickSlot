import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { Tooltip } from './ui';
import { COLUMN_PX, HOUR_PX, gridBackground, heightOf, rowAtY, topOf } from '../lib/calendarGeometry';
import {
  DAY_START_HOUR,
  ROWS,
  SLOT_MS,
  SLOTS_PER_HOUR,
  addDays,
  calKey,
  formatCalShort,
  formatCalWeekday,
  formatDayLong,
  formatTime,
  slotInstantFor,
  type CalDate,
} from '../lib/time';

export interface Suggestion {
  start: number;
  minutes: number;
}

interface Props {
  tz: string;
  /** Monday of the displayed week, as a calendar date in `tz`. */
  weekStart: CalDate;
  /** Candidate's free 15 minute blocks (UTC ms). */
  slots: Set<number>;
  suggestions: Suggestion[];
  /** suggestion start -> 1-based rank the candidate gave it */
  ranks: Map<number, number>;
  /** Rows before this instant cannot be suggested. */
  windowStart: number;
  /** Omit for read-only. Called with a [from, to) range of instants. */
  onSuggestRange?: (from: number, to: number) => void;
  label: string;
}

const hourLabels = Array.from({ length: ROWS / SLOTS_PER_HOUR }, (_, i) => {
  const h = DAY_START_HOUR + i;
  return `${h % 12 === 0 ? 12 : h % 12} ${h >= 12 ? 'PM' : 'AM'}`;
});

/** "2:15 – 3:15 PM" */
const span = (from: number, to: number, tz: string) => {
  const a = formatTime(from, tz);
  const b = formatTime(to, tz);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
};

/**
 * Week calendar for the recruiter. Slots are absolutely positioned blocks (not one button per cell),
 * so a 1 hour suggestion is ONE 55px element. Pointer position maps to time through rowAtY().
 */
export function RecruiterCalendar({ tz, weekStart, slots, suggestions, ranks, windowStart, onSuggestRange, label }: Props) {
  const dragging = useRef<{ c: number; r0: number } | null>(null);
  const [preview, setPreview] = useState<{ c: number; lo: number; hi: number } | null>(null);

  const days = useMemo(() => Array.from({ length: 5 }, (_, c) => addDays(weekStart, c)), [weekStart]);
  // instants[c][r]: start of each 15 minute row in each day column
  const instants = useMemo(() => days.map((d) => Array.from({ length: ROWS }, (_, r) => slotInstantFor(d, r, tz))), [days, tz]);
  const firstRow = useMemo(() => {
    const per = instants.map((col) => col.findIndex((t) => t >= windowStart));
    return per.map((r) => (r === -1 ? ROWS : r));
  }, [instants, windowStart]);

  // continuous runs of free blocks per column
  const free = useMemo(
    () =>
      instants.map((col) => {
        const out: { r: number; len: number }[] = [];
        col.forEach((t, r) => {
          if (!slots.has(t)) return;
          const last = out[out.length - 1];
          if (last && last.r + last.len === r) last.len++;
          else out.push({ r, len: 1 });
        });
        return out;
      }),
    [instants, slots],
  );

  const marks = useMemo(() => {
    const byCol: { s: Suggestion; r: number; rank?: number }[][] = days.map(() => []);
    for (const s of suggestions) {
      const c = instants.findIndex((col) => s.start >= col[0] && s.start < col[ROWS - 1] + SLOT_MS);
      if (c < 0) continue;
      byCol[c].push({ s, r: (s.start - instants[c][0]) / SLOT_MS, rank: ranks.get(s.start) });
    }
    return byCol;
  }, [days, instants, suggestions, ranks]);

  const colEl = useRef<(HTMLDivElement | null)[]>([]);
  const rowFromEvent = (c: number, e: { clientY: number }) => {
    const box = colEl.current[c]!.getBoundingClientRect();
    return rowAtY(e.clientY - box.top);
  };

  function down(c: number, e: PointerEvent<HTMLDivElement>) {
    if (!onSuggestRange || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const r = rowFromEvent(c, e);
    if (r < firstRow[c]) return;
    dragging.current = { c, r0: r };
    setPreview({ c, lo: r, hi: r });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the drag still works while the pointer stays over the column */
    }
  }
  function move(c: number, e: PointerEvent<HTMLDivElement>) {
    const d = dragging.current;
    if (!d || d.c !== c) return;
    const r = Math.max(rowFromEvent(c, e), firstRow[c]);
    setPreview({ c, lo: Math.min(d.r0, r), hi: Math.max(d.r0, r) });
  }
  function up(c: number, e: PointerEvent<HTMLDivElement>) {
    const d = dragging.current;
    if (!d || d.c !== c) return;
    dragging.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const r = Math.max(rowFromEvent(c, e), firstRow[c]);
    const lo = Math.min(d.r0, r);
    const hi = Math.max(d.r0, r);
    setPreview(null);
    onSuggestRange!(instants[c][lo], instants[c][hi] + SLOT_MS);
  }


  return (
    <div className="ds-card rc" role="group" aria-label={label}>
      <div className="rc-head">
        <div />
        {days.map((d) => (
          <div key={calKey(d)} className="rc-day">
            <b>{formatCalWeekday(d)}</b>
            <br />
            <span>{formatCalShort(d)}</span>
          </div>
        ))}
      </div>
      <div className="rc-body">
        <div className="rc-hours" aria-hidden="true">
          {hourLabels.map((h) => (
            <div key={h} style={{ height: HOUR_PX }}>
              {h}
            </div>
          ))}
        </div>
        {days.map((d, c) => (
          <div
            key={calKey(d)}
            ref={(el) => {
              colEl.current[c] = el;
            }}
            className={`rc-col${c === days.length - 1 ? ' is-last' : ''}${onSuggestRange ? ' is-live' : ''}`}
            style={{ height: COLUMN_PX, backgroundImage: gridBackground }}
            onPointerDown={(e) => down(c, e)}
            onPointerMove={(e) => move(c, e)}
            onPointerUp={(e) => up(c, e)}
            onPointerCancel={() => {
              dragging.current = null;
              setPreview(null);
            }}
          >
            {firstRow[c] > 0 && <div className="rc-past" style={{ height: Math.min(firstRow[c], ROWS) * (COLUMN_PX / ROWS) }} aria-hidden="true" />}

            {free[c].map(({ r, len }) => {
              const from = instants[c][r];
              const to = from + len * SLOT_MS;
              const when = span(from, to, tz);
              return (
                <Tooltip key={`f${r}`} label={when} className="rc-slot-wrap" style={{ top: topOf(r * 15), height: heightOf(len * 15) }}>
                  <div className="rc-slot rc-free" tabIndex={0} role="img" aria-label={`Free, ${formatDayLong(from, tz)}, ${when}`} />
                </Tooltip>
              );
            })}

            {marks[c].map(({ s, r, rank }) => {
              const end = s.start + s.minutes * 60000;
              const when = span(s.start, end, tz);
              const picked = rank != null;
              const maxMin = ROWS * 15 - r * 15;
              return (
                <Tooltip
                  key={s.start}
                  label={when}
                  className="rc-slot-wrap is-above"
                  style={{ top: topOf(r * 15), height: heightOf(Math.min(s.minutes, maxMin)) }}
                >
                  <button
                    type="button"
                    className={`rc-slot ${picked ? 'rc-picked' : 'rc-suggested'}`}
                    aria-label={`${picked ? `Selected by candidate, number ${rank}` : 'Suggested'}, ${formatDayLong(s.start, tz)}, ${when}. Press to remove.`}
                    onClick={(e) => {
                      // a mouse click is handled on pointer release; Enter / Space (detail 0) removes it
                      if (e.detail === 0 && onSuggestRange) onSuggestRange(s.start, s.start + SLOT_MS);
                    }}
                  >
                    {picked && <span className="rc-rank">{rank}</span>}
                  </button>
                </Tooltip>
              );
            })}

            {preview && preview.c === c && (
              <div
                className="rc-preview"
                aria-hidden="true"
                style={{ top: topOf(preview.lo * 15), height: heightOf((preview.hi - preview.lo + 1) * 15) }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
