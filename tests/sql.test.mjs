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

// sign-in and sessions
const login = async (pw) => (await q(`select public.manager_login($1) as v`, [pw]))[0].v;
ok('wrong passcode returns error', (await login('nope')).error === 'bad_passcode');
const li = await login(PW);
ok('right passcode returns a 64-hex session token', /^[0-9a-f]{64}$/.test(li.token ?? ''));
const SES = li.token;
const stored = await q(`select token_hash from public.manager_sessions`);
ok('only a hash of the token is stored', stored.length === 1 && stored[0].token_hash !== SES && !JSON.stringify(stored).includes(SES));
ok('session token accepted', (await q(`select public.manager_overview($1) as r`, [SES]))[0].r.error === undefined);
ok('passcode is not accepted as a session', (await q(`select public.manager_overview($1) as r`, [PW]))[0].r.error === 'bad_passcode');
ok('garbage session refused', (await q(`select public.manager_overview($1) as r`, ['x'.repeat(64)]))[0].r.error === 'bad_passcode');
ok('null session refused', (await q(`select public.manager_overview(null) as r`))[0].r.error === 'bad_passcode');
// sliding expiry: using a session renews it; an expired one stops working
await q(`update public.manager_sessions set expires_at = now() + interval '1 day'`);
await q(`select public.manager_overview($1)`, [SES]);
const exp1 = (await q(`select expires_at > now() + interval '29 days' as renewed from public.manager_sessions`))[0].renewed;
ok('each use renews the session to 30 days', exp1 === true);
await q(`update public.manager_sessions set expires_at = now() - interval '1 minute'`);
ok('expired session refused', (await q(`select public.manager_overview($1) as r`, [SES]))[0].r.error === 'bad_passcode');
ok('expired session is not revived by trying again', (await q(`select public.manager_overview($1) as r`, [SES]))[0].r.error === 'bad_passcode');
const SES2 = (await login(PW)).token;
ok('login removes expired sessions', (await q(`select count(*)::int as n from public.manager_sessions`))[0].n === 1);
// logout kills the token; stale tokens do not count toward the lockout
const SES3 = (await login(PW)).token;
await q(`select public.manager_logout($1)`, [SES3]);
ok('logout invalidates that session', (await q(`select public.manager_overview($1) as r`, [SES3]))[0].r.error === 'bad_passcode');
ok('logout leaves other sessions alone', (await q(`select public.manager_overview($1) as r`, [SES2]))[0].r.error === undefined);
await q(`select public.manager_logout(null)`);
for (let i = 0; i < 30; i++) await q(`select public.manager_overview($1)`, [SES3]);
ok('stale tokens do not trigger the lockout', (await login(PW)).token !== undefined);
await q(`delete from public.auth_failures`);
await rejects('short passcode refused on set', () => q(`select public.set_manager_passcode('short')`), 'at least 10');
ok('sessions survive a refused passcode change', (await q(`select public.manager_overview($1) as r`, [SES2]))[0].r.error === undefined);

// create
const one = (await q(`select public.manager_create_links($1, 1, array['Maya Okafor, Staff Designer']) as r`, [SES2]))[0].r;
ok('single link created', one.links.length === 1 && one.batch_id === null);
const tokA = one.links[0].token;
ok('token is 16 hex', /^[0-9a-f]{16}$/.test(tokA));
const many = (await q(`select public.manager_create_links($1, 3, '{}') as r`, [SES2]))[0].r;
ok('batch of 3 created with batch id', many.links.length === 3 && !!many.batch_id);
const capped = (await q(`select public.manager_create_links($1, 999, '{}') as r`, [SES2]))[0].r;
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
let ov = (await q(`select public.manager_overview($1) as r`, [SES2]))[0].r;
const row = ov.links.find((l) => l.token === tokA);
ok('overview counts', ov.total === 29 && ov.active === 29, JSON.stringify([ov.total, ov.active]));
ok('overview shows label and slot count', row.label.startsWith('Maya') && row.slot_count === 3);
ok('unseen change flagged', row.has_unseen_change === true);
await q(`select public.manager_get_link($1, $2, true)`, [SES2, tokA]);
ov = (await q(`select public.manager_overview($1) as r`, [SES2]))[0].r;
ok('opening link clears unseen flag', ov.links.find((l) => l.token === tokA).has_unseen_change === false);
await q(`select public.set_availability($1, $2::timestamptz[], 'America/New_York')`, [tokA, [iso(0)]]);
ov = (await q(`select public.manager_overview($1) as r`, [SES2]))[0].r;
ok('new candidate edit re-flags', ov.links.find((l) => l.token === tokA).has_unseen_change === true);

