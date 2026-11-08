import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const schema = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); };
const rejects = async (name, fn, msg) => {
  try { await fn(); ok(name, false, 'did not throw'); }
  catch (e) { ok(name, !msg || String(e.message).includes(msg), e.message); }
};

// Supabase has these roles; create them so the grants run.
await db.exec(`create role anon nologin; create role authenticated nologin;`);
await db.exec(schema);
await db.query(`select public.set_manager_passcode('correct horse battery')`);

const PW = 'correct horse battery';
const q = async (sql, params) => (await db.query(sql, params)).rows;

// passcode
ok('wrong passcode returns error', (await q(`select public.manager_check($1) as v`, ['nope']))[0].v.error === 'bad_passcode');
ok('right passcode accepted', (await q(`select public.manager_check($1) as v`, [PW]))[0].v.ok === true);
await rejects('short passcode refused on set', () => q(`select public.set_manager_passcode('short')`), 'at least 10');

// create
const one = (await q(`select public.manager_create_links($1, 1, array['Maya Okafor, Staff Designer']) as r`, [PW]))[0].r;
ok('single link created', one.links.length === 1 && one.batch_id === null);
const tokA = one.links[0].token;
ok('token is 16 hex', /^[0-9a-f]{16}$/.test(tokA));
const many = (await q(`select public.manager_create_links($1, 3, '{}') as r`, [PW]))[0].r;
ok('batch of 3 created with batch id', many.links.length === 3 && !!many.batch_id);
const capped = (await q(`select public.manager_create_links($1, 999, '{}') as r`, [PW]))[0].r;
ok('batch capped at 25', capped.links.length === 25);

// candidate API: never sees the label
let g = (await q(`select public.get_link($1) as r`, [tokA]))[0].r;
ok('candidate get_link ok', g.status === 'ok');
ok('candidate response has no label', !('label' in g) && !JSON.stringify(g).includes('Maya'));
ok('unknown token not_found', (await q(`select public.get_link('0000000000000000') as r`))[0].r.status === 'not_found');

// availability
const base = new Date(); base.setUTCDate(base.getUTCDate() + 3); base.setUTCHours(15, 0, 0, 0);
const iso = (m) => new Date(base.getTime() + m * 60000).toISOString();
const slots = [iso(0), iso(30), iso(60), iso(30) /* dup */, iso(7) /* misaligned */];
await q(`select public.set_availability($1, $2::timestamptz[], 'America/New_York')`, [tokA, slots]);
g = (await q(`select public.get_link($1) as r`, [tokA]))[0].r;
ok('slots saved, deduped, misaligned dropped', g.slots.length === 3, JSON.stringify(g.slots));
ok('timezone saved', g.timezone === 'America/New_York');
await rejects('bad timezone refused', () => q(`select public.set_availability($1, '{}', 'Mars/Base')`, [tokA]), 'bad_timezone');
await q(`select public.set_availability($1, $2::timestamptz[], 'UTC')`, [tokA, [new Date(Date.now() - 10 * 86400e3).toISOString().replace(/\d\d:\d\d:\d\d/, '00:00:00')]]);
ok('past/out-of-window slots dropped', (await q(`select public.get_link($1) as r`, [tokA]))[0].r.slots.length === 0);
{
  // too-soon slots are refused: 1 hour ahead dropped, 4 hours ahead kept
  const aligned = (ms) => new Date(Math.ceil(ms / 900000) * 900000).toISOString();
  await q(`select public.set_availability($1, $2::timestamptz[], 'UTC')`, [tokA, [aligned(Date.now() + 3600e3), aligned(Date.now() + 4 * 3600e3)]]);
  const kept = (await q(`select public.get_link($1) as r`, [tokA]))[0].r.slots;
  ok('slot 1 hour away dropped, 4 hours away kept', kept.length === 1, JSON.stringify(kept));
}
await q(`select public.set_availability($1, $2::timestamptz[], 'America/New_York')`, [tokA, slots]);

