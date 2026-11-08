import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowSquareOut, Plus, X } from '@phosphor-icons/react';
import { ManagerShell } from '../components/ManagerShell';
import { AvailabilityGrid, GridLegend, type Suggestion } from '../components/AvailabilityGrid';
import { CopyButton } from '../components/CopyButton';
import { Summary } from '../components/Summary';
import { ZoneCombobox } from '../components/ZoneCombobox';
import { useManagerCall, useSession } from '../lib/session';
import { api } from '../lib/api';
import { ApiError, type ManagerLinkData, type SuggestedSlot } from '../lib/types';
import {
  LEAD_MINUTES,
  LEAD_MS,
  ROWS,
  SLOT_MS,
  WINDOW_DAYS,
  addDays,
  calDiffDays,
  calKey,
  formatCalFull,
  formatCalShort,
  formatDateTime,
  formatDayLong,
  formatStamp,
  formatTime,
  rangeLabel,
  isWeekend,
  mondayOf,
  slotInstantFor,
  todayIn,
  tzLabel,
  zonedToUtc,
  zoneName,
  type CalDate,
} from '../lib/time';

/** The next calendar day that is Monday to Friday. */
function nextWeekday(c: CalDate): CalDate {
  let d = addDays(c, 1);
  for (let i = 0; i < 3; i++) {
    const dow = new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    d = addDays(d, 1);
  }
  return d;
}

export default function LinkDetail() {
  return (
    <ManagerShell>
      <Detail />
    </ManagerShell>
  );
}

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'notfound' } | { kind: 'ok'; data: ManagerLinkData };

function Detail() {
  const { token = '' } = useParams();
  const call = useManagerCall();
  const [state, setState] = useState<Load>({ kind: 'loading' });

  const load = useCallback(
    async (markSeen: boolean) => {
      try {
        const r = await call((p) => api.managerGetLink(p, token, markSeen));
        setState(r.status === 'not_found' ? { kind: 'notfound' } : { kind: 'ok', data: r });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'bad_passcode') return;
        setState({ kind: 'failed' });
      }
    },
    [call, token],
  );

  useEffect(() => {
    setState({ kind: 'loading' });
    void load(true);
  }, [load]);

  useEffect(() => {
    document.title = 'Link | QuickSlot';
  }, []);

  return (
    <>
      <Link to="/" className="crumb">
        <ArrowLeft size={16} aria-hidden />
        All links
      </Link>
      {state.kind === 'loading' && (
        <div aria-busy="true" aria-label="Loading" style={{ display: 'grid', gap: 16 }}>
          <div className="skel" style={{ height: 40, width: '50%' }} />
          <div className="skel" style={{ height: 460, borderRadius: 8 }} />
        </div>
      )}
      {state.kind === 'failed' && (
        <div className="empty panel" role="alert">
          <p>Could not load. Check your connection.</p>
          <button className="btn" onClick={() => void load(true)}>
            Try again
          </button>
        </div>
      )}
      {state.kind === 'notfound' && (
        <div className="empty panel">
          <h2>Link not found</h2>
        </div>
      )}
      {state.kind === 'ok' && <DetailBody data={state.data} reload={() => load(false)} />}
    </>
  );
}

/**
 * Start times for interviews of `len` minutes laid back to back inside [from, to).
 * 6:45 to 8:30 with 30 min gives 6:45, 7:15 and 7:45. A range shorter than `len` gives one block.
 */
export function expandRange(from: number, to: number, len: number): number[] {
  const ms = len * 60000;
  const out: number[] = [];
  for (let t = from; t + ms <= to; t += ms) out.push(t);
  return out.length ? out : [from];
}

