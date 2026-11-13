import * as W from '../src/lib/weeklyMinimum.ts';
import * as L from '../src/lib/linkStatus.ts';
import { zonedToUtc } from '../src/lib/time.ts';
let f = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) f++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ` got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)); };
const TZ = 'UTC';
const at = (d, h, m = 0) => zonedToUtc(2026, 11, d, h, m, TZ); // Nov 2026: Mon 9, Tue 10, Wed 11, Thu 12, Fri 13, Sat 14, Sun 15, Mon 16
const block = (d, h, hours) => Array.from({ length: hours * 4 }, (_, i) => at(d, h) + i * 900000); // free 15 min blocks
const LEAD = 3 * 3600e3;

// which weeks need how much
const r = (d, h = 12) => W.weekRequirements(TZ, at(d, h));
eq('Mon: this week 4h, next week optional', [r(9).current.min, r(9).next.required], [240, false]);
eq('Wed: this week 4h', r(11).current.min, 240);
eq('Thu: this week 4h, next week optional', [r(12).current.min, r(12).next.required], [240, false]);
eq('Fri: no current week, next week 4h required', [r(13).current, r(13).next.min, r(13).next.required], [null, 240, true]);
eq('Sat: no current week, next week 4h required', [r(14).current, r(14).next.min, r(14).next.required, r(14).next.mon], [null, 240, true, { y: 2026, m: 11, d: 16 }]);
eq('Sun: same as Sat', [r(15).current, r(15).next.required], [null, true]);

// minutes are counted once even when picks overlap free blocks
eq('overlap counted once', W.coveredMinutes(block(10, 9, 1), [{ start: at(10, 9, 30), minutes: 60 }], at(10, 0), at(11, 0), at(9, 0)), 90);
eq('past blocks ignored', W.coveredMinutes(block(10, 9, 2), [], at(10, 0), at(11, 0), at(10, 10)), 45);

const check = (day, slots, picks = []) => W.checkWeeks(TZ, slots, picks, LEAD, at(day, 9));
// Monday: 3h is not enough, 4h is
eq('Mon 3h -> current unmet', check(9, block(10, 9, 3)).unmet, ['current']);
eq('Mon 4h -> nothing unmet', check(9, block(10, 9, 4)).unmet, []);
// Monday with only the minimum and nothing next week: polite appeal
eq('Mon exactly 4h, next week empty -> appeal', check(9, block(10, 9, 4)).appeal, true);
eq('Mon 6h, next week empty -> no appeal', check(9, block(10, 9, 6)).appeal, false);
eq('Mon 4h + 4h next week -> no appeal', check(9, [...block(10, 9, 4), ...block(17, 9, 4)]).appeal, false);
// Thursday: 4h this week, appeal for next week
eq('Thu 3h -> current unmet', check(12, block(13, 9, 3)).unmet, ['current']);
eq('Thu 4h -> nothing unmet', check(12, block(13, 9, 4)).unmet, []);
eq('Thu 4h, next week 3h -> appeal', check(12, [...block(13, 9, 4), ...block(17, 9, 3)]).appeal, true);
// picks count as availability
eq('Thu 3h + a 1h pick -> ok', check(12, block(13, 9, 3), [{ start: at(13, 13), minutes: 60 }]).unmet, []);
// Friday: the current week is ignored, 4h next week required
eq('Fri 0h today, 3h next week -> next unmet', check(13, block(17, 9, 3)).unmet, ['next']);
eq('Fri 4h next week -> ok', check(13, block(17, 9, 4)).unmet, []);
eq('Fri time on the same day does not count', check(13, block(13, 18, 2)).unmet, ['next']);
// Saturday / Sunday: only next week, 4h
eq('Sat 3h next week -> next unmet', check(14, block(16, 9, 3)).unmet, ['next']);
eq('Sat 4h next week -> ok', check(14, block(16, 9, 4)).unmet, []);
// Fri-Sun: only the minimum next week -> still the polite appeal
eq('Fri exactly 4h next week -> appeal', check(13, block(17, 9, 4)).appeal, true);
eq('Sat exactly 4h next week -> appeal', check(14, block(16, 9, 4)).appeal, true);
eq('Sun 5h next week -> no appeal (min + 1h reached)', check(15, block(16, 9, 5)).appeal, false);
eq('Fri 6h next week -> no appeal', check(13, block(17, 9, 6)).appeal, false);
eq('Fri 3h next week -> need, not appeal', check(13, block(17, 9, 3)).appeal, false);
// a requirement is never higher than the time that can still be marked
eq('Thu 7pm: Friday still gives room, need stays 4h', W.checkWeeks(TZ, [], [], LEAD, at(12, 19)).current.need, 240);

// dashboard statuses
const row = (o) => ({ has_unseen_change: false, slot_count: 0, ranked_count: 0, suggested_count: 0, upcoming_slots: [], upcoming_picks: [], ...o });
const iso = (xs) => xs.map((t) => new Date(t).toISOString());
const st = (o, day = 9) => L.linkStatus(row(o), TZ, at(day, 9));
eq('unseen change wins', st({ has_unseen_change: true, slot_count: 4, suggested_count: 2 }), 'New update');
eq('suggestions, no picks, never answered', st({ suggested_count: 2 }), 'Waiting for picks');
eq('suggestions, no picks, but shared availability earlier -> still waiting for picks', st({ suggested_count: 2, slot_count: 8, upcoming_slots: iso(block(10, 9, 2)) }), 'Waiting for picks');
eq('nothing at all', st({}), 'Waiting for availability');
eq('answered, 4h this week -> up to date', st({ slot_count: 16, upcoming_slots: iso(block(10, 9, 4)) }), 'Up to date');
eq('answered, 3h on a Monday -> few', st({ slot_count: 12, upcoming_slots: iso(block(10, 9, 3)) }), 'Few valid times this week');
eq('answered, 3h on a Thursday -> few (bar is 4h)', st({ slot_count: 12, upcoming_slots: iso(block(13, 9, 3)) }, 12), 'Few valid times this week');
eq('answered, 0 valid -> none', st({ slot_count: 8, upcoming_slots: iso(block(17, 9, 2)) }), 'No valid times this week');
eq('picked something, suggestions exist -> judged on valid time', st({ suggested_count: 2, ranked_count: 1, upcoming_picks: [{ start: new Date(at(10, 9)).toISOString(), minutes: 240 }] }), 'Up to date');

// last update = the candidate's last change; creation time until they answer
const base = { created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-07T00:00:00Z', candidate_updated_at: '2026-11-05T00:00:00Z' };
eq('last update ignores recruiter edits', L.lastUpdateAt({ ...base, slot_count: 4, ranked_count: 0 }), Date.parse('2026-11-05T00:00:00Z'));
eq('never answered -> created time', L.lastUpdateAt({ ...base, slot_count: 0, ranked_count: 0 }), Date.parse('2026-11-01T00:00:00Z'));
console.log(f ? `${f} FAILED` : 'all ok');
process.exit(f ? 1 : 0);
