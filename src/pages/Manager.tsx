import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CaretDown, CaretRight, X } from '@phosphor-icons/react';
import { ManagerShell } from '../components/ManagerShell';
import { CopyButton } from '../components/CopyButton';
import { Button, Card, CopyIconButton, Stepper, StatusChip, TextInput, type Status } from '../components/ui';
import { useManagerCall } from '../lib/session';
import { api } from '../lib/api';
import { batchLabel, isWaiting, lastUpdateAt, linkStatus, relativeTime } from '../lib/linkStatus';
import { browserZone } from '../lib/time';
import { ApiError, type CreatedLinks, type LinkRow } from '../lib/types';

const candidateUrl = (token: string) => `${window.location.origin}/${token}`;

type Filter = 'all' | 'new' | 'waiting';

interface Item {
  l: LinkRow;
  status: Status;
  at: number;
  unseen: boolean;
}
type Entry =
  | { kind: 'single'; key: string; at: number; unseen: boolean; item: Item }
  | { kind: 'batch'; key: string; at: number; unseen: boolean; label: string; size: number; newest: Item; children: Item[] };

/** Unseen first, then newest update first. */
const byRecency = (a: { unseen: boolean; at: number }, b: { unseen: boolean; at: number }) =>
  Number(b.unseen) - Number(a.unseen) || b.at - a.at;

export default function Manager() {
  return (
    <ManagerShell>
      <Links />
    </ManagerShell>
  );
}

