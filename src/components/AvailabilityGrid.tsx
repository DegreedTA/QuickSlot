import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
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
  /** Free 15 minute blocks, as UTC instants in ms. */
  slots: Set<number>;
  /** Omit for a read-only grid. */
  onChange?: (next: Set<number>) => void;
  /** Cells outside [windowStart, windowEnd) cannot be changed. */
  windowStart?: number;
  windowEnd?: number;
  suggestions?: Suggestion[];
  /** start instant of a suggestion -> 1-based rank chosen by the candidate */
  ranks?: Map<number, number>;
  /** touch devices: dragging paints instead of scrolling */
  paintMode?: boolean;
  /** 5 (Mon to Fri) or 7 */
  days?: 5 | 7;
  label: string;
  /**
   * Read-only grids only: click a cell, or drag down a column, to suggest that time.
   * Called with a [from, to) range of instants; cells before `windowStart` are not offered.
   */
  onSuggestRange?: (from: number, to: number) => void;
}

/** Colour key for the grid. The suggested swatch only shows when there are suggestions. */
export function GridLegend({
  freeLabel,
  suggestedLabel,
  showSuggested,
}: {
  freeLabel: string;
  suggestedLabel: string;
  showSuggested: boolean;
}) {
  return (
    <div className="legend" aria-label="Key">
      <span>
        <i className="swatch swatch-band" aria-hidden="true" />
        {freeLabel}
      </span>
      {showSuggested && (
        <span>
          <i className="swatch swatch-suggest" aria-hidden="true" />
          {suggestedLabel}
        </span>
      )}
    </div>
  );
}

interface RunCell {
  on: boolean;
  top: boolean;
  bottom: boolean;
  len: number;
}

/** Runs of covered cells in a column, to shape one continuous band and place its label. */
function runsOf(col: number[], covered: (t: number) => boolean): RunCell[] {
  const on = col.map((t) => covered(t));
  const cells: RunCell[] = on.map((v, r) => ({ on: v, top: v && !on[r - 1], bottom: v && !on[r + 1], len: 0 }));
  let start = -1;
  cells.forEach((c, r) => {
    if (c.top) start = r;
    if (c.on) cells[start].len = r - start + 1;
  });
  return cells;
}

