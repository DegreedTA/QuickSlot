import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DotsThree, Plus, X } from '@phosphor-icons/react';
import { ManagerShell } from '../components/ManagerShell';
import { RecruiterCalendar, type Suggestion } from '../components/RecruiterCalendar';
import { CopyButton } from '../components/CopyButton';
import { ZoneCombobox } from '../components/ZoneCombobox';
import { Badge, Button, Card, Select, StatusChip, TextInput } from '../components/ui';
import { useDismiss } from '../components/ui/useDismiss';
import { useManagerCall, useSession } from '../lib/session';
import { api } from '../lib/api';
import { ApiError, type ManagerLinkData, type SuggestedSlot } from '../lib/types';
import { linkStatus, statusInputFromLink } from '../lib/linkStatus';
import {
  LEAD_MINUTES,
  LEAD_MS,
  ROWS,
  SLOT_MS,
  WINDOW_DAYS,
  addDays,
  calDiffDays,
  calKey,
  formatCalShort,
  formatDayLong,
  formatTime,
  groupByDay,
  rangeLabel,
  summaryText,
  isWeekend,
  mondayOf,
  slotInstantFor,
  todayIn,
  tzLabel,
  zonedToUtc,
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
    <ManagerShell wide>
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
      <Link to="/" className="back-link">
        ← All links
      </Link>
      {state.kind === 'loading' && (
        <div aria-busy="true" aria-label="Loading" style={{ display: 'grid', gap: 32 }}>
          <div className="skel" style={{ height: 40, width: '40%' }} />
          <div className="skel" style={{ height: 520, borderRadius: 16 }} />
        </div>
      )}
      {state.kind === 'failed' && (
        <Card className="empty" role="alert">
          <p>Could not load. Check your connection.</p>
          <Button size="sm" variant="secondary" onClick={() => void load(true)}>
            Try again
          </Button>
        </Card>
      )}
      {state.kind === 'notfound' && (
        <Card className="empty">
          <h2>Link not found</h2>
        </Card>
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

const prettyHours = (h: number) => `${Number(h.toFixed(2))} h free`;

/** "Updated today, 10:26 PM" / "Updated yesterday, ..." / "Updated Nov 5, 10:26 AM" */
function updatedText(ts: number, tz: string) {
  const days = calDiffDays(todayIn(tz, ts), todayIn(tz));
  const time = formatTime(ts, tz);
  if (days === 0) return `Updated today, ${time}`;
  if (days === 1) return `Updated yesterday, ${time}`;
  return `Updated ${formatCalShort(todayIn(tz, ts))}, ${time}`;
}

function DetailBody({ data, reload }: { data: ManagerLinkData; reload: () => Promise<void> }) {
  const { zone, setZone } = useSession();
  const sug = useSuggestions(data, reload);
  const slots = useMemo(() => new Set(data.slots.map((s) => Date.parse(s))), [data.slots]);
  const slotArray = useMemo(() => [...slots], [slots]);
  const suggestions: Suggestion[] = useMemo(
    () => sug.visible.map((s) => ({ start: Date.parse(s.start), minutes: s.minutes })),
    [sug.visible],
  );
  const [pending, setPending] = useState<{ from: number; to: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(data.label);
  const [deactivating, setDeactivating] = useState(false);

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
  const status = expired ? null : linkStatus(statusInputFromLink(data), zone);

  // weeks that cover the window, plus any week that holds shared time. Weeks wholly in the past are not offered.
  const now = Date.now();
  const today = todayIn(zone, now);
  const weeks = useMemo(() => {
    const dow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
    const thisMon = mondayOf(today);
    const first = dow === 0 || dow === 6 ? addDays(thisMon, 7) : thisMon; // on a weekend this week's Mon-Fri is over
    const lastShared = slotArray.length ? todayIn(zone, Math.max(...slotArray)) : today;
    const lastDay = calDiffDays(today, lastShared) > WINDOW_DAYS ? lastShared : addDays(today, WINDOW_DAYS - 1);
    const n = Math.max(1, Math.floor(calDiffDays(first, mondayOf(lastDay)) / 7) + 1);
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
  const weekName = (w: CalDate) => {
    const fri = addDays(w, 4);
    return `${formatCalShort(w)} – ${w.m === fri.m ? fri.d : formatCalShort(fri)}`;
  };
  function tabKeys(e: ReactKeyboardEvent) {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = Math.min(weeks.length - 1, Math.max(0, idx + d));
    setPicked(n);
    requestAnimationFrame(() => document.getElementById(`wk-${n}`)?.focus());
  }

  // Selected (picked) times and "also free", for the right column and for Copy
  const picks = rankedMs.map((t, i) => {
    const s = data.suggested_slots.find((x) => Date.parse(x.start) === t);
    return { t, rank: i + 1, end: t + (s?.minutes ?? 30) * 60000 };
  });
  const freeGroups = groupByDay(slotArray, zone);
  const copyText = () => {
    const parts: string[] = [];
    if (picks.length) parts.push(`Preferred times (${tzLabel(zone)})\n${picks.map((p) => `${p.rank}. ${formatDayLong(p.t, zone)}, ${rangeLabel(p.t, p.end, zone)}`).join('\n')}`);
    const free = summaryText(slotArray, zone);
    if (free) parts.push(free);
    return parts.join('\n\n');
  };
  const pickedCount = sug.visible.filter((s) => ranks.has(Date.parse(s.start))).length;

  return (
    <>
      <div className="title-row">
        <div className="title-left">
          {renaming ? (
            <RenameLabel
              token={data.token}
              initial={label}
              onDone={(v) => {
                if (v != null) setLabel(v);
                setRenaming(false);
              }}
            />
          ) : (
            <h1 className="page-title">{label || 'Untitled link'}</h1>
          )}
          <div className="title-meta">
            {status && <StatusChip status={status} />}
            <span className="title-updated">{updatedText(Date.parse(data.updated_at), zone)}</span>
          </div>
          {data.batch.length > 1 && (
            <div className="batch-list" aria-label="Links in this batch">
              {data.batch.map((b, i) => (
                <Link
                  key={b.token}
                  className={`batch-tag${b.token === data.token ? ' is-current' : ''}`}
                  to={`/${b.token}/recruiter`}
                  aria-current={b.token === data.token ? 'page' : undefined}
                >
                  {b.label || `Link ${i + 1}`}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="title-actions">
          <CopyButton text={candUrl} className="ds-btn ds-btn-md ds-btn-primary">
            Copy link
          </CopyButton>
          <a className="ds-btn ds-btn-md ds-btn-secondary" href={candUrl} target="_blank" rel="noreferrer">
            Preview
          </a>
          <MoreMenu canDeactivate={!expired} onRename={() => setRenaming(true)} onDeactivate={() => setDeactivating(true)} />
        </div>
      </div>

      {expired && <p className="notice">This link is inactive.</p>}

      <div className="detail-cols">
        <section className="cal-col" aria-label="Availability">
          <div className="zone-line">
            <label htmlFor="rz">Times shown in</label>
            <div className="ds-zone">
              <ZoneCombobox id="rz" value={zone} onChange={setZone} />
            </div>
          </div>

          <div className="week-nav">
            <button type="button" className="nav-arrow" aria-label="Previous week" disabled={idx === 0} onClick={() => setPicked(idx - 1)}>
              <Chevron dir="left" />
            </button>
            <div className="week-tabs" role="tablist" aria-label="Weeks" onKeyDown={tabKeys}>
              {weeks.map((w, i) => {
                const h = hoursIn(w);
                return (
                  <button
                    key={calKey(w)}
                    id={`wk-${i}`}
                    type="button"
                    role="tab"
                    className="week-tab"
                    aria-selected={i === idx}
                    tabIndex={i === idx ? 0 : -1}
                    onClick={() => setPicked(i)}
                  >
                    <span>{weekName(w)}</span>
                    <span>{h > 0 ? prettyHours(h) : '–'}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="nav-arrow" aria-label="Next week" disabled={idx >= weeks.length - 1} onClick={() => setPicked(idx + 1)}>
              <Chevron dir="right" />
            </button>
          </div>

          <div className="legend-row">
            <span>
              <i className="sw sw-free" aria-hidden="true" />
              Availability
            </span>
            <span>
              <i className="sw sw-picked" aria-hidden="true" />
              Selected times
            </span>
            <span>
              <i className="sw sw-suggested" aria-hidden="true" />
              Suggested times
            </span>
            {!expired && <strong className="legend-hint">Drag on the calendar to suggest a time</strong>}
          </div>

          <RecruiterCalendar
            tz={zone}
            weekStart={weekStart}
            slots={slots}
            suggestions={suggestions}
            ranks={ranks}
            label={`Candidate availability, ${formatCalShort(weekStart)} to ${formatCalShort(weekEnd)}, in ${tzLabel(zone)}`}
            windowStart={Math.ceil((now + LEAD_MS) / SLOT_MS) * SLOT_MS}
            onSuggestRange={expired ? undefined : onCalendarRange}
          />
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

        <div className="side-col">
          <Card className="side-card" aria-labelledby="sel-h">
            <div className="card-head">
              <h2 id="sel-h">Selected times</h2>
              <CopyButton text={copyText} disabled={!picks.length && !freeGroups.length} className="ds-btn ds-btn-sm ds-btn-ghost">
                Copy
              </CopyButton>
            </div>
            {picks.length === 0 ? (
              <p className="side-empty">{sug.visible.length ? 'No picks yet.' : 'None yet. Suggest times and the candidate can pick.'}</p>
            ) : (
              <ol className="pick-list">
                {picks.map((p) => (
                  <li key={p.t}>
                    <span className="pick-n">{p.rank}</span>
                    <span>
                      {formatDayLong(p.t, zone)} · {rangeLabel(p.t, p.end, zone).replace('–', ' – ')}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <h3 className="also-free">Also free</h3>
            {freeGroups.length === 0 ? (
              <p className="side-empty">Nothing shared yet.</p>
            ) : (
              <div className="free-list">
                {freeGroups.map((g) => (
                  <div key={g.key} className="free-row">
                    <span className="free-day">{g.label}</span>
                    <span className="free-ranges">
                      {g.ranges.map((r) => (
                        <span key={r.start}>{rangeLabel(r.start, r.end, zone).replace('–', ' – ')}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <SuggestedCard data={data} zone={zone} sug={sug} ranks={ranks} pickedCount={pickedCount} expired={expired} />
        </div>
      </div>

      {deactivating && <DeactivateDialog data={data} onClose={() => setDeactivating(false)} onDone={reload} />}
    </>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points={dir === 'left' ? '11 3.5 5.5 9 11 14.5' : '7 3.5 12.5 9 7 14.5'} />
    </svg>
  );
}

/** "More" button and its menu: Rename link, Deactivate link. */
function MoreMenu({ canDeactivate, onRename, onDeactivate }: { canDeactivate: boolean; onRename: () => void; onDeactivate: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(wrap, open, close);

  useEffect(() => {
    if (open) wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  function keys(e: ReactKeyboardEvent) {
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      if (e.key === 'Escape') btn.current?.focus();
      return;
    } else return;
    e.preventDefault();
  }

  return (
    <div className="more-wrap" ref={wrap}>
      <button
        ref={btn}
        type="button"
        className="more-btn"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <DotsThree size={20} weight="bold" aria-hidden />
      </button>
      {open && (
        <div className="more-menu" role="menu" aria-label="Link actions" onKeyDown={keys}>
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); onRename(); }}>
            Rename link
          </button>
          <div className="menu-divider" role="separator" />
          <button type="button" role="menuitem" className="menu-item is-strong" disabled={!canDeactivate} onClick={() => { setOpen(false); onDeactivate(); }}>
            Deactivate link
          </button>
        </div>
      )}
    </div>
  );
}

/** The H1, edited in place. Enter saves, Escape cancels. */
function RenameLabel({ token, initial, onDone }: { token: string; initial: string; onDone: (saved: string | null) => void }) {
  const call = useManagerCall();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (v === initial) return onDone(null);
    setBusy(true);
    setError(false);
    try {
      await call((p) => api.managerSetLabel(p, token, v));
      onDone(v);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <form className="rename" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onDone(null)} aria-label="Rename link">
      <input
        className="rename-input"
        aria-label="Link label"
        value={value}
        maxLength={120}
        placeholder="Add a label"
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button size="sm" type="submit" disabled={busy}>
        {busy ? 'Saving...' : 'Save'}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
        Cancel
      </Button>
      {error && (
        <span className="error" role="alert">
          Not saved.
        </span>
      )}
    </form>
  );
}

function SuggestedCard({
  data,
  zone,
  sug,
  ranks,
  pickedCount,
  expired,
}: {
  data: ManagerLinkData;
  zone: string;
  sug: ReturnType<typeof useSuggestions>;
  ranks: Map<number, number>;
  pickedCount: number;
  expired: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [list, setList] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const closeAdd = useCallback(() => setAdding(false), []);
  useDismiss(wrap, adding, closeAdd);
  const n = sug.visible.length;

  return (
    <Card className="side-card" aria-labelledby="sug-h">
      <div className="card-head">
        <h2 id="sug-h">Suggested times</h2>
        {n > 0 &&
          !expired &&
          (confirmClear ? (
            <div role="group" aria-label="Confirm clear all" className="confirm-inline">
              <span>Remove all {n}?</span>
              <Button
                size="sm"
                onClick={() => {
                  sug.clearAll(zone);
                  setConfirmClear(false);
                }}
              >
                Remove all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <button type="button" className="text-btn" onClick={() => setConfirmClear(true)}>
              Clear all
            </button>
          ))}
      </div>
      <p className="sug-count">
        {n === 0 ? (
          'No suggested times yet'
        ) : (
          <>
            {n} suggested · <b>{pickedCount} picked</b>
          </>
        )}
      </p>
      {!expired && (
        <div className="sug-actions" ref={wrap}>
          <Button size="md" variant="secondary" aria-haspopup="dialog" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
            <Plus size={16} weight="bold" aria-hidden /> Add a time
          </Button>
          <Button size="md" variant="ghost" aria-expanded={list} aria-controls="sug-list" onClick={() => setList((l) => !l)}>
            {list ? 'Hide list' : 'Show as list'}
          </Button>
          {adding && <AddTimePopover zone={zone} sug={sug} onClose={() => setAdding(false)} />}
        </div>
      )}
      {list && (
        <ul id="sug-list" className="sug-list" aria-label="Suggested times">
          {n === 0 && <li className="side-empty">Nothing suggested yet.</li>}
          {sug.visible.map((s) => {
            const t = Date.parse(s.start);
            return (
              <li key={s.start}>
                <span>
                  {formatDayLong(t, zone)} · {rangeLabel(t, t + s.minutes * 60000, zone).replace('–', ' – ')}
                  {ranks.has(t) && <Badge>Picked #{ranks.get(t)}</Badge>}
                </span>
                {!expired && (
                  <button type="button" className="ds-icon-btn" aria-label={`Remove ${formatDayLong(t, zone)} ${formatTime(t, zone)}`} onClick={() => sug.remove(s.start, zone)}>
                    <X weight="bold" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data.batch.length > 1 && !expired && (
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
      {!adding && sug.error && (
        <p className="error" role="alert">
          {sug.error}
        </p>
      )}
      <p className="hint" role="status" aria-live="polite">
        {sug.status === 'saving' ? 'Saving...' : sug.status === 'saved' ? 'Saved' : ''}
      </p>
    </Card>
  );
}

/** The date / length / from / to form, in the page's time zone. */
function AddTimePopover({ zone, sug, onClose }: { zone: string; sug: ReturnType<typeof useSuggestions>; onClose: () => void }) {
  const tomorrow = nextWeekday(todayIn(zone));
  const [date, setDate] = useState(`${tomorrow.y}-${String(tomorrow.m).padStart(2, '0')}-${String(tomorrow.d).padStart(2, '0')}`);
  const [time, setTime] = useState('10:00');
  const [endTime, setEndTime] = useState('');

  function add(e: FormEvent) {
    e.preventDefault();
    const [y, m, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    if (!y || !m || !d || Number.isNaN(h) || Number.isNaN(mi)) {
      sug.setError('Pick a date and start time.');
      return;
    }
    const from = zonedToUtc(y, m, d, h, mi, zone);
    let to = from;
    if (endTime) {
      const [eh, em] = endTime.split(':').map(Number);
      to = zonedToUtc(y, m, d, eh, em, zone);
      if (!(to > from)) {
        sug.setError('End must be after the start.');
        return;
      }
    }
    if (sug.addRange(from, to, zone) === null) onClose();
  }

  return (
    <form className="add-pop ds-card" role="dialog" aria-label="Add a time" onSubmit={add} noValidate onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <TextInput label="Date" type="date" value={date} autoFocus onChange={(e) => { sug.setError(null); setDate(e.target.value); }} />
      <div className="ds-field">
        <label className="ds-label" htmlFor="s-len">
          Interview length
        </label>
        <Select id="s-len" value={sug.minutes} onChange={(e) => sug.setMinutes(e.target.value)}>
          {[15, 30, 45, 60, 90].map((m) => (
            <option key={m} value={m}>
              {m} min
            </option>
          ))}
        </Select>
      </div>
      <div className="add-pop-times">
        <TextInput label="From" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        <TextInput label="To (optional)" type="time" step={900} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
      </div>
      {sug.error && (
        <p className="error" role="alert">
          {sug.error}
        </p>
      )}
      <div className="add-pop-actions">
        <Button size="md" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="md" type="submit">
          Add
        </Button>
      </div>
    </form>
  );
}

/** Confirm before deactivating: same wording and batch choice as before, now in a dialog. */
function DeactivateDialog({ data, onClose, onDone }: { data: ManagerLinkData; onClose: () => void; onDone: () => Promise<void> }) {
  const call = useManagerCall();
  const ref = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<'this' | 'batch'>('this');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function go() {
    setBusy(true);
    setError(false);
    try {
      await call((p) => api.managerDeactivate(p, data.token, scope === 'batch'));
      await onDone();
      onClose();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="dlg" aria-labelledby="deact-h" onClose={onClose} onCancel={onClose}>
      <div className="dlg-body" role="group">
        <h2 id="deact-h">Deactivate this link?</h2>
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
        <div className="dlg-actions">
          <Button size="md" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" className="btn-danger-ds" onClick={go} disabled={busy}>
            {busy ? 'Deactivating...' : 'Deactivate'}
          </Button>
        </div>
      </div>
    </dialog>
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
          <Button size="md" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="md" type="submit" disabled={tooMany}>
            Add
          </Button>
        </div>
      </form>
    </dialog>
  );
}
