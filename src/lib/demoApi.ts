// Demo backend: the same behavior as supabase/schema.sql, kept in this browser's localStorage.
// Used only when no Supabase keys are configured. Nothing leaves the browser.
import {
  ApiError,
  type Api,
  type CandidateResult,
  type ManagerLinkData,
  type ManagerLinkResult,
  type Overview,
  type SuggestedSlot,
} from './types';
import { SLOT_MS, zonedToUtc, addDays, todayIn, mondayOf, calDiffDays } from './time';

export const DEMO_PASSCODE = 'demo-passcode';
const KEY = 'quickslot-demo-v3';
const DAY = 86400000;

interface Row {
  token: string;
  batch_id: string | null;
  label: string;
  created_at: string;
  expires_at: string;
  updated_at: string;
  /** last change by the candidate; older stored rows fall back to updated_at */
  candidate_updated_at?: string;
  recruiter_viewed_at: string | null;
  active: boolean;
  timezone: string;
  slots: string[];
  suggested_slots: SuggestedSlot[];
  suggested_slots_timezone: string | null;
  ranked_choices: string[];
}

interface Store {
  rows: Row[];
}

const hex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

function seed(): Store {
  const now = Date.now();
  const tz = 'America/New_York';
  const t0 = todayIn(tz);
  const at = (dayOffset: number, h: number, m = 0) => {
    const c = addDays(t0, dayOffset);
    return zonedToUtc(c.y, c.m, c.d, h, m, tz);
  };
  const run = (dayOffset: number, from: number, to: number) => {
    const out: string[] = [];
    for (let t = at(dayOffset, Math.floor(from), (from % 1) * 60); t < at(dayOffset, Math.floor(to), (to % 1) * 60); t += SLOT_MS)
      out.push(new Date(t).toISOString());
    return out;
  };
  const mk = (label: string, extra: Partial<Row>): Row => ({
    token: hex(8),
    batch_id: null,
    label,
    created_at: new Date(now - 3 * DAY).toISOString(),
    expires_at: new Date(now + 87 * DAY).toISOString(),
    updated_at: new Date(now - 3 * DAY).toISOString(),
    recruiter_viewed_at: null,
    active: true,
    timezone: tz,
    slots: [],
    suggested_slots: [],
    suggested_slots_timezone: null,
    ranked_choices: [],
    ...extra,
  });
  const bid = crypto.randomUUID();
  // nth weekday from today, so sample data never lands on a weekend
  const wd = (n: number) => {
    let d = 0;
    for (let k = 0; k < n; ) {
      d++;
      const c = addDays(t0, d);
      const dow = new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay();
      if (dow !== 0 && dow !== 6) k++;
    }
    return d;
  };
  const sg = [1, 2, 3].map((n) => ({ start: new Date(at(wd(n), 10)).toISOString(), minutes: 45 }));
  // Days inside the dashboard's "this week" window (see weekWindow), so each status shows in the demo.
  const mon = mondayOf(t0);
  const dow = new Date(Date.UTC(t0.y, t0.m - 1, t0.d)).getUTCDay();
  const winMon = dow === 0 || dow === 6 ? addDays(mon, 7) : mon;
  const fri = calDiffDays(t0, addDays(winMon, 4));
  const nextMon = calDiffDays(t0, addDays(winMon, 7));
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const seenAt = ago(60e3);
  return {
    rows: [
      // New update: candidate answered, recruiter has not opened it
      mk('Sample: Priya Raman, Product Designer', {
        updated_at: ago(2 * 3600e3),
        slots: [...run(wd(1), 9, 12), ...run(wd(2), 13, 16.5), ...run(wd(4), 10, 11.5)],
        timezone: 'Asia/Kolkata',
      }),
      mk('Sample: Jun Park, QA Lead', {
        updated_at: ago(5 * 60e3),
        slots: run(fri, 13, 15),
        timezone: 'Asia/Seoul',
      }),
      // Up to date / Few / No valid times: answered and seen
      mk('Sample: Omar Haddad, Staff Engineer', {
        updated_at: ago(26 * 3600e3),
        recruiter_viewed_at: seenAt,
        slots: run(fri, 13, 16.5),
      }),
      mk('Sample: Lena Fischer, Analyst', {
        updated_at: ago(2 * DAY),
        recruiter_viewed_at: seenAt,
        slots: run(fri, 14, 15),
      }),
      mk('Sample: Chidi Okafor, Support Manager', {
        updated_at: ago(4 * DAY),
        recruiter_viewed_at: seenAt,
        slots: run(nextMon, 10, 12),
      }),
      // Waiting for picks / availability: candidate never answered
      mk('Sample: link not opened yet', { created_at: ago(6 * 3600e3), updated_at: ago(6 * 3600e3) }),
      mk('Sample: Maya Cohen, Designer', {
        created_at: ago(2 * DAY),
        updated_at: ago(2 * DAY),
        suggested_slots: sg,
        suggested_slots_timezone: tz,
      }),
      // a batch of three
      mk('2146 - Sales Director 1', {
        batch_id: bid,
        updated_at: ago(26 * 3600e3),
        recruiter_viewed_at: seenAt,
        slots: run(fri, 9, 12),
        suggested_slots: sg,
        suggested_slots_timezone: tz,
        ranked_choices: [sg[1].start, sg[0].start],
      }),
      mk('2146 - Sales Director 2', {
        batch_id: bid,
        created_at: ago(3 * DAY),
        updated_at: ago(3 * DAY),
        suggested_slots: sg,
        suggested_slots_timezone: tz,
      }),
      mk('2146 - Sales Director 3', {
        batch_id: bid,
        created_at: ago(3 * DAY),
        updated_at: ago(3 * DAY),
      }),
    ],
  };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* fall through */
  }
  const s = seed();
  save(s);
  return s;
}
function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: demo data is then per-session only */
  }
}