function Links() {
  const call = useManagerCall();
  const navigate = useNavigate();
  const [data, setData] = useState<{ links: LinkRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [created, setCreated] = useState<CreatedLinks | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    try {
      setError(null);
      const o = await call((p) => api.managerOverview(p));
      setData({ links: o.links, total: o.total });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'bad_passcode') return; // signed out; the gate takes over
      setError('Could not load links.');
    }
  }, [call]);

  useEffect(() => {
    document.title = 'Manage links | QuickSlot';
    void reload();
  }, [reload]);

  // Every active link with its one status. Recomputed when data arrives.
  const items = useMemo<Item[]>(() => {
    const tz = browserZone();
    const now = Date.now();
    return (data?.links ?? [])
      .filter((l) => l.is_active)
      .map((l) => {
        const status = linkStatus(l, tz, now);
        return { l, status, at: lastUpdateAt(l, status), unseen: status === 'New update' };
      });
  }, [data]);

  const counts = useMemo(
    () => ({
      all: items.length,
      new: items.filter((i) => i.status === 'New update').length,
      waiting: items.filter((i) => isWaiting(i.status)).length,
    }),
    [items],
  );

  const q = query.trim().toLowerCase();
  const entries = useMemo<Entry[]>(() => {
    const batchSize = new Map<string, number>();
    items.forEach((i) => i.l.batch_id && batchSize.set(i.l.batch_id, (batchSize.get(i.l.batch_id) ?? 0) + 1));
    const all = new Map<string, Item[]>();
    items.forEach((i) => i.l.batch_id && (batchSize.get(i.l.batch_id) ?? 0) > 1 && all.set(i.l.batch_id, [...(all.get(i.l.batch_id) ?? []), i]));

    const match = (i: Item) =>
      q
        ? `${i.l.label} ${i.l.token}`.toLowerCase().includes(q)
        : filter === 'all' || (filter === 'new' ? i.status === 'New update' : isWaiting(i.status));

    const out: Entry[] = [];
    const seenBatch = new Set<string>();
    for (const i of items) {
      const bid = i.l.batch_id;
      if (bid && all.has(bid)) {
        if (seenBatch.has(bid)) continue;
        seenBatch.add(bid);
        const children = all.get(bid)!;
        const shown = children.filter(match).sort(byRecency);
        if (!shown.length) continue;
        const newest = [...shown].sort((a, b) => b.at - a.at)[0];
        out.push({
          kind: 'batch',
          key: bid,
          at: newest.at,
          unseen: shown.some((c) => c.unseen),
          label: batchLabel(children.map((c) => c.l.label)),
          size: children.length,
          newest,
          children: shown,
        });
      } else if (match(i)) {
        out.push({ kind: 'single', key: i.l.token, at: i.at, unseen: i.unseen, item: i });
      }
    }
    return out.sort(byRecency);
  }, [items, filter, q]);

  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  return (
    <>
      <h1 className="page-title">Manage links</h1>

      <div>
        <CreateForm
          onCreated={(c) => {
            setCreated(c);
            void reload();
          }}
        />
        {created && <CreatedList created={created} onDismiss={() => setCreated(null)} />}
      </div>

      <div className="filter-row">
        <div className="filter-buttons" role="group" aria-label="Filter links">
          {(
            [
              ['all', 'All'],
              ['new', 'New'],
              ['waiting', 'Waiting'],
            ] as [Filter, string][]
          ).map(([k, label]) => {
            const on = !q && filter === k;
            return (
              <Button
                key={k}
                size="sm"
                variant={on ? 'primary' : 'secondary'}
                aria-pressed={on}
                onClick={() => {
                  setQuery('');
                  setFilter(k);
                }}
              >
                {label} · {counts[k]}
              </Button>
            );
          })}
        </div>
        <SearchBox
          value={query}
          onChange={setQuery}
          onOpen={(t) => navigate(`/${t}/recruiter`)}
          onEnter={() => {
            const f = entries[0];
            const first = f && (f.kind === 'single' ? f.item : f.children[0]);
            if (first) navigate(`/${first.l.token}/recruiter`);
          }}
        />
      </div>

      <Card className="table-card">
        {error ? (
          <div className="empty" role="alert">
            <p>{error}</p>
            <Button size="sm" variant="secondary" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : !data ? (
          <SkeletonRows />
        ) : entries.length === 0 ? (
          <div className="empty">
            <h2>{data.total === 0 ? 'No links yet' : q ? 'No links match' : 'Nothing here'}</h2>
            {data.total === 0 && <p>Create one above.</p>}
          </div>
        ) : (
          <table className="links">
              <colgroup>
                <col style={{ width: 64 }} />
                <col />
                <col style={{ width: 252 }} />
                <col style={{ width: 200 }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Copy link</span>
                  </th>
                  <th scope="col">Label</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last update</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) =>
                  e.kind === 'single' ? (
                    <LinkRowView key={e.key} item={e.item} />
                  ) : (
                    <BatchRows key={e.key} e={e} open={open.has(e.key)} onToggle={() => toggle(e.key)} />
                  ),
                )}
              </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function updateText(i: Item) {
  return (isWaiting(i.status) ? 'Created ' : '') + relativeTime(i.at).replace(/^Just now$/, isWaiting(i.status) ? 'just now' : 'Just now');
}

function LinkRowView({ item: i, child }: { item: Item; child?: boolean }) {
  const name = i.l.label || 'Untitled link';
  return (
    <tr className={[i.unseen ? 'is-unseen' : '', child ? 'is-child' : ''].join(' ').trim() || undefined}>
      <td className="cell-copy">
        <CopyIconButton text={candidateUrl(i.l.token)} />
      </td>
      <td>
        <Link to={`/${i.l.token}/recruiter`} className={`row-link${i.unseen ? ' is-unseen' : ''}${child ? ' is-child' : ''}`}>
          {name}
        </Link>
      </td>
      <td>
        <StatusChip status={i.status} />
      </td>
      <td className={`cell-when${i.unseen ? ' is-unseen' : ''}`} title={new Date(i.at).toLocaleString()}>
        {updateText(i)}
      </td>
    </tr>
  );
}

function BatchRows({ e, open, onToggle }: { e: Extract<Entry, { kind: 'batch' }>; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr>
        <td className="cell-copy">
          <button type="button" className="chev-toggle" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} links in ${e.label}`} onClick={onToggle}>
            {open ? <CaretDown weight="bold" aria-hidden /> : <CaretRight weight="bold" aria-hidden />}
          </button>
        </td>
        <td>
          <div className="batch-title">{e.label}</div>
          <div className="batch-sub">Batch of {e.size}</div>
        </td>
        <td />
        <td className={`cell-when${e.unseen ? ' is-unseen' : ''}`} title={new Date(e.newest.at).toLocaleString()}>
          {updateText(e.newest)}
        </td>
      </tr>
      {open && e.children.map((c) => <LinkRowView key={c.l.token} item={c} child />)}
    </>
  );
}

function SkeletonRows() {
  return (
    <div style={{ padding: 20, display: 'grid', gap: 18 }} aria-busy="true" aria-label="Loading links">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.4fr 0.6fr', gap: 20 }}>
          <div className="skel" />
          <div className="skel" />
          <div className="skel" />
          <div className="skel" />
        </div>
      ))}
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: (c: CreatedLinks) => void }) {
  const call = useManagerCall();
  const [label, setLabel] = useState('');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = count;
    setBusy(true);
    setError(null);
    const trimmed = label.trim();
    const labels = Array.from({ length: n }, (_, i) => (trimmed ? (n > 1 ? `${trimmed} ${i + 1}` : trimmed) : ''));
    try {
      const res = await call((p) => api.managerCreate(p, n, labels));
      onCreated(res);
      setLabel('');
      setCount(1);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'bad_passcode')) setError('Not created. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="create-card">
      <form className="create-grid" onSubmit={submit} noValidate aria-label="Create links">
        <TextInput
          label="Label"
          value={label}
          maxLength={120}
          placeholder="Candidate name or role (optional)"
          onChange={(e) => setLabel(e.target.value)}
        />
        <Stepper label="Links" value={count} onChange={setCount} min={1} max={25} />
        <Button size="lg" variant="primary" type="submit" className="create-submit" disabled={busy}>
          {busy ? 'Creating...' : count > 1 ? 'Create links' : 'Create link'}
        </Button>
      </form>
      {error && (
        <p className="error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
    </Card>
  );
}

function CreatedList({ created, onDismiss }: { created: CreatedLinks; onDismiss: () => void }) {
  const all = created.links.map((l) => `${l.label ? l.label + ': ' : ''}${candidateUrl(l.token)}`).join('\n');
  return (
    <section className="panel panel-pad" style={{ marginTop: 16 }} aria-label="New links" role="status">
      <div className="summary-head">
        <h2>{created.links.length > 1 ? `${created.links.length} new links` : 'New link'}</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {created.links.length > 1 && (
            <CopyButton text={all} className="btn btn-sm">
              Copy all
            </CopyButton>
          )}
          <button className="btn btn-sm btn-icon btn-quiet" onClick={onDismiss} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="created">
        {created.links.map((l) => (
          <div className="created-row" key={l.token}>
            <code>{candidateUrl(l.token)}</code>
            {l.label && <span className="muted">{l.label}</span>}
            <CopyButton text={candidateUrl(l.token)} className="btn btn-sm">
              Copy link
            </CopyButton>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Finds links by label or code as you type. Pasting a link (or a code) opens it straight away. */
function SearchBox({ value, onChange, onOpen, onEnter }: { value: string; onChange: (v: string) => void; onOpen: (token: string) => void; onEnter: () => void }) {
  function change(v: string) {
    const m = v.match(/(?:^|[/\s])([0-9a-f]{16})(?=$|[/?#\s])/i);
    if (m && (v.includes('/') || v.trim().length === 16)) {
      onOpen(m[1].toLowerCase());
      return;
    }
    onChange(v);
  }
  return (
    <form
      className="search-form"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onEnter();
      }}
    >
      <TextInput
        label="Search"
        type="search"
        placeholder="Search by label, or paste a link"
        autoComplete="off"
        value={value}
        onChange={(e) => change(e.target.value)}
      />
    </form>
  );
}
