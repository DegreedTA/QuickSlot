import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, HandPointing } from '@phosphor-icons/react';
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
  formatTime,
  formatDayLong,
  mondayOf,
  rangeLabel,
  slotInstantFor,
  todayIn,
  zonedToUtc,
  type CalDate,
} from '../lib/time';
import { WeekCalendar, type Suggestion } from '../components/WeekCalendar';
import { ZoneCombobox } from '../components/ZoneCombobox';
import { Button, Card, NavArrow } from '../components/ui';
import { useFlashOnChange } from '../lib/useFlash';
import { checkWeeks } from '../lib/weeklyMinimum';

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
          <div className="skel" style={{ height: 48, width: '50%' }} />
          <div className="skel" style={{ height: 420, borderRadius: 16 }} />
        </main>
      </>
    );
  }
  if (load.kind === 'failed') {
    return (
      <StatePage title="Could not load">
        <p>Check your connection and try again.</p>
        <Button onClick={fetchLink}>Try again</Button>
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
      <span className="cand-brand">
        Degreed<span> · QuickSlot</span>
      </span>
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

/** "Nov 9 – 13", or "Nov 30 – Dec 4" across a month end. */
const weekLabel = (mon: CalDate) => {
  const fri = addDays(mon, 4);
  return `${formatCalShort(mon)} – ${mon.m === fri.m ? fri.d : formatCalShort(fri)}`;
};
const hoursText = (slotCount: number) => `${Number((slotCount / 4).toFixed(2))} h free`;
const fmtH = (minutes: number) => `${Number((minutes / 60).toFixed(2))} h`;

function CandidateView({ token, data }: { token: string; data: CandidateLinkData }) {
  // Returning visit: the link already has saved data. This is a heuristic, not a stored fact: a candidate
  // who chose a time zone and nothing else (or whose real zone is UTC) still looks like a first visit.
  const [returning] = useState(() => data.slots.length > 0 || data.timezone !== 'UTC');
  // A new link starts locked: nothing can be marked until the candidate picks their time zone.
  const [tzChosen, setTzChosen] = useState(returning);
  const locked = !tzChosen;
  const [tz, setTz] = useState(() => (returning ? data.timezone : browserZone()));
  const [slots, setSlots] = useState<Set<number>>(() => new Set(data.slots.map((s) => Date.parse(s))));
  const [ranked, setRanked] = useState<number[]>(() => data.ranked_choices.map((s) => Date.parse(s)));
  const [weekIdx, setWeekIdx] = useState(0);
  const [save, setSave] = useState<Save>(() => (returning || data.ranked_choices.length ? { kind: 'saved', at: Date.parse(data.updated_at) } : { kind: 'idle' }));
  const [paint, setPaint] = useState(false);
  const [done, setDone] = useState(false);
  const [triedDone, setTriedDone] = useState(false);

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
      setDone(false); // editing again: the "all set" message no longer applies
    },
    [runSave],
  );

  const flushAll = useCallback(() => {
    (['avail', 'rank'] as const).forEach((w) => {
      if (dirty.current[w]) {
        window.clearTimeout(timers.current[w]);
        void runSave(w);
      }
    });
  }, [runSave]);

  // flush pending edits when the tab is hidden or closed
  useEffect(() => {
    const onVis = () => document.visibilityState === 'hidden' && flushAll();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flushAll);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flushAll);
      window.clearTimeout(timers.current.avail);
      window.clearTimeout(timers.current.rank);
    };
  }, [flushAll]);

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

  /** Rank is the click order; unpicking renumbers the rest because ranks come from the array position. */
  function toggleRank(t: number) {
    const next = ranked.includes(t) ? ranked.filter((x) => x !== t) : [...ranked, t];
    setRanked(next);
    latest.current = { ...latest.current, ranked: next };
    schedule('rank', 500);
  }

  // suggested times: for each week that has any, Monday to Friday columns; days without a suggestion stay empty
  const pickWeeks = useMemo(() => {
    const byWeek = new Map<string, { mon: CalDate; days: { day: CalDate; label: string; items: Suggestion[] }[] }>();
    for (const s of [...suggestions].sort((a, b) => a.start - b.start)) {
      const p = partsInZone(s.start, tz);
      if (p.dow === 0 || p.dow === 6) continue; // the calendar is Monday to Friday
      const mon = mondayOf({ y: p.y, m: p.m, d: p.d });
      const key = calKey(mon);
      if (!byWeek.has(key)) {
        byWeek.set(key, {
          mon,
          days: Array.from({ length: 5 }, (_, i) => {
            const day = addDays(mon, i);
            return { day, label: formatDayLong(slotInstantFor(day, 0, tz), tz), items: [] as Suggestion[] };
          }),
        });
      }
      byWeek.get(key)!.days[(p.dow + 6) % 7].items.push(s);
    }
    return [...byWeek.values()];
  }, [suggestions, tz]);
  // the calendar shows only what the candidate picked, with its number
  const pickedOnGrid = useMemo(() => suggestions.filter((s) => ranks.has(s.start)), [suggestions, ranks]);
  const expiresLabel = formatCalFull(todayIn(tz, Date.parse(data.expires_at)));
  // weekly minimums (free blocks + picked times count)
  const check = useMemo(
    () => checkWeeks(tz, slots, pickedOnGrid, LEAD_MS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tz, slots, pickedOnGrid, tick],
  );
  const weekIndex = (mon: CalDate) => weeks.findIndex((w) => calKey(w) === calKey(mon));
  const unmetText = check.unmet
    .map((w) => {
      const x = w === 'current' ? check.current! : check.next;
      return `${fmtH(x.need)} ${w === 'current' ? 'this week' : 'next week'}`;
    })
    .join(' and ');
  const unmetDetail = check.unmet
    .map((w) => {
      const x = w === 'current' ? check.current! : check.next;
      return `${fmtH(x.need)} ${w === 'current' ? 'this week' : 'next week'} (${fmtH(x.have)} so far)`;
    })
    .join(' and ');
  const picksFlash = useFlashOnChange<HTMLDivElement>(tz);
  const calFlash = useFlashOnChange<HTMLDivElement>(tz);
  const stepBadge = (n: number) => !returning && <span className="step-badge" aria-hidden="true">{n}</span>;

  function finish() {
    if (check.unmet.length > 0) {
      setTriedDone(true); // keep the page as it is and say what is missing
      return;
    }
    setTriedDone(false);
    flushAll();
    setDone(true);
  }

  return (
    <>
      <TopBar />
      <main className="cand" id="main">
        <div className="cand-intro">
          <h1>When are you free?</h1>
          <p>Add your availability for future interviews</p>
        </div>

        <Card className="cand-card cand-tz" aria-labelledby="tz-h">
          <div className="cand-title">
            {stepBadge(1)}
            <div>
              <h2 id="tz-h">Your time zone</h2>
              {locked && (
                <p className="cand-sub" role="status">
                  Pick your time zone first. Every time on this page is shown in it.
                </p>
              )}
            </div>
          </div>
          <div className="ds-zone ds-zone--lg">
            <label htmlFor="tz" className="sr-only">
              Time zone
            </label>
            <ZoneCombobox id="tz" value={locked ? null : tz} onChange={changeZone} placeholder="Choose your time zone to start" />
          </div>
          <Button size="md" variant="ghost" onClick={() => changeZone(browserZone())}>
            Use my device's time zone
          </Button>
        </Card>

        {suggestions.length > 0 && (
          <Card ref={picksFlash} className={`cand-card cand-pad${locked ? ' is-locked' : ''}`} aria-labelledby="picks-h">
            <div className="cand-head-row">
              <div className="cand-title">
                {stepBadge(2)}
                <h2 id="picks-h">Pick the suggested times that work for you</h2>
              </div>
              {pickedOnGrid.length > 0 && (
                <span className="picked-chip" role="status">
                  {pickedOnGrid.length} picked
                </span>
              )}
            </div>
            {pickWeeks.map((w) => (
              <div className="pick-grid" key={calKey(w.mon)}>
                {w.days.map((d) => (
                  <div className={`pick-day${calKey(d.day) === calKey(today) ? ' is-today' : ''}`} key={calKey(d.day)} role="group" aria-label={d.label}>
                    <h3>{d.label}</h3>
                    <div className="pick-col">
                      {d.items.map((s) => {
                        const r = ranks.get(s.start);
                        return (
                          <button
                            key={s.start}
                            type="button"
                            className="pick-opt"
                            aria-pressed={!!r}
                            aria-label={`${d.label}, ${rangeLabel(s.start, s.start + s.minutes * 60000, tz)}${r ? `, picked number ${r}` : ''}`}
                            disabled={locked}
                            onClick={() => toggleRank(s.start)}
                          >
                            {r ? <span className="pick-rank">{r}</span> : <span className="pick-ring" />}
                            {formatTime(s.start, tz)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </Card>
        )}

        <Card ref={calFlash} className={`cand-card cand-pad cand-cal${locked ? ' is-locked' : ''}`} aria-labelledby="cal-h">
          <div className="cand-title">
            {stepBadge(suggestions.length > 0 ? 3 : 2)}
            <div>
              <h2 id="cal-h">Mark any other times you're free</h2>
              <p className="cand-sub">Click or drag on the calendar</p>
            </div>
          </div>

          {check.unmet.length > 0 && (
            <div className="week-notice is-need" role="status">
              <span>
                <strong>Please mark at least {unmetDetail}.</strong>
              </span>
              <Button size="sm" variant="secondary" onClick={() => setWeekIdx(Math.max(0, weekIndex((check.unmet[0] === 'current' ? check.current! : check.next).mon)))}>
                Show {check.unmet[0] === 'current' ? 'this' : 'next'} week
              </Button>
            </div>
          )}
          {check.appeal && (
            <div className="week-notice is-appeal" role="status">
              <span>
                <strong>
                  {check.appeal === 'this_week'
                    ? 'Consider marking more times this week.'
                    : check.appeal === 'next_week'
                      ? 'Consider marking more times next week.'
                      : 'Consider marking more times.'}
                </strong>{' '}
                More options help us find a time that works for you.
              </span>
              {check.appeal === 'next_week' && (
                <Button size="sm" variant="ghost" onClick={() => setWeekIdx(Math.max(0, weekIndex(check.next.mon)))}>
                  Show next week
                </Button>
              )}
            </div>
          )}

          <div className="cand-toolbar">
            <div className="cand-weeknav">
              <NavArrow dir="left" label="Previous week" disabled={idx === 0} onClick={() => setWeekIdx(idx - 1)} />
              <div className="cand-weeklabel" aria-live="polite">
                {weekLabel(weekStart)}
              </div>
              <NavArrow dir="right" label="Next week" disabled={idx >= weeks.length - 1} onClick={() => setWeekIdx(idx + 1)} />
            </div>
            <div className="legend-row cand-legend">
              <span>
                <i className="sw sw-free" aria-hidden="true" />
                Your availability
              </span>
              <span>
                <i className="sw sw-picked" aria-hidden="true" />
                Your picks
              </span>
              <Button size="sm" variant="secondary" className="paint-toggle" aria-pressed={paint} disabled={locked} onClick={() => setPaint(!paint)}>
                <HandPointing size={16} aria-hidden />
                Draw {paint ? 'on' : 'off'}
              </Button>
              <Button size="sm" variant="ghost" disabled={locked} onClick={clearWeek}>
                Clear
              </Button>
            </div>
          </div>

          <WeekCalendar
            flat
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
        </Card>

        <SaveBar
          save={save}
          tz={tz}
          done={done}
          expires={expiresLabel}
          picks={suggestions.length > 0 ? pickedOnGrid.length : null}
          slotCount={slots.size}
          blocked={triedDone && check.unmet.length > 0 ? `Please mark at least ${unmetText} to finish.` : null}
          onRetry={flushAll}
          onDone={finish}
          onKeepEditing={() => setDone(false)}
        />

        <footer className="cand-foot">
          <p>Only your availability and time zone are saved. This link works until {expiresLabel}.</p>
          {isDemo && <p className="notice">Demo mode: data stays in this browser.</p>}
        </footer>
      </main>
    </>
  );
}

function SaveBar({
  save,
  tz,
  done,
  expires,
  picks,
  slotCount,
  blocked,
  onRetry,
  onDone,
  onKeepEditing,
}: {
  save: Save;
  tz: string;
  done: boolean;
  expires: string;
  picks: number | null;
  slotCount: number;
  blocked: string | null;
  onRetry: () => void;
  onDone: () => void;
  onKeepEditing: () => void;
}) {
  if (done && save.kind === 'saved') {
    return (
      <Card className="save-bar">
        <div className="save-left" role="status" aria-live="polite">
          <Check size={20} weight="bold" color="#0062E3" aria-hidden />
          <span>
            <strong>You're all set</strong>
            <span className="save-meta"> · Your recruiter can see your availability. You can come back to this link until {expires}.</span>
          </span>
        </div>
        <Button size="lg" variant="secondary" onClick={onKeepEditing}>
          Keep editing
        </Button>
      </Card>
    );
  }
  const counts = `${picks === null ? '' : ` · ${picks} ${picks === 1 ? 'pick' : 'picks'}`} · ${hoursText(slotCount)}`;
  return (
    <Card className="save-bar">
      <div className="save-left" role={save.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
        <Check size={20} weight="bold" color={save.kind === 'error' ? '#C7472B' : '#0062E3'} aria-hidden />
        <span>
          {save.kind === 'saving' && <strong>Saving...</strong>}
          {save.kind === 'saved' && <strong>Saved {formatStamp(save.at, tz)}</strong>}
          {save.kind === 'idle' && <strong>Changes save automatically</strong>}
          {save.kind === 'error' && <strong className="is-error">Not saved.</strong>}
          <span className="save-meta">{counts}</span>
          {save.kind === 'error' && (
            <>
              {' '}
              <Button size="sm" variant="secondary" onClick={onRetry}>
                Retry
              </Button>
            </>
          )}
        </span>
      </div>
      {blocked && (
        <p className="save-block" role="alert">
          {blocked}
        </p>
      )}
      <Button size="lg" onClick={onDone}>
        I'm done <span aria-hidden="true">→</span>
      </Button>
    </Card>
  );
}
