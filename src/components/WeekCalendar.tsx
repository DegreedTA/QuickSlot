import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Tooltip } from './ui';
import { COLUMN_PX, HOUR_PX, PX_PER_15, gridBackground, heightOf, rowAtY, topOf } from '../lib/calendarGeometry';
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
  todayIn,
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
  /** Free 15 minute blocks (UTC ms). */
  slots: Set<number>;
  suggestions: Suggestion[];
  /** suggestion start -> 1-based rank the candidate gave it */
  ranks: Map<number, number>;
  /** Rows before this instant cannot be used. */
  windowStart: number;
  /** Rows at or after this instant cannot be used. */
  windowEnd?: number;
  /** Recruiter: drag to suggest. Called with a [from, to) range of instants. */
  onSuggestRange?: (from: number, to: number) => void;
  /** Candidate: click or drag to mark / unmark free time. Called with the new set. */
  onChange?: (next: Set<number>) => void;
  /** Candidate: true while a paint gesture is in progress (pointer pressed), false once it ends. */
  onPaintingChange?: (painting: boolean) => void;
  /** Touch only: a drag paints instead of scrolling. */
  paintMode?: boolean;
  /** No shadow, for use inside another card. */
  flat?: boolean;
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
 * Week calendar, shared by the recruiter and the candidate. Slots are absolutely positioned blocks
 * (not one button per cell), so a 1 hour suggestion is ONE element. Pointer position maps to time
 * through rowAtY() / the column rectangles; the scale lives in calendarGeometry.ts.
 *
 * Modes: onSuggestRange = recruiter drags out suggestions; onChange = candidate paints free time;
 * neither = read only.
 */
