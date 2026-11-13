-- QuickSlot database setup (Supabase / Postgres)
--
-- Run this whole file once in the Supabase SQL Editor of a NEW project.
-- Then set the recruiter passcode (see the last section).
--
-- Security model:
--   * Tables are closed: row level security is on and no policies exist, so the
--     public (anon) key cannot read or write them directly.
--   * The website only talks to the database through the functions below.
--   * Candidate functions need only the secret link token.
--   * Recruiters sign in once with the shared passcode (manager_login) and get a random
--     session token. Every other recruiter function needs that token. The token is stored
--     only as a hash, expires 30 days after its last use (each use renews it), and is
--     deleted by manager_logout or when the passcode is changed. The passcode itself is
--     never kept by the website.
--   * Candidates can never read the recruiter's private label.
--
-- Recruiter functions never raise on a bad passcode or session (a raised error would roll
-- back the failed-attempt log and defeat the lockout). They return
-- { "error": "bad_passcode" | "too_many_attempts" } instead. "bad_passcode" on any call
-- other than manager_login means the session is missing or expired: sign in again.

-- Safe to re-run on a database set up before sessions existed: the recruiter functions
-- changed their first argument from the passcode to a session token, so the old ones go.
drop function if exists public.manager_check(text);
drop function if exists public.manager_overview(text);
drop function if exists public.manager_create_links(text, int, text[]);
drop function if exists public.manager_get_link(text, text, boolean);
drop function if exists public.manager_set_label(text, text, text);
drop function if exists public.manager_set_suggestions(text, text[], jsonb, text);
drop function if exists public.manager_deactivate(text, text, boolean);
drop function if exists public._auth(text);
-- set_availability gained a 4th argument (unavailable days), so the 3-argument version goes.
drop function if exists public.set_availability(text, timestamptz[], text);

