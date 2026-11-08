import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CaretLeft, CaretRight, HandPointing, Trash } from '@phosphor-icons/react';
import { api, isDemo } from '../lib/api';
import type { CandidateLinkData, CandidateResult } from '../lib/types';
import {
  LEAD_MS,
  SLOT_MS,
  ROWS,
  WINDOW_DAYS,
  addDays,
  browserZone,
  calDiffDays,
  calKey,
  partsInZone,
  formatCalFull,
  formatCalShort,
  formatStamp,
  formatDayLong,
  groupByDay,
  mondayOf,
  rangeLabel,
  slotInstantFor,
  todayIn,
  zonedToUtc,
  zoneName,
} from '../lib/time';
import { AvailabilityGrid, GridLegend, type Suggestion } from '../components/AvailabilityGrid';
import { Summary } from '../components/Summary';
import { ZoneCombobox } from '../components/ZoneCombobox';
import { BrandMark } from '../components/Brand';

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'expired' } | { kind: 'notfound' } | { kind: 'ok'; data: CandidateLinkData };

export default function Candidate() {
  const { token = '' } = useParams();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  const fetchLink = useCallback(() => {
    setLoad({ kind: 'loading' });
    api
      .getLink(token)
      .then((r: CandidateResult) => {
        if (r.status === 'ok') setLoad({ kind: 'ok', data: r });
        else if (r.status === 'expired') setLoad({ kind: 'expired' });
        else setLoad({ kind: 'notfound' });
      })
      .catch(() => setLoad({ kind: 'failed' }));
  }, [token]);

  useEffect(() => {
    document.title = 'Your availability | QuickSlot';
    fetchLink();
  }, [fetchLink]);

  if (load.kind === 'loading') {
    return (
      <>
        <TopBar />
        <main className="cand" aria-busy="true" aria-label="Loading">
          <div className="skel" style={{ height: 34, width: '50%' }} />
          <div className="skel" style={{ height: 420, borderRadius: 8 }} />
        </main>
      </>
    );
  }
  if (load.kind === 'failed') {
    return (
      <StatePage title="Could not load">
        <p>Check your connection and try again.</p>
        <button className="btn btn-primary" onClick={fetchLink}>
          Try again
        </button>
      </StatePage>
    );
  }
  if (load.kind === 'expired') {
    return (
      <StatePage title="This link is no longer active">
        <p>Ask your recruiter for a new one.</p>
      </StatePage>
    );
  }
  if (load.kind === 'notfound') {
    return (
      <StatePage title="Link not found">
        <p>Check the address, or ask your recruiter to resend it.</p>
      </StatePage>
    );
  }
  return <CandidateView token={token} data={load.data} />;
}

function TopBar() {
  return (
    <header className="cand-top">
      <div className="cand-top-inner">
        <span className="brand" style={{ padding: 0, fontSize: 'var(--t-base)' }}>
          <BrandMark size={22} />
          QuickSlot
        </span>
      </div>
    </header>
  );
}

function StatePage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="state-page">
      <div className="state-card" role="alert">
        <h1 style={{ fontSize: 'var(--t-xl)' }}>{title}</h1>
        {children}
      </div>
    </div>
  );
}

type Save = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: number } | { kind: 'error' };