/** Suggested times for this link (or its whole batch). Every change is saved as soon as it is made. */
function useSuggestions(data: ManagerLinkData, reload: () => Promise<void>) {
  const call = useManagerCall();
  const [draft, setDraftState] = useState<SuggestedSlot[]>(data.suggested_slots);
  const draftRef = useRef(draft);
  const [minutes, setMinutes] = useState('30');
  const [scope, setScope] = useState<'this' | 'batch'>('this');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());

  // times that have started drop out of view (the database deletes them too)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(i);
  }, []);
  const visible = useMemo(
    () => draft.filter((s) => Date.parse(s.start) > Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, tick],
  );

  const setDraft = (next: SuggestedSlot[]) => {
    draftRef.current = next;
    setDraftState(next);
  };

  function commit(next: SuggestedSlot[], zone: string) {
    const before = draftRef.current;
    setDraft(next);
    setStatus('saving');
    pending.current++;
    chain.current = chain.current.then(async () => {
      try {
        const tokens = scope === 'batch' ? data.batch.map((b) => b.token) : [data.token];
        await call((p) => api.managerSetSuggestions(p, tokens, next, zone));
        if (--pending.current === 0) {
          await reload();
          setStatus('saved');
        }
      } catch (err) {
        pending.current--;
        setDraft(before);
        if (!(err instanceof ApiError && err.code === 'bad_passcode')) {
          setStatus('error');
          setError('Not saved. Try again.');
        }
      }
    });
  }

  /**
   * Offer interviews of `len` minutes inside [from, to), back to back from the start.
   * 10:00 to 10:45 with 30 min gives one block (10:00); 9:00 to 10:00 gives two.
   * Returns a message if nothing could be added.
   */
  function addRange(from: number, to: number, zone: string, len = Number(minutes)): string | null {
    setError(null);
    const starts = expandRange(from, to, len);

    const have = new Set(draftRef.current.map((s) => Date.parse(s.start)));
    let reason: string | null = null;
    const add: SuggestedSlot[] = [];
    for (const t of starts) {
      if (isWeekend(t, zone)) reason ??= 'Weekdays only.';
      else if (t < Date.now() + LEAD_MS) reason ??= `Needs ${LEAD_MINUTES / 60} hours notice.`;
      else if (have.has(t)) reason ??= 'Already added.';
      else add.push({ start: new Date(t).toISOString(), minutes: len });
    }
    const room = 60 - draftRef.current.length;
    if (add.length > room) {
      reason ??= 'Up to 60 times.';
      add.length = Math.max(room, 0);
    }
    if (add.length === 0) {
      setError(reason ?? 'Nothing to add.');
      return reason ?? 'Nothing to add.';
    }
    if (reason) setError(reason);
    commit([...draftRef.current, ...add].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), zone);
    return null;
  }

  function remove(start: string, zone: string) {
    setError(null);
    commit(draftRef.current.filter((x) => x.start !== start), zone);
  }

  function clearAll(zone: string) {
    setError(null);
    commit([], zone);
  }

  return { draft, visible, minutes, setMinutes, scope, setScope, status, error, setError, addRange, remove, clearAll };
}