export function AvailabilityGrid({
  tz,
  weekStart,
  slots,
  onChange,
  windowStart = -Infinity,
  windowEnd = Infinity,
  suggestions = [],
  ranks,
  paintMode = false,
  days: DAYS = 5,
  label,
  onSuggestRange,
}: Props) {
  const editable = !!onChange;
  const suggesting = !editable && !!onSuggestRange;
  const pick = useRef<{ c: number; r0: number } | null>(null);
  const [preview, setPreview] = useState<{ c: number; lo: number; hi: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'on' | 'off'; draft: Set<number>; last: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [tabPos, setTabPos] = useState<{ r: number; c: number } | null>(null);

  // instants[c][r] for each day column and 15 minute row
  const grid = useMemo(() => {
    const days = Array.from({ length: DAYS }, (_, c) => addDays(weekStart, c));
    return {
      days,
      instants: days.map((d) => Array.from({ length: ROWS }, (_, r) => slotInstantFor(d, r, tz))),
    };
  }, [weekStart, tz, DAYS]);

  const covers = (set: Set<number>, t: number) => set.has(t);
  const enabledAt = (t: number) => (editable || suggesting) && t >= windowStart && t < windowEnd;

  // runs of selected cells per column, to shape the bands and place labels
  const runs = useMemo(
    () => grid.instants.map((col) => runsOf(col, (t) => slots.has(t))),
    [grid, slots],
  );

  // suggestion coverage per cell
  const marks = useMemo(() => {
    const m = new Map<number, { rank?: number }>();
    for (const s of suggestions) {
      const first = Math.floor(s.start / SLOT_MS) * SLOT_MS;
      for (let t = first; t < s.start + s.minutes * 60000; t += SLOT_MS) {
        const prev = m.get(t) ?? {};
        if (t === first && ranks?.has(s.start)) prev.rank = ranks.get(s.start);
        m.set(t, prev);
      }
    }
    return m;
  }, [suggestions, ranks]);

  // suggested times get the same band shape as free time, so they read as the same kind of thing
  const sruns = useMemo(
    () => grid.instants.map((col) => runsOf(col, (t) => marks.has(t))),
    [grid, marks],
  );

  const now = Date.now();
  const today = todayIn(tz, now);

  const firstEnabled = useMemo(() => {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < DAYS; c++) if (enabledAt(grid.instants[c][r])) return { r: Math.max(r, 0), c };
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, windowStart, windowEnd, editable]);

  const tabCell =
    tabPos && enabledAt(grid.instants[tabPos.c][tabPos.r]) ? tabPos : firstEnabled;

  function applyTo(draft: Set<number>, t: number, mode: 'on' | 'off') {
    if (!enabledAt(t)) return false;
    if (mode === 'on') {
      if (draft.has(t)) return false;
      draft.add(t);
    } else {
      if (!draft.has(t)) return false;
      draft.delete(t);
    }
    return true;
  }

  function cellFromEvent(e: { clientX: number; clientY: number }): HTMLElement | null {
    return (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-t]') ?? null;
  }

  // suggesting: press on a cell, drag down the column, release to offer that whole range
  function suggestDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
    if (!cell || (cell as HTMLButtonElement).disabled) return;
    const c = Number(cell.dataset.c);
    const r = Number(cell.dataset.r);
    pick.current = { c, r0: r };
    setPreview({ c, lo: r, hi: r });
    try {
      gridRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* the drag still works while the pointer stays over the grid */
    }
  }

  function suggestMove(e: PointerEvent<HTMLDivElement>) {
    const p = pick.current;
    if (!p) return;
    const cell = cellFromEvent(e);
    if (!cell || Number(cell.dataset.c) !== p.c) return;
    const r = Number(cell.dataset.r);
    setPreview({ c: p.c, lo: Math.min(p.r0, r), hi: Math.max(p.r0, r) });
  }

  function suggestUp(e: PointerEvent<HTMLDivElement>) {
    const p = pick.current;
    if (!p) return;
    pick.current = null;
    try {
      gridRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const cell = cellFromEvent(e);
    const r = cell && Number(cell.dataset.c) === p.c ? Number(cell.dataset.r) : p.r0;
    const lo = Math.min(p.r0, r);
    const hi = Math.max(p.r0, r);
    setPreview(null);
    onSuggestRange!(grid.instants[p.c][lo], grid.instants[p.c][hi] + SLOT_MS);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (suggesting) return suggestDown(e);
    if (!editable) return;
    if (e.pointerType === 'touch' && !paintMode) return; // a tap arrives as click; a drag scrolls
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
    if (!cell || (cell as HTMLButtonElement).disabled) return;
    e.preventDefault();
    suppressClick.current = true;
    const t = Number(cell.dataset.t);
    const mode = covers(slots, t) ? 'off' : 'on';
    const draft = new Set(slots);
    drag.current = { mode, draft, last: t, x: e.clientX, y: e.clientY };
    if (applyTo(draft, t, mode)) onChange!(new Set(draft));
    try {
      gridRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety: the drag still works while the pointer stays over the grid */
    }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (suggesting) return suggestMove(e);
    const d = drag.current;
    if (!d) return;
    // A fast drag skips cells between events, so walk the line from the last position.
    const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    const steps = Math.max(1, Math.ceil(dist / 6));
    let changed = false;
    for (let i = 1; i <= steps; i++) {
      const cell = cellFromEvent({
        clientX: d.x + ((e.clientX - d.x) * i) / steps,
        clientY: d.y + ((e.clientY - d.y) * i) / steps,
      });
      if (!cell) continue;
      const t = Number(cell.dataset.t);
      if (t === d.last) continue;
      d.last = t;
      if (applyTo(d.draft, t, d.mode)) changed = true;
    }
    d.x = e.clientX;
    d.y = e.clientY;
    if (changed) onChange!(new Set(d.draft));
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    try {
      gridRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }

  function toggle(t: number) {
    const draft = new Set(slots);
    applyTo(draft, t, covers(slots, t) ? 'off' : 'on');
    onChange!(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
    if (!cell || !editable) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    let nr = r;
    let nc = c;
    if (e.key === 'ArrowDown') nr = Math.min(ROWS - 1, r + 1);
    else if (e.key === 'ArrowUp') nr = Math.max(0, r - 1);
    else if (e.key === 'ArrowRight') nc = Math.min(DAYS - 1, c + 1);
    else if (e.key === 'ArrowLeft') nc = Math.max(0, c - 1);
    else if (e.key === 'Home') nr = 0;
    else if (e.key === 'End') nr = ROWS - 1;
    else return;
    e.preventDefault();
    const target = gridRef.current?.querySelector<HTMLButtonElement>(`[data-r="${nr}"][data-c="${nc}"]`);
    if (!target) return;
    if (e.shiftKey && !target.disabled) {
      // extend: carry the current cell's state onto the next one
      const t = Number(target.dataset.t);
      const draft = new Set(slots);
      if (applyTo(draft, t, covers(slots, Number(cell.dataset.t)) ? 'on' : 'off')) onChange!(draft);
    }
    if (!target.disabled) target.focus();
  }

  const hourLabels = Array.from({ length: ROWS / SLOTS_PER_HOUR }, (_, i) => {
    const h = DAY_START_HOUR + i;
    const ap = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 === 0 ? 12 : h % 12} ${ap}`;
  });

  return (
    <div
      ref={gridRef}
      className={`week${editable && paintMode ? ' is-painting' : ''}`}
      role="group"
      aria-label={label}
      style={{ gridTemplateRows: `auto repeat(${ROWS}, var(--row-h))`, gridTemplateColumns: `var(--time-w) repeat(${DAYS}, minmax(0, 1fr))` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={suggesting ? suggestUp : endDrag}
      onPointerCancel={suggesting ? () => { pick.current = null; setPreview(null); } : endDrag}
      onKeyDown={onKeyDown}
    >
      <div className="week-corner" style={{ gridColumn: 1, gridRow: 1 }} />
      {grid.days.map((d, c) => (
        <div
          key={calKey(d)}
          className={`week-head${calKey(d) === calKey(today) ? ' is-today' : ''}`}
          style={{ gridColumn: c + 2, gridRow: 1 }}
        >
          <b>{formatCalWeekday(d)}</b>
          <span>{formatCalShort(d)}</span>
        </div>
      ))}
      {hourLabels.map((h, i) => (
        <div key={h} className="hour" aria-hidden="true" style={{ gridColumn: 1, gridRow: `${i * SLOTS_PER_HOUR + 2} / span ${SLOTS_PER_HOUR}` }}>
          {h}
        </div>
      ))}
      {grid.instants.map((col, c) =>
        col.map((t, r) => {
          const run = runs[c][r];
          const srun = sruns[c][r];
          const mark = marks.get(t);
          const enabled = enabledAt(t);
          const cls = [
            'cell',
            r % SLOTS_PER_HOUR === 0 ? 'is-hour' : r % 2 === 0 ? 'is-half' : '',
            r === 0 ? 'is-first-row' : '',
            run.on ? 'is-on' : '',
            run.top ? 'band-top' : '',
            run.bottom ? 'band-bottom' : '',
            srun.on ? 'is-suggest' : '',
            srun.top ? 's-top' : '',
            srun.bottom ? 's-bottom' : '',
            preview && preview.c === c && r >= preview.lo && r <= preview.hi ? 'is-preview' : '',
            editable || suggesting ? '' : 'is-readonly',
          ]
            .filter(Boolean)
            .join(' ');
          const text = `${formatDayLong(t, tz)}, ${formatTime(t, tz)}`;
          const inner = (
            <>
              {mark?.rank != null && <span className="rank">{mark.rank}</span>}
            </>
          );
          const style = { gridColumn: c + 2, gridRow: r + 2 } as CSSProperties;
          if (!editable && !suggesting) {
            return (
              <div key={t} className={cls} style={style} data-t={t} title={run.on ? `${text}: free` : undefined}>
                {inner}
              </div>
            );
          }
          return (
            <button
              key={t}
              type="button"
              className={cls}
              style={style}
              data-t={t}
              data-r={r}
              data-c={c}
              disabled={!enabled}
              aria-pressed={suggesting ? !!mark : run.on}
              aria-label={`${text}${run.on ? ', free' : ''}${mark ? ', suggested time' : ''}`}
              tabIndex={tabCell && tabCell.r === r && tabCell.c === c ? 0 : -1}
              onFocus={() => setTabPos({ r, c })}
              onClick={(e) => {
                if (suggesting) {
                  // pointer use is handled on release; this is the keyboard (Enter / Space) path
                  if (e.detail === 0) onSuggestRange!(t, t + SLOT_MS);
                  return;
                }
                if (suppressClick.current) return;
                toggle(t);
              }}
            >
              {inner}
            </button>
          );
        }),
      )}
    </div>
  );
}