function CandidateView({ token, data }: { token: string; data: CandidateLinkData }) {
  // A new link starts locked: nothing can be marked until the candidate picks their time zone.
  // (A link that already has times, or a zone other than the default UTC, counts as chosen.)
  const [tzChosen, setTzChosen] = useState(() => data.slots.length > 0 || data.timezone !== 'UTC');
  const locked = !tzChosen;
  const [tz, setTz] = useState(() => (data.slots.length > 0 || data.timezone !== 'UTC' ? data.timezone : browserZone()));
  const [slots, setSlots] = useState<Set<number>>(() => new Set(data.slots.map((s) => Date.parse(s))));
  const [ranked, setRanked] = useState<number[]>(() => data.ranked_choices.map((s) => Date.parse(s)));
  const [weekIdx, setWeekIdx] = useState(0);
  const [save, setSave] = useState<Save>({ kind: 'saved', at: Date.parse(data.updated_at) });
  const [paint, setPaint] = useState(false);

  const latest = useRef({ slots, tz, ranked });
  latest.current = { slots, tz, ranked };
  const timers = useRef<{ avail?: number; rank?: number }>({});
  const inflight = useRef(0);
  const dirty = useRef({ avail: false, rank: false });

  // keep the page's idea of "now" fresh, so slots grey out as time passes
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(i);
  }, []);

  // suggested times that are now too soon are no longer offered
  const suggestions: Suggestion[] = useMemo(
    () =>
      data.suggested_slots
        .map((s) => ({ start: Date.parse(s.start), minutes: s.minutes }))
        .filter((s) => s.start >= Date.now() + LEAD_MS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.suggested_slots, tick],
  );
  const ranks = useMemo(() => new Map(ranked.map((t, i) => [t, i + 1])), [ranked]);

  const runSave = useCallback(
    async (which: 'avail' | 'rank') => {
      dirty.current[which] = false;
      inflight.current++;
      setSave({ kind: 'saving' });
      try {
        const { slots: s, tz: z, ranked: r } = latest.current;
        const ts =
          which === 'avail'
            ? await api.setAvailability(token, [...s].sort((a, b) => a - b).map((t) => new Date(t).toISOString()), z)
            : await api.setRanked(token, r.map((t) => new Date(t).toISOString()));
        inflight.current--;
        if (inflight.current === 0) setSave({ kind: 'saved', at: Date.parse(ts) || Date.now() });
      } catch {
        inflight.current--;
        dirty.current[which] = true;
        setSave({ kind: 'error' });
      }
    },
    [token],
  );

  const schedule = useCallback(
    (which: 'avail' | 'rank', delay = 700) => {
      dirty.current[which] = true;
      window.clearTimeout(timers.current[which]);
      timers.current[which] = window.setTimeout(() => runSave(which), delay);
      setSave({ kind: 'saving' });
    },
    [runSave],
  );

  // flush pending edits when the tab is hidden or closed
  useEffect(() => {
    const flush = () => {
      (['avail', 'rank'] as const).forEach((w) => {
        if (dirty.current[w]) {
          window.clearTimeout(timers.current[w]);
          void runSave(w);
        }
      });
    };
    const onVis = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flush);
      window.clearTimeout(timers.current.avail);
      window.clearTimeout(timers.current.rank);
    };
  }, [runSave]);

  // the window: today through the next 30 days, Monday to Friday, in the candidate's zone
  const now = Date.now();
  const today = todayIn(tz, now);
  const weeks = useMemo(() => {
    const dow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
    const firstWeekday = addDays(today, dow === 6 ? 2 : dow === 0 ? 1 : 0);
    const first = mondayOf(firstWeekday);
    const last = addDays(today, WINDOW_DAYS - 1);
    const n = Math.floor(calDiffDays(first, mondayOf(last)) / 7) + 1;
    return Array.from({ length: n }, (_, i) => addDays(first, i * 7));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tz, today.y, today.m, today.d]);
  const idx = Math.min(weekIdx, weeks.length - 1);
  const weekStart = weeks[idx];
  const weekEnd = addDays(weekStart, 4);
  const slotArray = useMemo(() => [...slots], [slots]);
  // too soon is greyed out: the first selectable block starts at least LEAD_MINUTES from now
  const windowStart = Math.ceil((now + LEAD_MS) / SLOT_MS) * SLOT_MS;
  const lastDay = addDays(today, WINDOW_DAYS);
  const windowEnd = zonedToUtc(lastDay.y, lastDay.m, lastDay.d, 0, 0, tz);

  function changeSlots(next: Set<number>) {
    setSlots(next);
    latest.current = { ...latest.current, slots: next };
    schedule('avail');
  }

  function changeZone(z: string) {
    setTzChosen(true);
    setTz(z);
    latest.current = { ...latest.current, tz: z };
    schedule('avail', 300);
  }

  function clearWeek() {
    const lo = slotInstantFor(weekStart, 0, tz);
    const hi = slotInstantFor(weekEnd, ROWS - 1, tz) + SLOT_MS;
    changeSlots(new Set([...slots].filter((t) => t < lo || t >= hi)));
  }

  function toggleRank(t: number) {
    const next = ranked.includes(t) ? ranked.filter((x) => x !== t) : [...ranked, t];
    setRanked(next);
    latest.current = { ...latest.current, ranked: next };
    schedule('rank', 500);
  }

  const need = Math.min(3, suggestions.length);
  // suggested times, one column per day (in the candidate's zone)
  const pickDays = useMemo(() => {
    const days = new Map<string, { key: string; label: string; items: Suggestion[] }>();
    for (const s of [...suggestions].sort((a, b) => a.start - b.start)) {
      const key = calKey(partsInZone(s.start, tz));
      if (!days.has(key)) days.set(key, { key, label: formatDayLong(s.start, tz), items: [] });
      days.get(key)!.items.push(s);
    }
    return [...days.values()];
  }, [suggestions, tz]);
  // the calendar shows only what the candidate picked, with its number
  const pickedOnGrid = useMemo(() => suggestions.filter((s) => ranks.has(s.start)), [suggestions, ranks]);
  const weekLo = slotInstantFor(weekStart, 0, tz);
  const weekHi = slotInstantFor(weekEnd, ROWS - 1, tz) + SLOT_MS;
  const weekGroups = groupByDay(slotArray.filter((t) => t >= weekLo && t < weekHi), tz);
  const expiresLabel = formatCalFull(todayIn(tz, Date.parse(data.expires_at)));

  return (
    <>
      <TopBar />
      <main className="cand" id="main">
        <h1>When are you free?</h1>

        <div className="field zone-field">
          <label htmlFor="tz">Time zone</label>
          <ZoneCombobox
            id="tz"
            value={locked ? null : tz}
            onChange={changeZone}
            placeholder="Choose your time zone to start"
          />
          {locked && (
            <div className="zone-prompt">
              <p className="hint" role="status">
                Pick your time zone first. Every time on this page is shown in it.
              </p>
              <button type="button" className="btn btn-sm" onClick={() => changeZone(tz)}>
                Use my device's time zone ({zoneName(tz)})
              </button>
            </div>
          )}
        </div>

        {suggestions.length > 0 && (
          <section className="picks" aria-labelledby="picks-h">
            <div className="picks-head">
              <h2 id="picks-h">Suggested times based on the interviewer's calendar</h2>
              <span className="hint">
                {ranked.length} of {need}
              </span>
            </div>
            <div className="pick-days">
              {pickDays.map((d) => (
                <div className="pick-day" key={d.key} role="group" aria-label={d.label}>
                  <h3>{d.label}</h3>
                  <div className="pick-col">
                    {d.items.map((s) => {
                      const r = ranks.get(s.start);
                      return (
                        <button
                          key={s.start}
                          type="button"
                          className="pick"
                          aria-pressed={!!r}
                          disabled={locked}
                          onClick={() => toggleRank(s.start)}
                        >
                          <span className="n">{r ?? ''}</span>
                          <span>{rangeLabel(s.start, s.start + s.minutes * 60000, tz)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section aria-label="Availability" className={locked ? 'is-locked' : undefined}>
          <div className="week-bar">
            <div className="week-nav">
              <button className="btn btn-icon btn-quiet" aria-label="Previous week" disabled={idx === 0} onClick={() => setWeekIdx(idx - 1)}>
                <CaretLeft size={18} />
              </button>
              <div className="week-title" aria-live="polite">
                {formatCalShort(weekStart)} to {formatCalShort(weekEnd)}
              </div>
              <button
                className="btn btn-icon btn-quiet"
                aria-label="Next week"
                disabled={idx >= weeks.length - 1}
                onClick={() => setWeekIdx(idx + 1)}
              >
                <CaretRight size={18} />
              </button>
            </div>
            <div className="week-tools">
              <button type="button" className="btn btn-sm paint-toggle" aria-pressed={paint} disabled={locked} onClick={() => setPaint(!paint)}>
                <HandPointing size={16} aria-hidden />
                Draw {paint ? 'on' : 'off'}
              </button>
              <button type="button" className="btn btn-sm btn-quiet" disabled={locked} onClick={clearWeek}>
                <Trash size={16} aria-hidden />
                Clear
              </button>
            </div>
          </div>

          {weekGroups.length > 0 && (
            <p className="week-readout" aria-live="polite">
              {weekGroups
                .map((g) => `${g.label.split(',')[0]} ${g.ranges.map((r) => rangeLabel(r.start, r.end, tz)).join(', ')}`)
                .join('; ')}
            </p>
          )}

          <AvailabilityGrid
            tz={tz}
            weekStart={weekStart}
            slots={slots}
            onChange={changeSlots}
            windowStart={windowStart}
            windowEnd={locked ? -Infinity : windowEnd}
            suggestions={pickedOnGrid}
            ranks={ranks}
            paintMode={paint}
            label={`Availability, ${formatCalShort(weekStart)} to ${formatCalShort(weekEnd)}. Select 15 minute blocks when you are free.`}
          />
          <GridLegend freeLabel="Your availability" suggestedLabel="Your picks (numbered)" showSuggested={pickedOnGrid.length > 0} />
          <SaveLine save={save} tz={tz} onRetry={() => (['avail', 'rank'] as const).forEach((w) => dirty.current[w] && void runSave(w))} />
        </section>

        <Summary starts={slotArray} tz={tz} title="Your availability" />

        <footer className="cand-foot">
          <p>
            <span className="nowrap-md">Not a booking. Saves automatically. Only your availability and time zone are stored.</span>
          </p>
          <p>This link expires {expiresLabel}.</p>
          {isDemo && <p className="notice">Demo mode: data stays in this browser.</p>}
        </footer>
      </main>
    </>
  );
}

function SaveLine({ save, tz, onRetry }: { save: Save; tz: string; onRetry: () => void }) {
  let text = '';
  let cls = 'save-state';
  if (save.kind === 'saving') text = 'Saving...';
  else if (save.kind === 'saved') text = `Saved ${formatStamp(save.at, tz)}`;
  else if (save.kind === 'error') {
    cls += ' is-error';
    text = 'Not saved.';
  }
  return (
    <p className={cls} role={save.kind === 'error' ? 'alert' : 'status'} aria-live="polite" style={{ marginTop: 10 }}>
      {text}
      {save.kind === 'error' && (
        <>
          {' '}
          <button className="btn btn-sm" onClick={onRetry}>
            Retry
          </button>
        </>
      )}
    </p>
  );
}
