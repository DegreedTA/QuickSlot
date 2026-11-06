import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, X } from '@phosphor-icons/react';
import { ManagerShell } from '../components/ManagerShell';
import { CopyButton } from '../components/CopyButton';
import { useManagerCall } from '../lib/session';
import { api } from '../lib/api';
import { ApiError, type CreatedLinks, type LinkRow, type Overview } from '../lib/types';

const candidateUrl = (token: string) => `${window.location.origin}/${token}`;

function relative(iso: string): string {
  const diff = Date.parse(iso) - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
  if (abs < 60e3) return 'just now';
  if (abs < 3600e3) return rtf.format(Math.round(diff / 60e3), 'minute');
  if (abs < 86400e3) return rtf.format(Math.round(diff / 3600e3), 'hour');
  return rtf.format(Math.round(diff / 86400e3), 'day');
}

type Filter = 'active' | 'expired';

const EXPIRING_SOON_MS = 7 * 86400e3;

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
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [created, setCreated] = useState<CreatedLinks | null>(null);
  const [query, setQuery] = useState('');

  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await call((p) => api.managerOverview(p)));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'bad_passcode') return; // signed out; the gate takes over
      setError('Could not load links.');
    }
  }, [call]);

  useEffect(() => {
    document.title = 'Links | QuickSlot';
    void reload();
  }, [reload]);

  const batchSize = useMemo(() => {
    const m = new Map<string, number>();
    data?.links.forEach((l) => l.batch_id && m.set(l.batch_id, (m.get(l.batch_id) ?? 0) + 1));
    return m;
  }, [data]);

  const counts = useMemo(() => {
    const links = data?.links ?? [];
    return {
      active: links.filter((l) => l.is_active).length,
      changed: links.filter((l) => l.is_active && l.has_unseen_change).length,
      expired: links.filter((l) => !l.is_active).length,
    };
  }, [data]);

  // newest change first. While searching, every link is searched, active or not.
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const links = (data?.links ?? []).filter((l) =>
      q ? `${l.label} ${l.token}`.toLowerCase().includes(q) : filter === 'active' ? l.is_active : !l.is_active,
    );
    return [...links].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  }, [data, filter, q]);

  return (
    <>
      <div className="page-head">
        <h1>Links</h1>
      </div>

      <div className="strip" aria-label="Summary">
        <div>
          <b>{data?.active ?? '-'}</b>
          <span>active</span>
        </div>
        <div>
          <b>{data?.total ?? '-'}</b>
          <span>total</span>
        </div>
        <div className={counts.changed ? 'is-change' : undefined}>
          <b>{data ? counts.changed : '-'}</b>
          <span>updated</span>
        </div>
      </div>

      <CreateForm
        onCreated={(c) => {
          setCreated(c);
          void reload();
        }}
      />
      {created && <CreatedList created={created} onDismiss={() => setCreated(null)} />}

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Filter links">
          {(
            [
              ['active', 'Active'],
              ['expired', 'Expired'],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button key={k} role="tab" className="tab" aria-selected={!q && filter === k} onClick={() => { setQuery(''); setFilter(k); }}>
              {label}
              <span className="count">{counts[k]}</span>
            </button>
          ))}
        </div>
        <SearchBox value={query} onChange={setQuery} onOpen={(t) => navigate(`/${t}/recruiter`)} onEnter={() => rows[0] && navigate(`/${rows[0].token}/recruiter`)} />
      </div>

      <div className="table-wrap">
        {error ? (
          <div className="empty" role="alert">
            <p>{error}</p>
            <button className="btn" onClick={reload}>
              Try again
            </button>
          </div>
        ) : !data ? (
          <SkeletonRows />
        ) : rows.length === 0 ? (
          <div className="empty">
            <h2>{data.total === 0 ? 'No links yet' : q ? 'No links match' : 'Nothing here'}</h2>
            {data.total === 0 && <p>Create one above.</p>}
          </div>
        ) : (
          <table className="links">
            <thead>
              <tr>
                <th scope="col">Link</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Open time
                </th>
                <th scope="col">Last change</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <Row key={l.token} l={l} batch={l.batch_id ? batchSize.get(l.batch_id) : undefined} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Row({ l, batch }: { l: LinkRow; batch?: number }) {
  const hours = l.slot_count / 4;
  const expiresIn = Date.parse(l.expires_at) - Date.now();
  const name = l.label || 'Untitled link';
  return (
    <tr className={l.is_active && l.has_unseen_change ? 'is-change' : undefined}>
      <td>
        <div className="who">
          <Link to={`/${l.token}/recruiter`}>{name}</Link>
          <small className="mono">{l.token}</small>
        </div>
      </td>
      <td data-label="Status">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {!l.is_active ? (
            <span className="tag">Expired</span>
          ) : (
            <>
              {l.has_unseen_change && <span className="tag tag-change">New update</span>}
              {l.slot_count === 0 && <span className="tag">Candidate hasn't replied</span>}
              {expiresIn < EXPIRING_SOON_MS && <span className="tag tag-warn">Expiring soon</span>}
            </>
          )}
          {batch && batch > 1 && <span className="tag">Batch of {batch}</span>}
        </div>
      </td>
      <td className="num" data-label="Open time:">
        {hours > 0 ? `${hours % 1 ? hours.toFixed(1) : hours} h` : <span className="muted">-</span>}
      </td>
      <td data-label="Changed" title={new Date(l.updated_at).toLocaleString()}>
        <span className="muted">{relative(l.updated_at)}</span>
      </td>
      <td className="actions-cell">
        <div className="actions">
          <CopyButton
            text={candidateUrl(l.token)}
            className="btn btn-sm btn-quiet"
            ariaLabel={`Copy candidate link for ${name}`}
            doneLabel="Copied"
          >
            Copy link
          </CopyButton>
        </div>
      </td>
    </tr>
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
  const [count, setCount] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 25) {
      setError('Enter 1 to 25.');
      return;
    }
    setBusy(true);
    setError(null);
    const trimmed = label.trim();
    const labels = Array.from({ length: n }, (_, i) => (trimmed ? (n > 1 ? `${trimmed} ${i + 1}` : trimmed) : ''));
    try {
      const res = await call((p) => api.managerCreate(p, n, labels));
      onCreated(res);
      setLabel('');
      setCount('1');
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'bad_passcode')) setError('Not created. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel panel-pad" onSubmit={submit} noValidate aria-label="Create links">
      <div className="create">
        <div className="field">
          <label htmlFor="new-label">Label</label>
          <input
            id="new-label"
            className="input"
            value={label}
            maxLength={120}
            placeholder="Name or role (only you see it)"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-count">Links</label>
          <input
            id="new-count"
            className="input"
            inputMode="numeric"
            value={count}
            aria-invalid={!!error}
            onChange={(e) => setCount(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          <Plus size={16} weight="bold" aria-hidden />
          {busy ? 'Creating...' : Number(count) > 1 ? 'Create links' : 'Create link'}
        </button>
      </div>
      {error && (
        <p className="error" role="alert" style={{ marginTop: 6 }}>
          {error}
        </p>
      )}
    </form>
  );
}

function CreatedList({ created, onDismiss }: { created: CreatedLinks; onDismiss: () => void }) {
  const all = created.links.map((l) => `${l.label ? l.label + ': ' : ''}${candidateUrl(l.token)}`).join('\n');
  return (
    <section className="panel panel-pad" style={{ marginTop: 12 }} aria-label="New links" role="status">
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
      className="open-form"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onEnter();
      }}
    >
      <label htmlFor="link-search" className="sr-only">
        Search links by label, or paste a link to open it
      </label>
      <input
        id="link-search"
        type="search"
        className="input"
        placeholder="Search by label, or paste a link"
        autoComplete="off"
        value={value}
        onChange={(e) => change(e.target.value)}
      />
    </form>
  );
}