-- ---------------------------------------------------------------- tables
create table if not exists public.batches (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.links (
  token                     text primary key,
  batch_id                  uuid references public.batches (id) on delete set null,
  label                     text not null default '',          -- recruiter-only
  created_at                timestamptz not null default now(),
  expires_at                timestamptz not null default now() + interval '90 days',
  updated_at                timestamptz not null default now(), -- last candidate/recruiter change
  candidate_updated_at      timestamptz not null default now(), -- last change made by the CANDIDATE (drives "New update")
  recruiter_viewed_at       timestamptz,                        -- last time a recruiter opened it
  active                    boolean not null default true,
  timezone                  text not null default 'UTC',        -- candidate's chosen zone
  slots                     timestamptz[] not null default '{}', -- start of each free 15 min block (UTC)
  unavailable_days          date[] not null default '{}',        -- whole days off, as dates in `timezone`
  suggested_slots           jsonb not null default '[]'::jsonb,  -- [{ "start": iso, "minutes": 30 }]
  suggested_slots_timezone  text,
  ranked_choices            timestamptz[] not null default '{}', -- candidate's ranked picks (starts)
  constraint token_shape check (token ~ '^[0-9a-f]{16}$'),
  constraint label_len   check (char_length(label) <= 120)
);
create index if not exists links_batch_idx on public.links (batch_id);
-- For databases created before these columns existed (create table above does nothing then).
alter table public.links add column if not exists unavailable_days date[] not null default '{}';

create table if not exists public.manager_config (
  id             int primary key default 1 check (id = 1),
  salt           text not null default '',
  passcode_hash  text not null default ''
);
insert into public.manager_config (id) values (1) on conflict do nothing;

create table if not exists public.auth_failures (
  at timestamptz not null default now()
);

create table if not exists public.manager_sessions (
  token_hash  text primary key,                       -- sha256 of the token; the token is never stored
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

alter table public.batches        enable row level security;
alter table public.links          enable row level security;
alter table public.manager_config enable row level security;
alter table public.auth_failures  enable row level security;
alter table public.manager_sessions enable row level security;
-- (No policies on purpose: direct table access is denied to anon/authenticated.)

-- ------------------------------------------------------------- helpers
-- Checks a recruiter session token. Returns 'ok' or 'bad_passcode'. A valid token is
-- renewed for another 30 days. Tokens are 256 bits of randomness, so a wrong one is not
-- logged as a failed attempt (that would let a stale browser tab lock out the whole team).
create or replace function public._auth(p_session text)
returns text
language plpgsql security definer set search_path = public
as $$
declare h text;
begin
  if p_session is null or p_session !~ '^[0-9a-f]{64}$' then
    return 'bad_passcode';
  end if;
  h := encode(sha256(convert_to(p_session, 'UTF8')), 'hex');
  update public.manager_sessions
     set expires_at = now() + interval '30 days'
   where token_hash = h and expires_at > now();
  if not found then return 'bad_passcode'; end if;
  return 'ok';
end;
$$;

create or replace function public._valid_zone(p_zone text)
returns boolean
language sql stable
as $$
  select p_zone is not null and exists (select 1 from pg_timezone_names where name = p_zone)
$$;

-- Keeps only instants on a 15 minute boundary, inside the booking window.
-- The site greys out anything sooner than 3 hours; this backstop refuses anything sooner
-- than 2.5 hours (the extra half hour absorbs clock differences and slow saves).
create or replace function public._clean_instants(p_in timestamptz[])
returns timestamptz[]
language sql stable
as $$
  select coalesce(array_agg(distinct t order by t), '{}')
  from (
    select t from unnest(coalesce(p_in, '{}')) as t
    where mod(extract(epoch from t)::bigint, 900) = 0
      and t >= now() + interval '150 minutes'
      and t < now() + interval '60 days'
    limit 2000
  ) s
$$;

-- Keeps only weekdays, from today (in the candidate's zone) up to 60 days out, deduplicated.
create or replace function public._clean_days(p_in date[], p_timezone text)
returns date[]
language sql stable
as $$
  select coalesce(array_agg(d order by d), '{}')
  from (
    select distinct d
      from unnest(coalesce(p_in, '{}')) as d
     where extract(isodow from d) between 1 and 5
       and d >= (now() at time zone p_timezone)::date
       and d <  (now() at time zone p_timezone)::date + 60
     order by d
     limit 40
  ) s
$$;

-- Removes suggested times (and the candidate's ranked picks) that have already started.
-- It does not touch updated_at, so cleaning up never shows as a "new update".
-- Called by the read functions below, and every 15 minutes by pg_cron when that is enabled
-- (see the end of this file), so past times disappear even if nobody opens the link.
create or replace function public._prune_past()
returns void
language sql security definer set search_path = public
as $$
  update public.links l
     set suggested_slots = coalesce((
           select jsonb_agg(x order by (x->>'start')::timestamptz)
             from jsonb_array_elements(l.suggested_slots) x
            where (x->>'start')::timestamptz > now()
         ), '[]'::jsonb),
         ranked_choices = coalesce((
           select array_agg(c order by ord)
             from unnest(l.ranked_choices) with ordinality as u(c, ord)
            where c > now()
         ), '{}')
   where exists (select 1 from jsonb_array_elements(l.suggested_slots) x where (x->>'start')::timestamptz <= now())
      or exists (select 1 from unnest(l.ranked_choices) c where c <= now())
$$;

-- ------------------------------------------------------ candidate API
-- Returns { status: 'ok' | 'expired' | 'not_found', ... }. Never includes the label.
create or replace function public.get_link(p_token text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare l public.links%rowtype;
begin
  perform public._prune_past();
  select * into l from public.links where token = lower(trim(p_token));
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if not l.active or l.expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'token', l.token,
    'timezone', l.timezone,
    'slots', to_jsonb(l.slots),
    'unavailable_days', to_jsonb(l.unavailable_days),
    'suggested_slots', l.suggested_slots,
    'suggested_slots_timezone', l.suggested_slots_timezone,
    'ranked_choices', to_jsonb(l.ranked_choices),
    'updated_at', l.updated_at,
    'expires_at', l.expires_at
  );
end;
$$;

-- p_unavailable_days: null keeps whatever is stored, an array replaces it. A day in that list can
-- hold no free blocks, so slots landing on one are dropped here rather than trusted to the site.
create or replace function public.set_availability(
  p_token text, p_slots timestamptz[], p_timezone text, p_unavailable_days date[] default null
)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare l public.links%rowtype; ts timestamptz; days date[];
begin
  select * into l from public.links where token = lower(trim(p_token)) for update;
  if not found or not l.active or l.expires_at < now() then
    raise exception 'link_unavailable' using errcode = 'P0001';
  end if;
  if not public._valid_zone(p_timezone) then
    raise exception 'bad_timezone' using errcode = 'P0001';
  end if;
  days := case when p_unavailable_days is null
               then public._clean_days(l.unavailable_days, p_timezone)
               else public._clean_days(p_unavailable_days, p_timezone) end;
  update public.links
     set slots = coalesce((
           select array_agg(t order by t)
             from unnest(public._clean_instants(p_slots)) t
            where not ((t at time zone p_timezone)::date = any (days))
         ), '{}'),
         unavailable_days = days,
         timezone = p_timezone,
         updated_at = now(),
         candidate_updated_at = now()
   where token = l.token
  returning updated_at into ts;
  return ts;
end;
$$;

create or replace function public.set_ranked_choices(p_token text, p_choices timestamptz[])
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare l public.links%rowtype; ts timestamptz; allowed timestamptz[];
begin
  select * into l from public.links where token = lower(trim(p_token)) for update;
  if not found or not l.active or l.expires_at < now() then
    raise exception 'link_unavailable' using errcode = 'P0001';
  end if;
  select coalesce(array_agg((s->>'start')::timestamptz), '{}') into allowed
    from jsonb_array_elements(l.suggested_slots) s;
  -- keep the candidate's order, but only picks that are real suggestions
  update public.links
     set ranked_choices = coalesce((
           select array_agg(c order by ord)
           from unnest(coalesce(p_choices, '{}')) with ordinality as u(c, ord)
           where c = any (allowed)
         ), '{}'),
         updated_at = now(),
         candidate_updated_at = now()
   where token = l.token
  returning updated_at into ts;
  return ts;
end;
$$;

-- ------------------------------------------------------ recruiter API
-- Signs a recruiter in. Checks the shared passcode and returns a new session token.
-- Wrong attempts are logged; after 20 in 10 minutes all sign-ins are locked for 10 minutes.
create or replace function public.manager_login(p_passcode text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare cfg public.manager_config%rowtype; tok text;
begin
  select * into cfg from public.manager_config where id = 1;
  delete from public.auth_failures where at < now() - interval '1 hour';
  if (select count(*) from public.auth_failures where at > now() - interval '10 minutes') >= 20 then
    return jsonb_build_object('error', 'too_many_attempts');
  end if;
  if cfg.passcode_hash = ''
     or p_passcode is null
     or encode(sha256(convert_to(cfg.salt || p_passcode, 'UTF8')), 'hex') <> cfg.passcode_hash then
    insert into public.auth_failures default values;
    return jsonb_build_object('error', 'bad_passcode');
  end if;
  delete from public.manager_sessions where expires_at <= now();
  tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.manager_sessions (token_hash, expires_at)
  values (encode(sha256(convert_to(tok, 'UTF8')), 'hex'), now() + interval '30 days');
  return jsonb_build_object('token', tok);
end;
$$;

-- Signs out: the token stops working immediately, on every device that has it.
create or replace function public.manager_logout(p_session text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if p_session is not null and p_session ~ '^[0-9a-f]{64}$' then
    delete from public.manager_sessions
     where token_hash = encode(sha256(convert_to(p_session, 'UTF8')), 'hex');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Dashboard: counts plus every link, newest activity first. Labels included.
create or replace function public.manager_overview(p_session text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare a text := public._auth(p_session); result jsonb;
begin
  if a <> 'ok' then return jsonb_build_object('error', a); end if;
  perform public._prune_past();
  select jsonb_build_object(
    'active', (select count(*) from public.links where active and expires_at > now()),
    'total',  (select count(*) from public.links),
    'links', coalesce((
      select jsonb_agg(row_to_json(x) order by x.sort_at desc)
      from (
        select
          l.token, l.label, l.batch_id, l.created_at, l.expires_at, l.updated_at, l.candidate_updated_at,
          (l.active and l.expires_at > now()) as is_active,
          cardinality(l.slots) as slot_count,
          (select min(t) from unnest(l.slots) t where t > now()) as next_slot,
          (l.candidate_updated_at > coalesce(l.recruiter_viewed_at, '-infinity'::timestamptz)
             and cardinality(l.slots) + cardinality(l.ranked_choices) > 0) as has_unseen_change,
          jsonb_array_length(l.suggested_slots) as suggested_count,
          cardinality(l.ranked_choices) as ranked_count,
          l.timezone,
          -- Days the candidate marked unavailable, from today on in their own zone. The dashboard
          -- scales the weekly minimum down by them, so past days would skew it.
          coalesce((select jsonb_agg(d order by d) from unnest(l.unavailable_days) d
                     where d >= (now() at time zone l.timezone)::date), '[]'::jsonb) as unavailable_days,
          -- Dashboard status "No/Few valid times this week": only for active links the candidate
          -- has answered and the recruiter has seen, and only the next 8 days (enough for Mon-Fri
          -- of this week, or of next week when it is the weekend). Empty otherwise to keep this small.
          case when l.active and l.expires_at > now()
                 and cardinality(l.slots) + cardinality(l.ranked_choices) > 0
                 and l.candidate_updated_at <= coalesce(l.recruiter_viewed_at, '-infinity'::timestamptz)
               then coalesce((select jsonb_agg(t order by t) from unnest(l.slots) t
                               where t > now() and t < now() + interval '8 days'), '[]'::jsonb)
               else '[]'::jsonb end as upcoming_slots,
          case when l.active and l.expires_at > now()
                 and cardinality(l.slots) + cardinality(l.ranked_choices) > 0
                 and l.candidate_updated_at <= coalesce(l.recruiter_viewed_at, '-infinity'::timestamptz)
               then coalesce((select jsonb_agg(sg order by (sg->>'start')::timestamptz)
                                from jsonb_array_elements(l.suggested_slots) sg
                               where (sg->>'start')::timestamptz = any (l.ranked_choices)
                                 and (sg->>'start')::timestamptz > now()
                                 and (sg->>'start')::timestamptz < now() + interval '8 days'), '[]'::jsonb)
               else '[]'::jsonb end as upcoming_picks,
          greatest(l.updated_at, l.created_at) as sort_at
        from public.links l
        order by sort_at desc
        limit 500
      ) x
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- Create one link, or a batch of up to 25. p_labels may be shorter than p_count.
create or replace function public.manager_create_links(p_session text, p_count int, p_labels text[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  a text := public._auth(p_session);
  n int := least(greatest(coalesce(p_count, 1), 1), 25);
  bid uuid;
  tok text;
  out jsonb := '[]'::jsonb;
  i int;
begin
  if a <> 'ok' then return jsonb_build_object('error', a); end if;
  if n > 1 then
    insert into public.batches default values returning id into bid;
  end if;
  for i in 1..n loop
    loop
      tok := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
      exit when not exists (select 1 from public.links where token = tok);
    end loop;
    insert into public.links (token, batch_id, label)
    values (tok, bid, left(coalesce(p_labels[i], ''), 120));
    out := out || jsonb_build_object('token', tok, 'label', left(coalesce(p_labels[i], ''), 120));
  end loop;
  return jsonb_build_object('batch_id', bid, 'links', out);
end;
$$;

-- Full link, with its batch mates. Opening a link marks its changes as seen.
create or replace function public.manager_get_link(p_session text, p_token text, p_mark_seen boolean default true)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare a text := public._auth(p_session); l public.links%rowtype; mates jsonb;
begin
  if a <> 'ok' then return jsonb_build_object('error', a); end if;
  perform public._prune_past();
  select * into l from public.links where token = lower(trim(p_token));
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if p_mark_seen then
    update public.links set recruiter_viewed_at = now() where token = l.token;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('token', m.token, 'label', m.label) order by m.created_at), '[]'::jsonb)
    into mates from public.links m
   where l.batch_id is not null and m.batch_id = l.batch_id;
  return jsonb_build_object(
    'status', case when l.active and l.expires_at > now() then 'ok' else 'expired' end,
    'token', l.token,
    'label', l.label,
    'batch_id', l.batch_id,
    'batch', mates,
    'timezone', l.timezone,
    'slots', to_jsonb(l.slots),
    'unavailable_days', to_jsonb(l.unavailable_days),
    'suggested_slots', l.suggested_slots,
    'suggested_slots_timezone', l.suggested_slots_timezone,
    'ranked_choices', to_jsonb(l.ranked_choices),
    'created_at', l.created_at,
    'updated_at', l.updated_at,
    'candidate_updated_at', l.candidate_updated_at,
    'expires_at', l.expires_at
  );
end;
$$;

create or replace function public.manager_set_label(p_session text, p_token text, p_label text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare a text := public._auth(p_session);
begin
  if a <> 'ok' then return jsonb_build_object('error', a); end if;
  update public.links set label = left(coalesce(p_label, ''), 120) where token = lower(trim(p_token));
  return jsonb_build_object('ok', true);
end;
$$;

-- Suggest times to one link or to many (a whole batch). p_slots: [{ "start": iso, "minutes": 30 }]
create or replace function public.manager_set_suggestions(
  p_session text, p_tokens text[], p_slots jsonb, p_timezone text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare a text := public._auth(p_session); cleaned jsonb; changed int;
begin
  if a <> 'ok' then return jsonb_build_object('error', a); end if;
  if not public._valid_zone(p_timezone) then
    return jsonb_build_object('error', 'bad_timezone');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'start', (d.s->>'start')::timestamptz,
           'minutes', least(greatest(coalesce((d.s->>'minutes')::int, 30), 15), 240))
           order by (d.s->>'start')::timestamptz), '[]'::jsonb)
    into cleaned
    from (select distinct on (s->>'start') s
            from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) s
           where mod(extract(epoch from (s->>'start')::timestamptz)::bigint, 900) = 0
             and (s->>'start')::timestamptz > now()
           limit 60) d;
  -- Times the candidate picked are part of their availability: they always stay, even when the
  -- recruiter clears or replaces the suggestions (for one link or a whole batch).
  update public.links l
     set suggested_slots = coalesce((
           select jsonb_agg(u.x order by (u.x->>'start')::timestamptz)
             from (
               select distinct on ((m.x->>'start')::timestamptz) m.x
                 from (
                   select 0 as pri, x from jsonb_array_elements(l.suggested_slots) x
                    where (x->>'start')::timestamptz = any (l.ranked_choices)
                   union all
                   select 1 as pri, x from jsonb_array_elements(cleaned) x
                 ) m
                order by (m.x->>'start')::timestamptz, m.pri
             ) u
         ), '[]'::jsonb),
         suggested_slots_timezone = p_timezone,
         updated_at = now() -- picks are untouched: every picked suggestion was kept above
   where l.token = any (select lower(trim(t)) from unnest(coalesce(p_tokens, '{}')) t);
  get diagnostics changed = row_count;
  return jsonb_build_object('ok', true, 'changed', changed);
end;
$$;

create or replace function public.manager_deactivate(p_session text, p_token text, p_whole_batch boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare a text := public._auth(p_session); bid uuid; n int;
begin
  if a <> 'ok' then return jsonb_build_object('error', a); end if;
  select batch_id into bid from public.links where token = lower(trim(p_token));
  update public.links set active = false
   where token = lower(trim(p_token))
      or (p_whole_batch and bid is not null and batch_id = bid);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'changed', n);
end;
$$;

-- ------------------------------------------------- recruiter passcode
-- Run this ONCE by hand, as the project owner, to set or change the passcode.
-- It is not callable from the website.
create or replace function public.set_manager_passcode(p_new text)
returns void
language plpgsql security definer set search_path = public
as $$
declare s text := encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex');
begin
  if p_new is null or char_length(p_new) < 10 then
    raise exception 'Use a passcode of at least 10 characters.';
  end if;
  update public.manager_config
     set salt = s,
         passcode_hash = encode(sha256(convert_to(s || p_new, 'UTF8')), 'hex')
   where id = 1;
  delete from public.auth_failures;
  delete from public.manager_sessions; -- everyone signs in again with the new passcode
end;
$$;

-- --------------------------------------------------------- permissions
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.get_link(text),
  public.set_availability(text, timestamptz[], text, date[]),
  public.set_ranked_choices(text, timestamptz[]),
  public.manager_login(text),
  public.manager_logout(text),
  public.manager_overview(text),
  public.manager_create_links(text, int, text[]),
  public.manager_get_link(text, text, boolean),
  public.manager_set_label(text, text, text),
  public.manager_set_suggestions(text, text[], jsonb, text),
  public.manager_deactivate(text, text, boolean)
to anon, authenticated;
-- set_manager_passcode, _auth, _valid_zone, _clean_instants, _clean_days and _prune_past stay private.

-- Clean past suggested times every 15 minutes, whether or not anyone opens a link.
-- Needs the pg_cron extension (Supabase: Database > Extensions > pg_cron). If it is not
-- available this block does nothing, and the read functions above still hide and delete
-- past times whenever a link or the dashboard is opened.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('quickslot-prune-past', '*/15 * * * *', 'select public._prune_past()');
exception when others then
  raise notice 'pg_cron not enabled (%). Past suggested times are cleaned when links are opened.', sqlerrm;
end
$$;

-- Now set the passcode (replace the text, at least 10 characters), then run:
--   select public.set_manager_passcode('choose-a-long-team-passcode');
