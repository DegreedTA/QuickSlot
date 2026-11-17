-- Migration 4: delete the candidate's free blocks once their time has passed.
-- Run once in the Supabase SQL Editor. Safe to run twice. Nothing else changes.
--
-- _prune_past() already dropped suggested times and the candidate's picks once they had started,
-- but never links.slots, so a link kept showing availability for days that had already gone by.
-- It now cleans all three the same way: a 15 minute block disappears the moment it starts.
-- updated_at is still left alone, so this never shows up as a "new update" on the dashboard.

create or replace function public._prune_past()
returns void
language sql security definer set search_path = public
as $$
  update public.links l
     set slots = coalesce((
           select array_agg(t order by t)
             from unnest(l.slots) t
            where t > now()
         ), '{}'),
         suggested_slots = coalesce((
           select jsonb_agg(x order by (x->>'start')::timestamptz)
             from jsonb_array_elements(l.suggested_slots) x
            where (x->>'start')::timestamptz > now()
         ), '[]'::jsonb),
         ranked_choices = coalesce((
           select array_agg(c order by ord)
             from unnest(l.ranked_choices) with ordinality as u(c, ord)
            where c > now()
         ), '{}')
   where exists (select 1 from unnest(l.slots) t where t <= now())
      or exists (select 1 from jsonb_array_elements(l.suggested_slots) x where (x->>'start')::timestamptz <= now())
      or exists (select 1 from unnest(l.ranked_choices) c where c <= now())
$$;