// a recruiter saving suggested times must not look like a candidate update
{
  await q(`select public.manager_get_link($1, $2, true)`, [SES2, tokA]);
  const sug = JSON.stringify([{ start: new Date(Math.ceil((Date.now() + 5 * 86400e3) / 900000) * 900000).toISOString(), minutes: 30 }]);
  await q(`select public.manager_set_suggestions($1, array[$2], $3::jsonb, 'UTC')`, [SES2, tokA, sug]);
  const r = (await q(`select public.manager_overview($1) as r`, [SES2]))[0].r.links.find((l) => l.token === tokA);
  ok('recruiter saving suggestions does not flag unseen', r.has_unseen_change === false, JSON.stringify(r));
  await q(`select public.set_availability($1, $2::timestamptz[], 'UTC')`, [tokA, [new Date(Math.ceil((Date.now() + 6 * 86400e3) / 900000) * 900000).toISOString()]]);
  const r2 = (await q(`select public.manager_overview($1) as r`, [SES2]))[0].r.links.find((l) => l.token === tokA);
  ok('candidate saving availability flags unseen', r2.has_unseen_change === true);
}

// the candidate's own change time is exposed, and recruiter edits do not move it
{
  const get = async () => (await q(`select public.manager_get_link($1, $2, false) as r`, [SES2, tokA]))[0].r;
  const ov1 = (await q(`select public.manager_overview($1) as r`, [SES2]))[0].r.links.find((l) => l.token === tokA);
  const g1 = await get();
  ok('overview and link expose candidate_updated_at', !!ov1.candidate_updated_at && g1.candidate_updated_at === ov1.candidate_updated_at);
  await new Promise((r) => setTimeout(r, 20));
  const sg2 = JSON.stringify([{ start: new Date(Math.ceil((Date.now() + 7 * 86400e3) / 900000) * 900000).toISOString(), minutes: 45 }]);
  await q(`select public.manager_set_suggestions($1, array[$2], $3::jsonb, 'UTC')`, [SES2, tokA, sg2]);
  const g2 = await get();
  ok('recruiter adding a suggestion keeps candidate_updated_at', g2.candidate_updated_at === g1.candidate_updated_at && g2.updated_at !== g1.updated_at, JSON.stringify([g1, g2]));
}

// picked suggestions survive "clear all" and replacing the list, for one link and for a batch
{
  const mk = (days) => new Date(Math.ceil((Date.now() + days * 86400e3) / 900000) * 900000).toISOString();
  const [a, b, c] = [mk(8), mk(9), mk(10)];
  const batch = (await q(`select public.manager_create_links($1, 2, array['P 1','P 2']) as r`, [SES2]))[0].r.links.map((l) => l.token);
  const sugg = JSON.stringify([a, b, c].map((start) => ({ start, minutes: 30 })));
  await q(`select public.manager_set_suggestions($1, $2::text[], $3::jsonb, 'UTC')`, [SES2, batch, sugg]);
  await q(`select public.set_ranked_choices($1, $2::timestamptz[])`, [batch[0], [b]]); // link 1 picks b
  await q(`select public.set_ranked_choices($1, $2::timestamptz[])`, [batch[1], [c]]); // link 2 picks c
  await q(`select public.manager_set_suggestions($1, $2::text[], '[]'::jsonb, 'UTC')`, [SES2, batch]); // clear all, whole batch
  const g = async (t) => (await q(`select public.manager_get_link($1, $2, false) as r`, [SES2, t]))[0].r;
  const l1 = await g(batch[0]), l2 = await g(batch[1]);
  const starts = (l) => l.suggested_slots.map((x) => Date.parse(x.start));
  ok('clear all keeps what each link picked', JSON.stringify(starts(l1)) === JSON.stringify([Date.parse(b)]) && JSON.stringify(starts(l2)) === JSON.stringify([Date.parse(c)]), JSON.stringify([l1.suggested_slots, l2.suggested_slots]));
  ok('picks are still picks after clear all', l1.ranked_choices.length === 1 && l2.ranked_choices.length === 1);
  await q(`select public.manager_set_suggestions($1, array[$2], $3::jsonb, 'UTC')`, [SES2, batch[0], JSON.stringify([{ start: a, minutes: 30 }])]);
  const l1b = await g(batch[0]);
  ok('replacing the list keeps the pick and adds the new time', JSON.stringify(starts(l1b)) === JSON.stringify([Date.parse(a), Date.parse(b)]), JSON.stringify(l1b.suggested_slots));
}

