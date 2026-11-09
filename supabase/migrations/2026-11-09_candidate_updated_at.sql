-- Migration: separate "the candidate changed something" from "anyone changed something".
-- Run once in the Supabase SQL Editor on an EXISTING project. Safe to run twice. No data is lost.
--
-- Before: the dashboard flagged "New update" whenever updated_at moved, and the recruiter saving
-- suggested times also moves updated_at, so it could look like a candidate update.
-- After: links.candidate_updated_at moves only when the candidate saves availability or picks.

alter table public.links add column if not exists candidate_updated_at timestamptz;
-- existing links keep their current state: seen stays seen, unseen stays unseen
update public.links set candidate_updated_at = updated_at where candidate_updated_at is null;
alter table public.links alter column candidate_updated_at set default now();
alter table public.links alter column candidate_updated_at set not null;

create or replace function public.set_availability(p_token text, p_slots timestamptz[], p_timezone text)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare l public.links%rowtype; ts timestamptz;
begin
  select * into l from public.links where token = lower(trim(p_token)) for update;
  if not found or not l.active or l.expires_at < now() then
    raise exception 'link_unavailable' using errcode = 'P0001';
  end if;
  if not public._valid_zone(p_timezone) then
    raise exception 'bad_timezone' using errcode = 'P0001';
  end if;
  update public.links
     set slots = public._clean_instants(p_slots),
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

create or replace function public.manager_overview(p_passcode text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare a text := public._auth(p_passcode); result jsonb;
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
          l.token, l.label, l.batch_id, l.created_at, l.expires_at, l.updated_at,
          (l.active and l.expires_at > now()) as is_active,
          cardinality(l.slots) as slot_count,
          (select min(t) from unnest(l.slots) t where t > now()) as next_slot,
          (l.candidate_updated_at > coalesce(l.recruiter_viewed_at, '-infinity'::timestamptz)
             and cardinality(l.slots) + cardinality(l.ranked_choices) > 0) as has_unseen_change,
          jsonb_array_length(l.suggested_slots) as suggested_count,
          cardinality(l.ranked_choices) as ranked_count,
          l.timezone,
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