const clean = (xs: string[]): string[] => {
  const now = Date.now();
  const set = new Set<number>();
  for (const x of xs) {
    const t = Date.parse(x);
    if (Number.isFinite(t) && (t / 1000) % 900 === 0 && t >= now + 150 * 60000 && t < now + 60 * DAY) set.add(t);
  }
  return [...set].sort((a, b) => a - b).slice(0, 2000).map((t) => new Date(t).toISOString());
};

/** Same as _prune_past() in schema.sql: past suggested times (and picks of them) are deleted, silently. */
function prune(s: Store) {
  const now = Date.now();
  let changed = false;
  for (const r of s.rows) {
    const sg = r.suggested_slots.filter((x) => Date.parse(x.start) > now);
    const rk = r.ranked_choices.filter((x) => Date.parse(x) > now);
    if (sg.length !== r.suggested_slots.length || rk.length !== r.ranked_choices.length) {
      r.suggested_slots = sg;
      r.ranked_choices = rk;
      changed = true;
    }
  }
  if (changed) save(s);
}

const live = (r: Row) => r.active && Date.parse(r.expires_at) > Date.now();
const needPass = (p: string) => {
  if (p !== DEMO_PASSCODE) throw new ApiError('bad_passcode');
};
const delay = <T,>(v: T): Promise<T> => new Promise((res) => setTimeout(() => res(v), 120));