// overview: upcoming times only for active, answered, seen links
{
  const row2 = (await q(`select public.manager_overview($1) as r`, [SES2]))[0].r.links.find((l) => l.token === tokA);
  ok('upcoming_slots empty while change unseen', row2.has_unseen_change && row2.upcoming_slots.length === 0);
  await q(`select public.manager_get_link($1, $2, true)`, [SES2, tokA]);
  const row3 = (await q(`select public.manager_overview($1) as r`, [SES2]))[0].r.links.find((l) => l.token === tokA);
  ok('upcoming_slots filled once seen, within 8 days', Array.isArray(row3.upcoming_slots) && row3.upcoming_slots.every((t) => Date.parse(t) < Date.now() + 8 * 86400e3 && Date.parse(t) > Date.now()), JSON.stringify(row3.upcoming_slots));
  ok('upcoming_picks is an array', Array.isArray(row3.upcoming_picks));
}

// past suggested times are removed automatically and never shown
{
  const past = new Date(Date.now() - 3600e3).toISOString();
  const future = new Date(Math.ceil((Date.now() + 5 * 86400e3) / 900000) * 900000).toISOString();
  const tok = (await q(`select public.manager_create_links($1, 1, '{}') as r`, [SES2]))[0].r.links[0].token;
  await q(`update public.links set suggested_slots = $2::jsonb, ranked_choices = $3::timestamptz[], updated_at = '2020-01-01' where token = $1`,
    [tok, JSON.stringify([{ start: past, minutes: 30 }, { start: future, minutes: 30 }]), [past, future]]);
  const cg = (await q(`select public.get_link($1) as r`, [tok]))[0].r;
  ok('candidate no longer sees past suggestions', cg.suggested_slots.length === 1 && new Date(cg.suggested_slots[0].start).getTime() === new Date(future).getTime(), JSON.stringify(cg.suggested_slots));
  ok('past ranked pick removed too', cg.ranked_choices.length === 1);
  ok('cleanup does not count as a candidate update', new Date(cg.updated_at).getUTCFullYear() === 2020, cg.updated_at);
  await q(`update public.links set suggested_slots = $2::jsonb where token = $1`, [tok, JSON.stringify([{ start: past, minutes: 30 }])]);
  const mg = (await q(`select public.manager_get_link($1, $2, false) as r`, [SES2, tok]))[0].r;
  ok('recruiter view prunes past suggestions', mg.suggested_slots.length === 0);
  await q(`update public.links set suggested_slots = $2::jsonb where token = $1`, [tok, JSON.stringify([{ start: past, minutes: 30 }])]);
  await q(`select public._prune_past()`);
  ok('scheduled prune deletes past suggestions', (await q(`select jsonb_array_length(suggested_slots) as n from public.links where token = $1`, [tok]))[0].n === 0);
  await q(`select public.manager_set_suggestions($1, array[$2]::text[], $3::jsonb, 'UTC')`, [SES2, tok, JSON.stringify([{ start: past, minutes: 30 }])]);
  ok('cannot suggest a time in the past', (await q(`select jsonb_array_length(suggested_slots) as n from public.links where token = $1`, [tok]))[0].n === 0);
  const clearTok = (await q(`select public.manager_create_links($1, 1, '{}') as r`, [SES2]))[0].r.links[0].token;
  await q(`select public.manager_set_suggestions($1, array[$2]::text[], $3::jsonb, 'UTC')`, [SES2, clearTok, JSON.stringify([{ start: future, minutes: 30 }])]);
  await q(`select public.manager_set_suggestions($1, array[$2]::text[], '[]'::jsonb, 'UTC')`, [SES2, clearTok]);
  ok('clearing all suggestions works', (await q(`select jsonb_array_length(suggested_slots) as n from public.links where token = $1`, [clearTok]))[0].n === 0);
}