export function WeekCalendar({
  tz,
  weekStart,
  slots,
  suggestions,
  ranks,
  windowStart,
  windowEnd = Infinity,
  onSuggestRange,
  onChange,
  onPaintingChange,
  paintMode = false,
  flat = false,
  label,
}: Props) {
  const mode = onChange ? 'edit' : onSuggestRange ? 'suggest' : 'view';
  const dragging = useRef<{ c: number; r0: number } | null>(null);
  const paint = useRef<{ on: boolean; draft: Set<number>; last: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{ c: number; lo: number; hi: number } | null>(null);
  const [cursor, setCursor] = useState<{ c: number; r: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const bodyEl = useRef<HTMLDivElement>(null);
  const cursorEl = useRef<HTMLDivElement>(null);

  const days = useMemo(() => Array.from({ length: 5 }, (_, c) => addDays(weekStart, c)), [weekStart]);
  // instants[c][r]: start of each 15 minute row in each day column
  const instants = useMemo(() => days.map((d) => Array.from({ length: ROWS }, (_, r) => slotInstantFor(d, r, tz))), [days, tz]);
  // usable rows per column are [firstRow, endRow)
  const firstRow = useMemo(() => instants.map((col) => { const r = col.findIndex((t) => t >= windowStart); return r === -1 ? ROWS : r; }), [instants, windowStart]);
  const endRow = useMemo(() => instants.map((col) => { const r = col.findIndex((t) => t >= windowEnd); return r === -1 ? ROWS : r; }), [instants, windowEnd]);
  const usable = (c: number, r: number) => r >= firstRow[c] && r < endRow[c];

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
  const rowFromEvent = (c: number, e: { clientY: number }) => rowAtY(e.clientY - colEl.current[c]!.getBoundingClientRect().top);

  /** The (column, row) under a screen point, or null when it is outside the day columns. */
  function cellAt(x: number, y: number): { c: number; r: number } | null {
    for (let c = 0; c < days.length; c++) {
      const box = colEl.current[c]?.getBoundingClientRect();
      if (!box || x < box.left || x >= box.right) continue;
      if (y < box.top || y >= box.top + COLUMN_PX) return null;
      return { c, r: rowAtY(y - box.top) };
    }
    return null;
  }

  // ---------------------------------------------------------------- recruiter: drag out a suggestion
  function suggestDown(e: PointerEvent<HTMLDivElement>) {
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell || !usable(cell.c, cell.r)) return;
    dragging.current = { c: cell.c, r0: cell.r };
    setPreview({ c: cell.c, lo: cell.r, hi: cell.r });
    capture(e);
  }
  function suggestMove(e: PointerEvent<HTMLDivElement>) {
    const d = dragging.current;
    if (!d) return;
    const r = Math.min(Math.max(rowFromEvent(d.c, e), firstRow[d.c]), endRow[d.c] - 1);
    setPreview({ c: d.c, lo: Math.min(d.r0, r), hi: Math.max(d.r0, r) });
  }
  function suggestUp(e: PointerEvent<HTMLDivElement>) {
    const d = dragging.current;
    if (!d) return;
    dragging.current = null;
    release(e);
    const r = Math.min(Math.max(rowFromEvent(d.c, e), firstRow[d.c]), endRow[d.c] - 1);
    const lo = Math.min(d.r0, r);
    const hi = Math.max(d.r0, r);
    setPreview(null);
    onSuggestRange!(instants[d.c][lo], instants[d.c][hi] + SLOT_MS);
  }

  // ---------------------------------------------------------------- candidate: paint free time
  const enabledAt = (t: number) => t >= windowStart && t < windowEnd;
  function applyTo(draft: Set<number>, t: number, on: boolean) {
    if (!enabledAt(t)) return false;
    if (on === draft.has(t)) return false;
    if (on) draft.add(t);
    else draft.delete(t);
    return true;
  }
  function paintDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch' && !paintMode) return; // a tap arrives as click; a drag scrolls
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    suppressClick.current = true;
    const t = instants[cell.c][cell.r];
    const on = !slots.has(t);
    const draft = new Set(slots);
    paint.current = { on, draft, last: t, x: e.clientX, y: e.clientY };
    onPaintingChange?.(true);
    if (applyTo(draft, t, on)) onChange!(new Set(draft));
    capture(e);
  }
  function paintMove(e: PointerEvent<HTMLDivElement>) {
    const d = paint.current;
    if (!d) return;
    // A fast drag skips cells between events, so walk the line from the last position.
    const steps = Math.max(1, Math.ceil(Math.hypot(e.clientX - d.x, e.clientY - d.y) / 6));
    let changed = false;
    for (let i = 1; i <= steps; i++) {
      const cell = cellAt(d.x + ((e.clientX - d.x) * i) / steps, d.y + ((e.clientY - d.y) * i) / steps);
      if (!cell) continue;
      const t = instants[cell.c][cell.r];
      if (t === d.last) continue;
      d.last = t;
      if (applyTo(d.draft, t, d.on)) changed = true;
    }
    d.x = e.clientX;
    d.y = e.clientY;
    if (changed) onChange!(new Set(d.draft));
  }
  function paintUp(e: PointerEvent<HTMLDivElement>) {
    if (!paint.current) return;
    paint.current = null;
    onPaintingChange?.(false);
    release(e);
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }
  /** A tap (touch, not painting): toggle the one row that was tapped. */
  function tap(e: { clientX: number; clientY: number }) {
    if (mode !== 'edit' || suppressClick.current) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    const t = instants[cell.c][cell.r];
    const draft = new Set(slots);
    if (applyTo(draft, t, !slots.has(t))) onChange!(draft);
  }

  // ---------------------------------------------------------------- keyboard (candidate)
  function say(c: number, r: number, on: boolean) {
    const t = instants[c][r];
    setAnnounce(`${formatDayLong(t, tz)}, ${formatTime(t, tz)}, ${on ? 'free' : 'not free'}`);
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (mode !== 'edit') return;
    const cur = cursor ?? startCell();
    let { c, r } = cur;
    if (e.key === 'ArrowDown') r = Math.min(ROWS - 1, r + 1);
    else if (e.key === 'ArrowUp') r = Math.max(0, r - 1);
    else if (e.key === 'ArrowRight') c = Math.min(days.length - 1, c + 1);
    else if (e.key === 'ArrowLeft') c = Math.max(0, c - 1);
    else if (e.key === 'Home') r = 0;
    else if (e.key === 'End') r = ROWS - 1;
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const t = instants[c][r];
      const draft = new Set(slots);
      if (applyTo(draft, t, !slots.has(t))) onChange!(draft);
      say(c, r, !slots.has(t));
      setCursor({ c, r });
      return;
    } else return;
    e.preventDefault();
    if (e.shiftKey && usable(c, r)) {
      // extend: carry the state of the cell we left onto the next one
      const from = instants[cur.c][cur.r];
      const draft = new Set(slots);
      if (applyTo(draft, instants[c][r], slots.has(from))) onChange!(draft);
      say(c, r, slots.has(from));
    } else say(c, r, slots.has(instants[c][r]));
    setCursor({ c, r });
  }
  function startCell() {
    const c = Math.max(0, endRow.findIndex((end, i) => end > firstRow[i]));
    return { c, r: Math.min(ROWS - 1, Math.max(firstRow[c], 8)) };
  }
  useEffect(() => {
    cursorEl.current?.scrollIntoView?.({ block: 'nearest' });
  }, [cursor]);

  function capture(e: PointerEvent<HTMLDivElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the drag still works while the pointer stays over the calendar */
    }
  }
  function release(e: PointerEvent<HTMLDivElement>) {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  const live = mode !== 'view';
  const todayKey = calKey(todayIn(tz));
  return (
    <div className={`ds-card rc${flat ? ' is-flat' : ''}`} role="group" aria-label={label}>
      <div className="rc-head">
        <div />
        {days.map((d) => (
          <div key={calKey(d)} className={`rc-day${calKey(d) === todayKey ? ' is-today' : ''}`} aria-current={calKey(d) === todayKey ? 'date' : undefined}>
            <b>{formatCalWeekday(d)}</b>
            <br />
            <span>{formatCalShort(d)}</span>
          </div>
        ))}
      </div>
      <div
        ref={bodyEl}
        className={`rc-body${live ? ' is-live' : ''}${mode === 'edit' && paintMode ? ' is-painting' : ''}`}
        tabIndex={mode === 'edit' ? 0 : undefined}
        aria-label={mode === 'edit' ? 'Calendar. Use the arrow keys to move, Space to mark or unmark free time, Shift with an arrow to extend.' : undefined}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          if (mode === 'suggest') suggestDown(e);
          else if (mode === 'edit') paintDown(e);
        }}
        onPointerMove={(e) => (mode === 'suggest' ? suggestMove(e) : mode === 'edit' ? paintMove(e) : undefined)}
        onPointerUp={(e) => (mode === 'suggest' ? suggestUp(e) : mode === 'edit' ? paintUp(e) : undefined)}
        onPointerCancel={(e) => {
          dragging.current = null;
          setPreview(null);
          if (paint.current) paintUp(e);
        }}
        onClick={tap}
        onKeyDown={onKey}
        onFocus={() => mode === 'edit' && !cursor && setCursor(startCell())}
        onBlur={() => setCursor(null)}
      >
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
            className={`rc-col${c === days.length - 1 ? ' is-last' : ''}`}
            style={{ height: COLUMN_PX, backgroundImage: gridBackground }}
          >
            {firstRow[c] > 0 && <div className="rc-past" style={{ top: 0, height: Math.min(firstRow[c], ROWS) * PX_PER_15 }} aria-hidden="true" />}
            {endRow[c] < ROWS && <div className="rc-past" style={{ bottom: 0, height: (ROWS - Math.max(endRow[c], 0)) * PX_PER_15 }} aria-hidden="true" />}

            {free[c].map(({ r, len }) => {
              const from = instants[c][r];
              const to = from + len * SLOT_MS;
              const when = span(from, to, tz);
              const box = { top: topOf(r * 15), height: heightOf(len * 15) };
              if (mode === 'edit') {
                // Pointer handling on the calendar body works from coordinates, so the block can take the
                // pointer (for the time-range tooltip) without getting in the way of painting.
                return (
                  <Tooltip key={`f${r}`} label={when} className="rc-slot-wrap" style={box}>
                    <div className="rc-slot rc-free" aria-hidden="true" />
                  </Tooltip>
                );
              }
              return (
                <Tooltip key={`f${r}`} label={when} className="rc-slot-wrap" style={box}>
                  <div className="rc-slot rc-free" tabIndex={0} role="img" aria-label={`Free, ${formatDayLong(from, tz)}, ${when}`} />
                </Tooltip>
              );
            })}

            {marks[c].map(({ s, r, rank }) => {
              const end = s.start + s.minutes * 60000;
              const when = span(s.start, end, tz);
              const picked = rank != null;
              const maxMin = ROWS * 15 - r * 15;
              const box = { top: topOf(r * 15), height: heightOf(Math.min(s.minutes, maxMin)) };
              const badge = picked && <span className="rc-rank">{rank}</span>;
              if (mode === 'view') {
                return (
                  <div key={s.start} className="rc-slot-wrap rc-static is-above" style={box} aria-hidden="true">
                    <div className={`rc-slot ${picked ? 'rc-picked' : 'rc-suggested'}`}>{badge}</div>
                  </div>
                );
              }
              if (mode === 'edit') {
                return (
                  <Tooltip key={s.start} label={when} className="rc-slot-wrap is-above" style={box}>
                    <div className={`rc-slot ${picked ? 'rc-picked' : 'rc-suggested'}`} aria-hidden="true">
                      {badge}
                    </div>
                  </Tooltip>
                );
              }
              return (
                <Tooltip key={s.start} label={when} className="rc-slot-wrap is-above" style={box}>
                  <button
                    type="button"
                    className={`rc-slot ${picked ? 'rc-picked' : 'rc-suggested'}`}
                    aria-label={`${picked ? `Selected by candidate, number ${rank}` : 'Suggested'}, ${formatDayLong(s.start, tz)}, ${when}.${picked ? '' : ' Press to remove.'}`}
                    onClick={(e) => {
                      // a mouse click is handled on pointer release; Enter / Space (detail 0) removes it
                      if (e.detail === 0 && onSuggestRange) onSuggestRange(s.start, s.start + SLOT_MS);
                    }}
                  >
                    {badge}
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
            {cursor && cursor.c === c && (
              <div ref={cursorEl} className="rc-cursor" aria-hidden="true" style={{ top: cursor.r * PX_PER_15, height: PX_PER_15 }} />
            )}
          </div>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