function DetailBody({ data, reload }: { data: ManagerLinkData; reload: () => Promise<void> }) {
  const { zone, setZone } = useSession();
  const call = useManagerCall();
  const sug = useSuggestions(data, reload);
  const slots = useMemo(() => new Set(data.slots.map((s) => Date.parse(s))), [data.slots]);
  const slotArray = useMemo(() => [...slots], [slots]);
  const suggestions: Suggestion[] = useMemo(
    () => sug.visible.map((s) => ({ start: Date.parse(s.start), minutes: s.minutes })),
    [sug.visible],
  );
  const [pending, setPending] = useState<{ from: number; to: number } | null>(null);

  /** A click or drag on the calendar. Clicking a suggested time removes it; anything else asks how long the interview is. */
  function onCalendarRange(from: number, to: number) {
    const single = to - from <= SLOT_MS;
    const hit = sug.visible.find((s) => Date.parse(s.start) <= from && from < Date.parse(s.start) + s.minutes * 60000);
    if (single && hit) sug.remove(hit.start, zone);
    else setPending({ from, to });
  }
  const rankedMs = useMemo(() => data.ranked_choices.map((s) => Date.parse(s)), [data.ranked_choices]);
  const ranks = useMemo(() => new Map(rankedMs.map((t, i) => [t, i + 1])), [rankedMs]);
  const expired = data.status === 'expired';
  const candUrl = `${window.location.origin}/${data.token}`;

  // weeks that cover the window, plus any week that holds shared time
  const now = Date.now();
  const today = todayIn(zone, now);
  const weeks = useMemo(() => {
    const first = mondayOf(today);
    const lastShared = slotArray.length ? todayIn(zone, Math.max(...slotArray)) : today;
    const lastDay = calDiffDays(today, lastShared) > WINDOW_DAYS ? lastShared : addDays(today, WINDOW_DAYS - 1);
    const n = Math.floor(calDiffDays(first, mondayOf(lastDay)) / 7) + 1;
    return Array.from({ length: n }, (_, i) => addDays(first, i * 7));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, calKey(today), slotArray]);

  const hoursIn = (wk: CalDate) => {
    const lo = slotInstantFor(wk, 0, zone);
    const hi = slotInstantFor(addDays(wk, 4), ROWS - 1, zone) + SLOT_MS;
    return slotArray.filter((t) => t >= lo && t < hi && !isWeekend(t, zone)).length / 4;
  };

  const firstWithTime = Math.max(0, weeks.findIndex((w) => hoursIn(w) > 0));
  const [picked, setPicked] = useState<number | null>(null);
  const idx = Math.min(picked ?? firstWithTime, weeks.length - 1);
  const weekStart = weeks[idx];
  const weekEnd = addDays(weekStart, 4);

  return (
    <>
      <div className="page-head">
        <LabelEditor token={data.token} initial={data.label} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <CopyButton text={candUrl} className="btn btn-primary">
            Copy link
          </CopyButton>
          <a className="btn" href={candUrl} target="_blank" rel="noreferrer">
            <ArrowSquareOut size={16} aria-hidden />
            Preview
          </a>
        </div>
      </div>

      {expired && <p className="notice" style={{ marginBottom: 20 }}>This link is inactive.</p>}

      <div className="detail-grid">
        <section className="section" aria-label="Availability">
          <div className="field" style={{ maxWidth: 360 }}>
            <label htmlFor="rz">Show times in</label>
            <ZoneCombobox id="rz" value={zone} onChange={setZone} />
          </div>

          <div className="tabs" role="tablist" aria-label="Weeks">
            {weeks.map((w, i) => {
              const h = hoursIn(w);
              return (
                <button key={calKey(w)} role="tab" className="tab" aria-selected={i === idx} onClick={() => setPicked(i)}>
                  {formatCalShort(w)}
                  <span className="count">{h > 0 ? `${h} h` : '0'}</span>
                </button>
              );
            })}
          </div>

          <AvailabilityGrid
            tz={zone}
            weekStart={weekStart}
            slots={slots}
            suggestions={suggestions}
            ranks={ranks}
            muteUnpicked
            label={`Candidate availability, ${formatCalShort(weekStart)} to ${formatCalShort(weekEnd)}, in ${tzLabel(zone)}`}
            windowStart={Math.ceil((now + LEAD_MS) / SLOT_MS) * SLOT_MS}
            onSuggestRange={expired ? undefined : onCalendarRange}
          />
          <GridLegend
            freeLabel="Candidate's availability"
            suggestedLabel={ranks.size > 0 ? "Candidate's picks (in order)" : 'Times you suggested'}
            showSuggested
            mutedLabel="Not chosen"
            showMuted={ranks.size > 0 && suggestions.some((s) => !ranks.has(s.start))}
          />
          {!expired && <p className="meta">To suggest times, drag on the calendar (15 minute steps), then choose the interview length. Click a suggested time to remove it.</p>}
          {pending && (
            <SuggestDialog
              range={pending}
              zone={zone}
              existing={sug.visible.length}
              initialMinutes={Number(sug.minutes)}
              onCancel={() => setPending(null)}
              onConfirm={(len) => {
                sug.setMinutes(String(len));
                const err = sug.addRange(pending.from, pending.to, zone, len);
                if (!err) setPending(null);
                return err;
              }}
            />
          )}
        </section>

        <div className="side">
          {suggestions.length > 0 && (
            <section className="section" aria-labelledby="ranked-h">
              <h2 id="ranked-h">Their picks</h2>
              {rankedMs.length === 0 ? (
                <p className="muted">None yet.</p>
              ) : (
                <>
                  <ol className="ranked">
                    {rankedMs.map((t, i) => (
                      <li key={t}>
                        <span className="n">{i + 1}</span>
                        <span>{formatDateTime(t, zone)}</span>
                      </li>
                    ))}
                  </ol>
                  <CopyButton
                    className="btn btn-sm"
                    text={`Preferred times (${tzLabel(zone)})\n${rankedMs.map((t, i) => `${i + 1}. ${formatDateTime(t, zone)}`).join('\n')}`}
                  >
                    Copy
                  </CopyButton>
                </>
              )}
            </section>
          )}

          <div className="section">
            <Summary starts={slotArray} tz={zone} title="Free times" emptyText="Nothing shared yet." />
          </div>

          <div className="section">
            <SuggestEditor data={data} defaultZone={zone} sug={sug} />
          </div>

          <div className="section">
            <dl className="facts-list">
              <div>
                <dt>Candidate time zone</dt>
                <dd>{zoneName(data.timezone)}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{formatStamp(Date.parse(data.updated_at), zone)}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatCalFull(todayIn(zone, Date.parse(data.created_at)))}</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>{formatCalFull(todayIn(zone, Date.parse(data.expires_at)))}</dd>
              </div>
              <div>
                <dt>Code</dt>
                <dd className="mono">{data.token}</dd>
              </div>
            </dl>
            {data.batch.length > 1 && (
              <div className="batch-list">
                {data.batch.map((b, i) => (
                  <Link
                    key={b.token}
                    className={`tag${b.token === data.token ? '' : ' tag-quiet'}`}
                    to={`/${b.token}/recruiter`}
                    aria-current={b.token === data.token ? 'page' : undefined}
                  >
                    {b.label || `Link ${i + 1}`}
                  </Link>
                ))}
              </div>
            )}
            {!expired && <Deactivate data={data} call={call} onDone={reload} />}
          </div>
        </div>
      </div>
    </>
  );
}

