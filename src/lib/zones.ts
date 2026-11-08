// Time zone list and fuzzy search.
//
// The list comes from the browser's own IANA database and is refreshed once a day from a free,
// key-less time zone API (worldtimeapi.org, then timeapi.io). If the API is down or blocked the
// app keeps working from the browser's list: the API only adds names the browser might not know.
// Offsets and daylight saving are always computed by the browser, never taken from the API.

import { COMMON_ZONES, allZones, browserZone, cityOf, gmtLabel, isFriendlyZone, tzLabel, tzOffsetMinutes, zoneName } from './time';

const CACHE_KEY = 'quickslot-zones-v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCES = ['https://worldtimeapi.org/api/timezone', 'https://timeapi.io/api/timezone/availabletimezones'];

interface Cache {
  at: number;
  zones: string[];
}

function isValidZone(z: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cache;
    return Array.isArray(c.zones) ? c : null;
  } catch {
    return null;
  }
}

/** Every zone we know about: the browser's list plus anything the daily refresh added. */
export function knownZones(): string[] {
  const extra = readCache()?.zones ?? [];
  return [...new Set([...allZones(), ...extra])];
}

/** Fetches a fresh list if the cached one is older than a day. Safe to call often; never throws. */
export async function refreshZonesIfStale(): Promise<boolean> {
  const cached = readCache();
  if (cached && Date.now() - cached.at < DAY_MS) return false;
  for (const url of SOURCES) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data: unknown = await res.json();
      if (!Array.isArray(data)) continue;
      const zones = data.filter((z): z is string => typeof z === 'string' && z.length < 64 && isValidZone(z));
      if (zones.length < 100) continue; // an obviously partial answer is not worth keeping
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), zones } satisfies Cache));
      return true;
    } catch {
      /* try the next source */
    }
  }
  // Remember the attempt so a blocked network is not retried on every page view.
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now() - DAY_MS + 60 * 60 * 1000, zones: cached?.zones ?? [] } satisfies Cache));
  } catch {
    /* ignore */
  }
  return false;
}

// ------------------------------------------------------------ city lookup
// The browser only knows ~400 reference cities. When nothing local matches what was typed, ask a
// free, key-less geocoding service (Open-Meteo) which time zone that city is in. Only the typed
// text is sent. The zone it returns is checked against the browser's own database before use.
const lookupCache = new Map<string, ZoneOption[]>();

interface GeoResult {
  name?: string;
  admin1?: string;
  country?: string;
  timezone?: string;
}

export async function lookupCity(query: string, signal?: AbortSignal): Promise<ZoneOption[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const key = norm(q);
  const hit = lookupCache.get(key);
  if (hit) return hit;
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('lookup failed');
  const data = (await res.json()) as { results?: GeoResult[] };
  const seen = new Set<string>();
  const out: ZoneOption[] = [];
  for (const r of data.results ?? []) {
    if (!r.name || !r.timezone || !isValidZone(r.timezone)) continue;
    const place = [r.name, r.admin1, r.country].filter((p, i, a) => p && a.indexOf(p) === i).join(', ');
    const label = `${place} (${gmtLabel(r.timezone)})`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ tz: r.timezone, label });
    if (out.length >= 6) break;
  }
  lookupCache.set(key, out);
  return out;
}

