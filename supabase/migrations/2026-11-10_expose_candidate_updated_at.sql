-- Migration 2: show the candidate's own last-change time on the dashboard and the link page.
-- Run once in the Supabase SQL Editor (after 2026-11-09_candidate_updated_at.sql). Safe to run twice. No data is lost.
--
-- Recruiter edits (adding or removing suggested times) move updated_at, but the dashboard's
-- "Last update" must only reflect what the CANDIDATE did, so both functions now return
-- candidate_updated_at as well.
--
-- Also: manager_set_suggestions now keeps the times the candidate picked when the recruiter clears
-- or replaces suggestions (they are part of the candidate's availability).

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
          l.token, l.label, l.batch_id, l.created_at, l.expires_at, l.updated_at, l.candidate_updated_at,
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

create or replace function public.manager_get_link(p_passcode text, p_token text, p_mark_seen boolean default true)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare a text := public._auth(p_passcode); l public.links%rowtype; mates jsonb;
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

create or replace function public.manager_set_suggestions(
  p_passcode text, p_tokens text[], p_slots jsonb, p_timezone text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare a text := public._auth(p_passcode); cleaned jsonb; changed int;
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