// overview + unseen change flag
let ov = (await q(`select public.manager_overview($1) as r`, [PW]))[0].r;
const row = ov.links.find((l) => l.token === tokA);
ok('overview counts', ov.total === 29 && ov.active === 29, JSON.stringify([ov.total, ov.active]));
ok('overview shows label and slot count', row.label.startsWith('Maya') && row.slot_count === 3);
ok('unseen change flagged', row.has_unseen_change === true);
await q(`select public.manager_get_link($1, $2, true)`, [PW, tokA]);
ov = (await q(`select public.manager_overview($1) as r`, [PW]))[0].r;
ok('opening link clears unseen flag', ov.links.find((l) => l.token === tokA).has_unseen_change === false);
await q(`select public.set_availability($1, $2::timestamptz[], 'America/New_York')`, [tokA, [iso(0)]]);
ov = (await q(`select public.manager_overview($1) as r`, [PW]))[0].r;
ok('new candidate edit re-flags', ov.links.find((l) => l.token === tokA).has_unseen_change === true);

// overview: upcoming times only for active, answered, seen links
{
  const row2 = (await q(`select public.manager_overview($1) as r`, [PW]))[0].r.links.find((l) => l.token === tokA);
  ok('upcoming_slots empty while change unseen', row2.has_unseen_change && row2.upcoming_slots.length === 0);
  await q(`select public.manager_get_link($1, $2, true)`, [PW, tokA]);
  const row3 = (await q(`select public.manager_overview($1) as r`, [PW]))[0].r.links.find((l) => l.token === tokA);
  ok('upcoming_slots filled once seen, within 8 days', Array.isArray(row3.upcoming_slots) && row3.upcoming_slots.every((t) => Date.parse(t) < Date.now() + 8 * 86400e3 && Date.parse(t) > Date.now()), JSON.stringify(row3.upcoming_slots));
  ok('upcoming_picks is an array', Array.isArray(row3.upcoming_picks));
}

// past suggested times are removed automatically and never shown
{
  const past = new Date(Date.now() - 3600e3).toISOString();
  const future = new Date(Math.ceil((Date.now() + 5 * 86400e3) / 900000) * 900000).toISOString();
  const tok = (await q(`select public.manager_create_links($1, 1, '{}') as r`, [PW]))[0].r.links[0].token;
  await q(`update public.links set suggested_slots = $2::jsonb, ranked_choices = $3::timestamptz[], updated_at = '2020-01-01' where token = $1`,
    [tok, JSON.stringify([{ start: past, minutes: 30 }, { start: future, minutes: 30 }]), [past, future]]);
  const cg = (await q(`select public.get_link($1) as r`, [tok]))[0].r;
  ok('candidate no longer sees past suggestions', cg.suggested_slots.length === 1 && new Date(cg.suggested_slots[0].start).getTime() === new Date(future).getTime(), JSON.stringify(cg.suggested_slots));
  ok('past ranked pick removed too', cg.ranked_choices.length === 1);
  ok('cleanup does not count as a candidate update', new Date(cg.updated_at).getUTCFullYear() === 2020, cg.updated_at);
  await q(`update public.links set suggested_slots = $2::jsonb where token = $1`, [tok, JSON.stringify([{ start: past, minutes: 30 }])]);
  const mg = (await q(`select public.manager_get_link($1, $2, false) as r`, [PW, tok]))[0].r;
  ok('recruiter view prunes past suggestions', mg.suggested_slots.length === 0);
  await q(`update public.links set suggested_slots = $2::jsonb where token = $1`, [tok, JSON.stringify([{ start: past, minutes: 30 }])]);
  await q(`select public._prune_past()`);
  ok('scheduled prune deletes past suggestions', (await q(`select jsonb_array_length(suggested_slots) as n from public.links where token = $1`, [tok]))[0].n === 0);
  await q(`select public.manager_set_suggestions($1, array[$2]::text[], $3::jsonb, 'UTC')`, [PW, tok, JSON.stringify([{ start: past, minutes: 30 }])]);
  ok('cannot suggest a time in the past', (await q(`select jsonb_array_length(suggested_slots) as n from public.links where token = $1`, [tok]))[0].n === 0);
  const clearTok = (await q(`select public.manager_create_links($1, 1, '{}') as r`, [PW]))[0].r.links[0].token;
  await q(`select public.manager_set_suggestions($1, array[$2]::text[], $3::jsonb, 'UTC')`, [PW, clearTok, JSON.stringify([{ start: future, minutes: 30 }])]);
  await q(`select public.manager_set_suggestions($1, array[$2]::text[], '[]'::jsonb, 'UTC')`, [PW, clearTok]);
  ok('clearing all suggestions works', (await q(`select jsonb_array_length(suggested_slots) as n from public.links where token = $1`, [clearTok]))[0].n === 0);
}