export function createDemoApi(): Api {
  const find = (s: Store, token: string) => s.rows.find((r) => r.token === token.trim().toLowerCase());

  return {
    mode: 'demo',
    async getLink(token) {
      const s0 = load();
      prune(s0);
      const r = find(s0, token);
      if (!r) return delay({ status: 'not_found' } as CandidateResult);
      if (!live(r)) return delay({ status: 'expired' } as CandidateResult);
      return delay({
        status: 'ok',
        token: r.token,
        timezone: r.timezone,
        slots: r.slots,
        suggested_slots: r.suggested_slots,
        suggested_slots_timezone: r.suggested_slots_timezone,
        ranked_choices: r.ranked_choices,
        updated_at: r.updated_at,
        expires_at: r.expires_at,
      } as CandidateResult);
    },
    async setAvailability(token, slots, timezone) {
      const s = load();
      const r = find(s, token);
      if (!r || !live(r)) throw new ApiError('link_unavailable');
      r.slots = clean(slots);
      r.timezone = timezone;
      r.updated_at = r.candidate_updated_at = new Date().toISOString();
      save(s);
      return delay(r.updated_at);
    },
    async setRanked(token, choices) {
      const s = load();
      const r = find(s, token);
      if (!r || !live(r)) throw new ApiError('link_unavailable');
      const allowed = new Set(r.suggested_slots.map((x) => Date.parse(x.start)));
      r.ranked_choices = choices.filter((c) => allowed.has(Date.parse(c)));
      r.updated_at = r.candidate_updated_at = new Date().toISOString();
      save(s);
      return delay(r.updated_at);
    },
    async managerCheck(p) {
      needPass(p);
      await delay(0);
    },
    async managerOverview(p): Promise<Overview> {
      needPass(p);
      const s = load();
      prune(s);
      const links = s.rows
        .map((r) => ({
          token: r.token,
          label: r.label,
          batch_id: r.batch_id,
          created_at: r.created_at,
          expires_at: r.expires_at,
          updated_at: r.updated_at,
          is_active: live(r),
          slot_count: r.slots.length,
          next_slot: r.slots.map((x) => Date.parse(x)).filter((t) => t > Date.now()).sort((a, b) => a - b).map((t) => new Date(t).toISOString())[0] ?? null,
          has_unseen_change:
            Date.parse(r.candidate_updated_at ?? r.updated_at) > (r.recruiter_viewed_at ? Date.parse(r.recruiter_viewed_at) : -Infinity) &&
            r.slots.length + r.ranked_choices.length > 0,
          suggested_count: r.suggested_slots.length,
          ranked_count: r.ranked_choices.length,
          timezone: r.timezone,
          // same conditions as supabase/schema.sql: active, answered, already seen; next 8 days only
          ...(() => {
            const now = Date.now();
            const seen =
              live(r) &&
              r.slots.length + r.ranked_choices.length > 0 &&
              Date.parse(r.candidate_updated_at ?? r.updated_at) <= (r.recruiter_viewed_at ? Date.parse(r.recruiter_viewed_at) : -Infinity);
            const inWin = (iso: string) => Date.parse(iso) > now && Date.parse(iso) < now + 8 * DAY;
            return {
              upcoming_slots: seen ? r.slots.filter(inWin).sort() : [],
              upcoming_picks: seen ? r.suggested_slots.filter((x) => r.ranked_choices.includes(x.start) && inWin(x.start)) : [],
            };
          })(),
        }))
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
      return delay({ active: links.filter((l) => l.is_active).length, total: links.length, links });
    },
    async managerCreate(p, count, labels) {
      needPass(p);
      const n = Math.min(Math.max(count || 1, 1), 25);
      const s = load();
      const bid = n > 1 ? crypto.randomUUID() : null;
      const out = [];
      for (let i = 0; i < n; i++) {
        const now = Date.now();
        const label = (labels[i] ?? '').slice(0, 120);
        const row: Row = {
          token: hex(8),
          batch_id: bid,
          label,
          created_at: new Date(now).toISOString(),
          expires_at: new Date(now + 90 * DAY).toISOString(),
          updated_at: new Date(now).toISOString(),
          recruiter_viewed_at: null,
          active: true,
          timezone: 'UTC',
          slots: [],
          suggested_slots: [],
          suggested_slots_timezone: null,
          ranked_choices: [],
        };
        s.rows.push(row);
        out.push({ token: row.token, label });
      }
      save(s);
      return delay({ batch_id: bid, links: out });
    },
    async managerGetLink(p, token, markSeen): Promise<ManagerLinkResult> {
      needPass(p);
      const s = load();
      prune(s);
      const r = find(s, token);
      if (!r) return delay({ status: 'not_found' });
      if (markSeen) {
        r.recruiter_viewed_at = new Date().toISOString();
        save(s);
      }
      const data: ManagerLinkData = {
        status: live(r) ? 'ok' : 'expired',
        token: r.token,
        label: r.label,
        batch_id: r.batch_id,
        batch: r.batch_id ? s.rows.filter((m) => m.batch_id === r.batch_id).map((m) => ({ token: m.token, label: m.label })) : [],
        timezone: r.timezone,
        slots: r.slots,
        suggested_slots: r.suggested_slots,
        suggested_slots_timezone: r.suggested_slots_timezone,
        ranked_choices: r.ranked_choices,
        created_at: r.created_at,
        updated_at: r.updated_at,
        expires_at: r.expires_at,
      };
      return delay(data);
    },
    async managerSetLabel(p, token, label) {
      needPass(p);
      const s = load();
      const r = find(s, token);
      if (r) r.label = label.slice(0, 120);
      save(s);
      await delay(0);
    },
    async managerSetSuggestions(p, tokens, slots, timezone) {
      needPass(p);
      const s = load();
      const cleaned = [...new Map(slots.map((x) => [x.start, x])).values()]
        .filter((x) => (Date.parse(x.start) / 1000) % 900 === 0 && Date.parse(x.start) > Date.now())
        .map((x) => ({ start: new Date(x.start).toISOString(), minutes: Math.min(Math.max(x.minutes || 30, 15), 240) }))
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
        .slice(0, 60);
      let n = 0;
      for (const r of s.rows) {
        if (!tokens.includes(r.token)) continue;
        r.suggested_slots = cleaned;
        r.suggested_slots_timezone = timezone;
        const keep = new Set(cleaned.map((x) => Date.parse(x.start)));
        r.ranked_choices = r.ranked_choices.filter((c) => keep.has(Date.parse(c)));
        r.updated_at = new Date().toISOString();
        n++;
      }
      save(s);
      return delay(n);
    },
    async managerDeactivate(p, token, whole) {
      needPass(p);
      const s = load();
      const base = find(s, token);
      let n = 0;
      for (const r of s.rows) {
        if (r.token === base?.token || (whole && base?.batch_id && r.batch_id === base.batch_id)) {
          r.active = false;
          n++;
        }
      }
      save(s);
      return delay(n);
    },
  };
}
