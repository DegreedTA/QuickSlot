-- Migration 3: let a candidate mark whole days as unavailable.
-- Run once in the Supabase SQL Editor. Safe to run twice. No data is lost.
--
-- RUN THIS BEFORE DEPLOYING THE SITE THAT USES IT. The new p_unavailable_days argument has a
-- default, so the site that is already live keeps working after this runs; deploying the new site
-- first would instead break the candidate's save until this migration lands.
--
-- The days are calendar dates in the candidate's own time zone (links.timezone), so changing the
-- zone never moves them. A day marked unavailable can hold no free blocks: set_availability drops
-- any slot whose local date is in the list, so the database stays consistent even if the site
-- sends both.

alter table public.links
  add column if not exists unavailable_days date[] not null default '{}';

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

-- p_unavailable_days: null keeps whatever is stored, an array replaces it.
drop function if exists public.set_availability(text, timestamptz[], text);
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

-- The old 3-argument set_availability was dropped above, so grant the new signature.
grant execute on function public.set_availability(text, timestamptz[], text, date[]) to anon, authenticated;
-- _clean_days stays private (never granted).