// suggestions + batch edit + ranking
const batchToks = many.links.map((l) => l.token);
const sugg = JSON.stringify([{ start: iso(24 * 60), minutes: 45 }, { start: iso(24 * 60 + 60), minutes: 30 }, { start: iso(5) }]);
const n = (await q(`select public.manager_set_suggestions($1, $2::text[], $3::jsonb, 'America/Los_Angeles') as n`, [SES2, batchToks, sugg]))[0].n.changed;
ok('suggestions applied to whole batch', n === 3);
const bg = (await q(`select public.get_link($1) as r`, [batchToks[0]]))[0].r;
ok('suggestions: misaligned dropped, minutes kept', bg.suggested_slots.length === 2 && bg.suggested_slots[0].minutes === 45, JSON.stringify(bg.suggested_slots));
ok('suggestions zone stored', bg.suggested_slots_timezone === 'America/Los_Angeles');
const pick = bg.suggested_slots.map((s) => s.start);
await q(`select public.set_ranked_choices($1, $2::timestamptz[])`, [batchToks[0], [pick[1], pick[0], iso(999)]]);
const rg = (await q(`select public.get_link($1) as r`, [batchToks[0]]))[0].r;
ok('ranking keeps order and drops non-suggested', rg.ranked_choices.length === 2 && new Date(rg.ranked_choices[0]).getTime() === new Date(pick[1]).getTime(), JSON.stringify(rg.ranked_choices));
await q(`select public.manager_set_suggestions($1, $2::text[], $3::jsonb, 'UTC')`, [SES2, [batchToks[0]], JSON.stringify([{ start: pick[0], minutes: 30 }])]);
const rg2 = (await q(`select public.get_link($1) as r`, [batchToks[0]]))[0].r;
// picked times are part of the candidate's availability: changing the list never takes them away
ok('changing suggestions keeps the candidate\'s picks', rg2.ranked_choices.length === 2 && rg2.suggested_slots.length === 2, JSON.stringify([rg2.ranked_choices, rg2.suggested_slots]));
const mg = (await q(`select public.manager_get_link($1, $2) as r`, [SES2, batchToks[1]]))[0].r;
ok('manager sees batch mates', mg.batch.length === 3);

// unavailable days: whole days the candidate marks off
{
  const tok = (await q(`select public.manager_create_links($1, 1, '{}') as r`, [SES2]))[0].r.links[0].token;
  // a Monday and the Tuesday after it, at least 4 days out, plus the Saturday between
  const at4 = new Date(Date.now() + 4 * 86400e3);
  const mon = new Date(at4); while (mon.getUTCDay() !== 1) mon.setUTCDate(mon.getUTCDate() + 1);
  const tue = new Date(mon); tue.setUTCDate(mon.getUTCDate() + 1);
  const sat = new Date(mon); sat.setUTCDate(mon.getUTCDate() + 5);
  const day = (d) => d.toISOString().slice(0, 10);
  const slotOn = (d, h) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, 0, 0)).toISOString();
  const bothDays = [slotOn(mon, 9), slotOn(mon, 10), slotOn(tue, 9)];
  const get = async () => (await q(`select public.get_link($1) as r`, [tok]))[0].r;

  await q(`select public.set_availability($1, $2::timestamptz[], 'UTC', $3::date[])`, [tok, bothDays, [day(tue)]]);
  let g = await get();
  ok('unavailable day stored and returned by get_link', JSON.stringify(g.unavailable_days) === JSON.stringify([day(tue)]), JSON.stringify(g.unavailable_days));
  ok('slots on an unavailable day are dropped', g.slots.length === 2 && g.slots.every((t) => Date.parse(t) < Date.parse(slotOn(tue, 0))), JSON.stringify(g.slots));

  // the old 3-argument call still works and leaves the stored days alone
  await q(`select public.set_availability($1, $2::timestamptz[], 'UTC')`, [tok, bothDays]);
  g = await get();
  ok('3-argument call keeps the stored days', JSON.stringify(g.unavailable_days) === JSON.stringify([day(tue)]));
  ok('3-argument call still drops slots on those days', g.slots.length === 2);

  // weekends and past dates are refused; the array replaces what was there
  const past = new Date(Date.now() - 10 * 86400e3);
  await q(`select public.set_availability($1, '{}', 'UTC', $2::date[])`, [tok, [day(mon), day(sat), day(past), day(mon)]]);
  g = await get();
  ok('weekend, past and duplicate dates dropped', JSON.stringify(g.unavailable_days) === JSON.stringify([day(mon)]), JSON.stringify(g.unavailable_days));

  // an empty array clears them (null, which the 3-argument call sends, does not)
  await q(`select public.set_availability($1, '{}', 'UTC', '{}'::date[])`, [tok]);
  ok('empty array clears the days', (await get()).unavailable_days.length === 0);

  await q(`select public.set_availability($1, $2::timestamptz[], 'UTC', $3::date[])`, [tok, bothDays, [day(tue)]]);
  const mgl = (await q(`select public.manager_get_link($1, $2, false) as r`, [SES2, tok]))[0].r;
  ok('manager_get_link returns unavailable_days', JSON.stringify(mgl.unavailable_days) === JSON.stringify([day(tue)]));
  const orow = (await q(`select public.manager_overview($1) as r`, [SES2]))[0].r.links.find((l) => l.token === tok);
  ok('manager_overview returns unavailable_days', JSON.stringify(orow.unavailable_days) === JSON.stringify([day(tue)]), JSON.stringify(orow.unavailable_days));
  // a day that has gone by is left out of the dashboard row but stays on the link
  await q(`update public.links set unavailable_days = $2::date[] where token = $1`, [tok, [day(past), day(tue)]]);
  const orow2 = (await q(`select public.manager_overview($1) as r`, [SES2]))[0].r.links.find((l) => l.token === tok);
  ok('overview hides days that already passed', JSON.stringify(orow2.unavailable_days) === JSON.stringify([day(tue)]));
}