function LabelEditor({ token, initial }: { token: string; initial: string }) {
  const call = useManagerCall();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      await call((p) => api.managerSetLabel(p, token, value.trim()));
      setSaved(value.trim());
      setValue(value.trim());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const dirty = value.trim() !== saved;
  return (
    <form onSubmit={submit} className="label-edit" aria-label="Label">
      <div className="field">
        <label htmlFor="label" className="sr-only">
          Label
        </label>
        <input id="label" className="input" value={value} maxLength={120} placeholder="Add a label" onChange={(e) => setValue(e.target.value)} />
      </div>
      {dirty && (
        <button className="btn btn-sm" type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save'}
        </button>
      )}
      {error && (
        <span className="error" role="alert">
          Not saved.
        </span>
      )}
    </form>
  );
}

function SuggestEditor({
  data,
  defaultZone,
  sug,
}: {
  data: ManagerLinkData;
  defaultZone: string;
  sug: ReturnType<typeof useSuggestions>;
}) {
  const [szone, setSzone] = useState(defaultZone); // the zone the times are typed in
  const tomorrow = nextWeekday(todayIn(szone));
  const [date, setDate] = useState(`${tomorrow.y}-${String(tomorrow.m).padStart(2, '0')}-${String(tomorrow.d).padStart(2, '0')}`);
  const [time, setTime] = useState('10:00');
  const [endTime, setEndTime] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => setSzone(defaultZone), [defaultZone]);

  function add(e: FormEvent) {
    e.preventDefault();
    const [y, m, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    if (!y || !m || !d || Number.isNaN(h) || Number.isNaN(mi)) {
      sug.setError('Pick a date and start time.');
      return;
    }
    const from = zonedToUtc(y, m, d, h, mi, szone);
    let to = from;
    if (endTime) {
      const [eh, em] = endTime.split(':').map(Number);
      to = zonedToUtc(y, m, d, eh, em, szone);
      if (!(to > from)) {
        sug.setError('End must be after the start.');
        return;
      }
    }
    sug.addRange(from, to, szone);
  }

  return (
    <section className="section" aria-labelledby="sug-h" style={{ gap: 16 }}>
      <div className="summary-head">
        <h2 id="sug-h">Suggest times</h2>
        {sug.visible.length > 0 &&
          (confirmClear ? (
            <div role="group" aria-label="Confirm clear all" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="meta">Remove all {sug.visible.length}?</span>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => {
                  sug.clearAll(szone);
                  setConfirmClear(false);
                }}
              >
                Remove all
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirmClear(true)}>
              Clear all
            </button>
          ))}
      </div>

      <div className="field">
        <label htmlFor="sz">In time zone</label>
        <ZoneCombobox id="sz" value={szone} onChange={setSzone} />
      </div>

      {sug.visible.length > 0 && (
        <ul className="chips" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Suggested times">
          {sug.visible.map((s) => (
            <li key={s.start} className="chip">
              <span>
                {formatDateTime(Date.parse(s.start), szone)}, {s.minutes} min
              </span>
              <button type="button" aria-label={`Remove ${formatDateTime(Date.parse(s.start), szone)}`} onClick={() => sug.remove(s.start, szone)}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="suggest-form" onSubmit={add} noValidate>
        <div className="field">
          <label htmlFor="s-date">Date</label>
          <input id="s-date" className="input" type="date" value={date} onChange={(e) => sug.setError(null) ?? setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="s-len">Interview length</label>
          <select id="s-len" className="select" value={sug.minutes} onChange={(e) => sug.setMinutes(e.target.value)}>
            {[15, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-time">From</label>
          <input id="s-time" className="input" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="s-end">To (optional, for a range)</label>
          <input id="s-end" className="input" type="time" step={900} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
        <button className="btn btn-primary" type="submit">
          <Plus size={16} weight="bold" aria-hidden />
          Add
        </button>
      </form>

      {data.batch.length > 1 && (
        <div className="radios" role="radiogroup" aria-label="Apply to">
          <label>
            <input type="radio" name="scope" checked={sug.scope === 'this'} onChange={() => sug.setScope('this')} />
            This link
          </label>
          <label>
            <input type="radio" name="scope" checked={sug.scope === 'batch'} onChange={() => sug.setScope('batch')} />
            All {data.batch.length} in batch
          </label>
        </div>
      )}

      {sug.error && (
        <p className="error" role="alert">
          {sug.error}
        </p>
      )}
      <p className="hint" role="status" aria-live="polite">
        {sug.status === 'saving' ? 'Saving...' : sug.status === 'saved' ? 'Saved' : ''}
      </p>
    </section>
  );
}

/** Asks how long the interview is for a range dragged on the calendar. */
function SuggestDialog({
  range,
  zone,
  existing,
  initialMinutes,
  onCancel,
  onConfirm,
}: {
  range: { from: number; to: number };
  zone: string;
  existing: number;
  initialMinutes: number;
  onCancel: () => void;
  onConfirm: (minutes: number) => string | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [len, setLen] = useState(initialMinutes);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const starts = expandRange(range.from, range.to, len);
  const label = starts.map((t) => formatTime(t, zone));
  const shown = label.length > 6 ? `${label.slice(0, 6).join(', ')} and ${label.length - 6} more` : label.join(', ');
  const tooMany = existing + starts.length > 60;

  return (
    <dialog ref={ref} className="dlg" aria-labelledby="dlg-h" onClose={onCancel} onCancel={onCancel}>
      <form
        method="dialog"
        className="dlg-body"
        onSubmit={(e) => {
          e.preventDefault();
          setError(onConfirm(len));
        }}
      >
        <div>
          <h2 id="dlg-h">How long is the interview?</h2>
          <p className="meta" style={{ marginTop: 6 }}>
            {formatDayLong(range.from, zone)}, {rangeLabel(range.from, range.to, zone)} ({tzLabel(zone)})
          </p>
        </div>
        <div className="durations" role="radiogroup" aria-label="Interview length">
          {[15, 30, 45, 60, 90].map((m) => (
            <label key={m}>
              <input type="radio" name="len" checked={len === m} onChange={() => setLen(m)} />
              {m} min
            </label>
          ))}
        </div>
        <p className="meta" aria-live="polite">
          {starts.length === 1 ? 'Adds 1 time' : `Adds ${starts.length} times`}: {shown}
        </p>
        {(error || tooMany) && (
          <p className="error" role="alert">
            {tooMany ? 'That is more than 60 suggested times. Pick a shorter range.' : error}
          </p>
        )}
        <div className="dlg-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={tooMany}>
            Add
          </button>
        </div>
      </form>
    </dialog>
  );
}

function Deactivate({
  data,
  call,
  onDone,
}: {
  data: ManagerLinkData;
  call: ReturnType<typeof useManagerCall>;
  onDone: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [scope, setScope] = useState<'this' | 'batch'>('this');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function go() {
    setBusy(true);
    setError(false);
    try {
      await call((p) => api.managerDeactivate(p, data.token, scope === 'batch'));
      await onDone();
      setAsking(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <div>
        <button className="btn btn-danger btn-sm" onClick={() => setAsking(true)}>
          Deactivate
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 12 }} role="group" aria-label="Confirm deactivate">
      <p>Candidates will see the link as inactive. This cannot be undone.</p>
      {data.batch.length > 1 && (
        <div className="radios">
          <label>
            <input type="radio" name="dscope" checked={scope === 'this'} onChange={() => setScope('this')} />
            This link
          </label>
          <label>
            <input type="radio" name="dscope" checked={scope === 'batch'} onChange={() => setScope('batch')} />
            All {data.batch.length} in batch
          </label>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          Could not deactivate.
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-danger" onClick={go} disabled={busy}>
          {busy ? 'Deactivating...' : 'Deactivate'}
        </button>
        <button className="btn" onClick={() => setAsking(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