// ------------------------------------------------------------------ search
// People type what they know: a city, "EST", "pacific", "brasil", "gmt-3". Accept all of it.
const ALIASES: Record<string, string[]> = {
  'America/New_York': ['est', 'edt', 'et', 'eastern', 'new york', 'nyc', 'boston', 'miami', 'atlanta', 'washington', 'usa', 'us', 'united states'],
  'America/Chicago': ['cst', 'cdt', 'ct', 'central', 'chicago', 'dallas', 'houston', 'austin', 'texas', 'usa', 'us', 'united states'],
  'America/Denver': ['mst', 'mdt', 'mt', 'mountain', 'denver', 'salt lake', 'usa', 'us', 'united states'],
  'America/Los_Angeles': ['pst', 'pdt', 'pt', 'pacific', 'los angeles', 'la', 'san francisco', 'sf', 'seattle', 'california', 'usa', 'us', 'united states'],
  'America/Phoenix': ['arizona', 'phoenix', 'usa', 'us'],
  'America/Anchorage': ['akst', 'akdt', 'alaska'],
  'Pacific/Honolulu': ['hst', 'hawaii', 'honolulu'],
  'America/Toronto': ['canada', 'ontario', 'et'],
  'America/Vancouver': ['canada', 'british columbia', 'bc', 'pt'],
  'America/Halifax': ['ast', 'atlantic', 'canada', 'nova scotia'],
  'America/Sao_Paulo': ['brt', 'brasilia', 'brazil', 'brasil', 'sao paulo', 'rio', 'rio de janeiro', 'belo horizonte', 'curitiba', 'porto alegre'],
  'America/Mexico_City': ['mexico', 'cdmx'],
  'America/Bogota': ['colombia'],
  'America/Lima': ['peru'],
  'America/Santiago': ['chile'],
  'America/Argentina/Buenos_Aires': ['argentina', 'art'],
  'Europe/London': ['gmt', 'bst', 'uk', 'united kingdom', 'england', 'britain', 'scotland'],
  'Europe/Dublin': ['ireland'],
  'Europe/Lisbon': ['portugal', 'wet'],
  'Europe/Berlin': ['cet', 'cest', 'germany', 'central europe', 'munich'],
  'Europe/Paris': ['cet', 'cest', 'france', 'central europe'],
  'Europe/Madrid': ['cet', 'cest', 'spain', 'espana', 'barcelona'],
  'Europe/Amsterdam': ['cet', 'netherlands', 'holland'],
  'Europe/Rome': ['cet', 'italy', 'italia'],
  'Europe/Athens': ['eet', 'eest', 'greece'],
  'Europe/Istanbul': ['turkey', 'turkiye'],
  'Europe/Moscow': ['msk', 'russia'],
  'Africa/Lagos': ['wat', 'nigeria'],
  'Africa/Cairo': ['egypt'],
  'Africa/Johannesburg': ['sast', 'south africa'],
  'Africa/Nairobi': ['eat', 'kenya'],
  'Asia/Dubai': ['gst', 'uae', 'emirates'],
  'Asia/Kolkata': ['ist', 'india', 'mumbai', 'delhi', 'bangalore', 'bengaluru', 'chennai', 'hyderabad', 'calcutta'],
  'Asia/Calcutta': ['ist', 'india', 'mumbai', 'delhi', 'bangalore', 'kolkata'],
  'Asia/Karachi': ['pkt', 'pakistan'],
  'Asia/Dhaka': ['bangladesh'],
  'Asia/Bangkok': ['thailand'],
  'Asia/Singapore': ['sgt'],
  'Asia/Hong_Kong': ['hkt'],
  'Asia/Shanghai': ['china', 'beijing', 'cst'],
  'Asia/Manila': ['philippines', 'pht'],
  'Asia/Tokyo': ['jst', 'japan'],
  'Asia/Seoul': ['kst', 'korea', 'south korea'],
  'Australia/Sydney': ['aest', 'aedt', 'australia', 'melbourne', 'canberra'],
  'Australia/Perth': ['awst', 'australia'],
  'Pacific/Auckland': ['nzst', 'nzdt', 'nz', 'new zealand'],
  UTC: ['utc', 'gmt', 'zulu', 'universal'],
};

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_/,()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export interface ZoneOption {
  tz: string;
  label: string;
}

interface Entry {
  tz: string;
  label: string;
  names: string[]; // searchable names, normalized
  aliases: string[];
  common: boolean;
}

let indexCache: { key: string; entries: Entry[] } | null = null;

function buildIndex(): Entry[] {
  const zones = knownZones();
  const key = String(zones.length);
  if (indexCache?.key === key) return indexCache.entries;
  const entries = zones.map((tz): Entry => {
    const label = tzLabel(tz);
    return {
      tz,
      label,
      // names people would type: the friendly name and the city. Region words like 'pacific' belong to aliases.
      names: [norm(zoneName(tz)), norm(cityOf(tz))],
      aliases: (ALIASES[tz] ?? []).map(norm),
      common: isFriendlyZone(tz),
    };
  });
  indexCache = { key, entries };
  return entries;
}

/** "gmt-3", "utc+5:30", "+5", "-3" -> minutes, or null if the text is not an offset. */
function parseOffset(q: string): number | null {
  const m = q.replace(/\s+/g, '').toLowerCase().match(/^(?:gmt|utc)?([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -mins : mins;
}

/** The first things shown before anyone types: this device's zone, then the most used zones. */
export function suggestedZones(limit = 8): ZoneOption[] {
  const br = browserZone();
  const list = [br, ...COMMON_ZONES.map(([z]) => z).filter((z) => z !== br)].slice(0, limit);
  return list.map((tz) => ({ tz, label: tzLabel(tz) }));
}

export function searchZones(query: string, limit = 8): ZoneOption[] {
  const q = norm(query);
  if (!q) return suggestedZones(limit);
  const off = parseOffset(query);
  const now = Date.now();
  const scored: { e: Entry; score: number }[] = [];
  for (const e of buildIndex()) {
    let score = 0;
    if (off !== null) {
      if (tzOffsetMinutes(now, e.tz) === off) score = e.common ? 60 : 30;
    } else {
      for (const n of e.names) {
        if (n === q) score = Math.max(score, 100);
        else if (n.startsWith(q)) score = Math.max(score, 80);
        else if (n.split(' ').some((w) => w.startsWith(q))) score = Math.max(score, 60);
        else if (q.length >= 4 && n.includes(q)) score = Math.max(score, 40);
      }
      for (const a of e.aliases) {
        if (a === q) score = Math.max(score, 95);
        else if (a.startsWith(q)) score = Math.max(score, 70);
      }
    }
    if (score > 0) scored.push({ e, score: score + (e.common ? 10 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.e.label.localeCompare(b.e.label));
  // Calcutta and Kolkata are the same place; show it once.
  const seen = new Set<string>();
  const out: ZoneOption[] = [];
  for (const { e } of scored) {
    const dedupe = `${e.label}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ tz: e.tz, label: e.label });
    if (out.length >= limit) break;
  }
  return out;
}