// labels, deactivate
await q(`select public.manager_set_label($1, $2, 'Renamed')`, [SES2, tokA]);
ok('label updated', (await q(`select public.manager_get_link($1, $2, false) as r`, [SES2, tokA]))[0].r.label === 'Renamed');
ok('deactivate one', (await q(`select public.manager_deactivate($1, $2, false) as n`, [SES2, tokA]))[0].n.changed === 1);
ok('deactivated link reads expired', (await q(`select public.get_link($1) as r`, [tokA]))[0].r.status === 'expired');
await rejects('deactivated link refuses edits', () => q(`select public.set_availability($1, '{}', 'UTC')`, [tokA]), 'link_unavailable');
ok('deactivate whole batch', (await q(`select public.manager_deactivate($1, $2, true) as n`, [SES2, batchToks[0]]))[0].n.changed === 3);

// expiry
await q(`update public.links set expires_at = now() - interval '1 day' where token = $1`, [capped.links[0].token]);
ok('expired link reads expired', (await q(`select public.get_link($1) as r`, [capped.links[0].token]))[0].r.status === 'expired');

// permissions: anon cannot touch tables or private functions
await db.exec(`set role anon`);
await rejects('anon cannot read links table', () => q(`select * from public.links`), 'permission denied');
await rejects('anon cannot read passcode table', () => q(`select * from public.manager_config`), 'permission denied');
await rejects('anon cannot set passcode', () => q(`select public.set_manager_passcode('hacker hacker hacker')`), 'permission denied');
await rejects('anon cannot call private check', () => q(`select public._auth('x')`), 'permission denied');
await rejects('anon cannot read sessions table', () => q(`select * from public.manager_sessions`), 'permission denied');
ok('anon can call public api', (await q(`select public.get_link($1) as r`, [capped.links[1].token]))[0].r.status === 'ok');
ok('anon with wrong passcode refused', (await q(`select public.manager_overview('wrong') as r`))[0].r.error === 'bad_passcode');
// throttle
for (let i = 0; i < 25; i++) { try { await q(`select public.manager_login('guess${i}')`); } catch {} }
ok('throttle blocks after repeated failures', (await q(`select public.manager_login($1) as v`, [PW]))[0].v.error === 'too_many_attempts');
ok('an existing session still works while sign-in is locked', (await q(`select public.manager_overview($1) as r`, [SES2]))[0].r.error === undefined);
await db.exec(`reset role`);
await q(`select public.set_manager_passcode('another long passcode')`);
ok('changing the passcode signs everyone out', (await q(`select count(*)::int as n from public.manager_sessions`))[0].n === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