// suggestions + batch edit + ranking
const batchToks = many.links.map((l) => l.token);
const sugg = JSON.stringify([{ start: iso(24 * 60), minutes: 45 }, { start: iso(24 * 60 + 60), minutes: 30 }, { start: iso(5) }]);
const n = (await q(`select public.manager_set_suggestions($1, $2::text[], $3::jsonb, 'America/Los_Angeles') as n`, [PW, batchToks, sugg]))[0].n.changed;
ok('suggestions applied to whole batch', n === 3);
const bg = (await q(`select public.get_link($1) as r`, [batchToks[0]]))[0].r;
ok('suggestions: misaligned dropped, minutes kept', bg.suggested_slots.length === 2 && bg.suggested_slots[0].minutes === 45, JSON.stringify(bg.suggested_slots));
ok('suggestions zone stored', bg.suggested_slots_timezone === 'America/Los_Angeles');
const pick = bg.suggested_slots.map((s) => s.start);
await q(`select public.set_ranked_choices($1, $2::timestamptz[])`, [batchToks[0], [pick[1], pick[0], iso(999)]]);
const rg = (await q(`select public.get_link($1) as r`, [batchToks[0]]))[0].r;
ok('ranking keeps order and drops non-suggested', rg.ranked_choices.length === 2 && new Date(rg.ranked_choices[0]).getTime() === new Date(pick[1]).getTime(), JSON.stringify(rg.ranked_choices));
await q(`select public.manager_set_suggestions($1, $2::text[], $3::jsonb, 'UTC')`, [PW, [batchToks[0]], JSON.stringify([{ start: pick[0], minutes: 30 }])]);
const rg2 = (await q(`select public.get_link($1) as r`, [batchToks[0]]))[0].r;
ok('changing suggestions prunes stale ranked picks', rg2.ranked_choices.length === 1);
const mg = (await q(`select public.manager_get_link($1, $2) as r`, [PW, batchToks[1]]))[0].r;
ok('manager sees batch mates', mg.batch.length === 3);

// labels, deactivate
await q(`select public.manager_set_label($1, $2, 'Renamed')`, [PW, tokA]);
ok('label updated', (await q(`select public.manager_get_link($1, $2, false) as r`, [PW, tokA]))[0].r.label === 'Renamed');
ok('deactivate one', (await q(`select public.manager_deactivate($1, $2, false) as n`, [PW, tokA]))[0].n.changed === 1);
ok('deactivated link reads expired', (await q(`select public.get_link($1) as r`, [tokA]))[0].r.status === 'expired');
await rejects('deactivated link refuses edits', () => q(`select public.set_availability($1, '{}', 'UTC')`, [tokA]), 'link_unavailable');
ok('deactivate whole batch', (await q(`select public.manager_deactivate($1, $2, true) as n`, [PW, batchToks[0]]))[0].n.changed === 3);

// expiry
await q(`update public.links set expires_at = now() - interval '1 day' where token = $1`, [capped.links[0].token]);
ok('expired link reads expired', (await q(`select public.get_link($1) as r`, [capped.links[0].token]))[0].r.status === 'expired');

// permissions: anon cannot touch tables or private functions
await db.exec(`set role anon`);
await rejects('anon cannot read links table', () => q(`select * from public.links`), 'permission denied');
await rejects('anon cannot read passcode table', () => q(`select * from public.manager_config`), 'permission denied');
await rejects('anon cannot set passcode', () => q(`select public.set_manager_passcode('hacker hacker hacker')`), 'permission denied');
await rejects('anon cannot call private check', () => q(`select public._auth('x')`), 'permission denied');
ok('anon can call public api', (await q(`select public.get_link($1) as r`, [capped.links[1].token]))[0].r.status === 'ok');
ok('anon with wrong passcode refused', (await q(`select public.manager_overview('wrong') as r`))[0].r.error === 'bad_passcode');
// throttle
for (let i = 0; i < 25; i++) { try { await q(`select public.manager_check('guess${i}')`); } catch {} }
ok('throttle blocks after repeated failures', (await q(`select public.manager_check($1) as v`, [PW]))[0].v.error === 'too_many_attempts');
await db.exec(`reset role`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

