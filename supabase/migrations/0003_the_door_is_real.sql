-- The waiting room, enforced by the database rather than by the host's browser.
--
-- 0002 added `shows.admission`, `show_members.status` and `admit_member`, and then said in its own
-- closing note that none of it gated anything yet, because the two functions that decide who gets
-- in were never in version control:
--
--   * `join_show` inserted every arrival as 'admitted', whatever the show's door setting said.
--   * `show_state` handed out a role's full permissions to anyone holding a member id.
--
-- So the door was real only for as long as the host's tab was the thing answering. A crew member who
-- reloaded called `show_state` directly and was handed `fire` and `edit` without anybody letting
-- them in, and a removed device only stayed out because the page it had loaded remembered removing
-- it. Refreshing undid that.
--
-- Both functions are rewritten here in full rather than patched, because the versions that were
-- running existed only inside the database and the next person to read this repository would have
-- had no way to know what they did.
--
-- Backwards compatible on purpose: `shows.admission` defaults to false and `show_members.status`
-- defaults to 'admitted', so a show that never asks for a door behaves exactly as it did.

-- 1. The door
--
-- Arrivals wait only when the show asked for a door. The host never waits for themselves: they hold
-- the password, and a host locked out of their own show cannot admit anyone, which would be a
-- deadlock with no way out of it five minutes before curtain.
create or replace function public.join_show(p_key text, p_name text)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  s public.shows;
  r public.show_roles;
  m uuid;
  is_host boolean := false;
  v_status public.show_member_status;
begin
  -- Password first: if a host has set both to the same string, they meant the larger of the two.
  select * into s from public.shows where password = p_key;
  if s.id is not null then
    is_host := true;
  else
    select * into r from public.show_roles where code = p_key;
    if r.id is null then raise exception 'Nothing here goes by that key.'; end if;
    select * into s from public.shows where id = r.show_id;
  end if;

  v_status := case when is_host or not coalesce(s.admission, false)
                   then 'admitted' else 'waiting' end::public.show_member_status;

  insert into public.show_members (show_id, role_id, name, user_id, host, status)
    values (s.id, r.id, nullif(trim(coalesce(p_name, '')), ''), (select auth.uid()), is_host, v_status)
    returning id into m;

  return json_build_object('member', m, 'show', s.id, 'name', s.name, 'sequence', s.sequence_id,
    'started', s.started_at, 'host', is_host, 'status', v_status,
    'role', coalesce(r.name, case when is_host then 'Collaborator' else 'Crew' end),
    -- Someone still at the door gets no permissions at all. They are holding a ticket, not a job.
    'perms', case when v_status <> 'admitted' then '{}'::text[]
                  when is_host then array['cues','script','stage','fire','edit','message']
                  else coalesce(r.perms, '{}') end);
end;
$function$;

-- 2. What a device is allowed to see, asked again
--
-- This is the call a reload makes, and it was the hole: it never looked at `status`. It does now,
-- and it reports the status as well, so the crew page can put somebody back in the waiting room
-- instead of letting a refresh promote them.
--
-- 'denied' and 'waiting' both come back with no permissions. They are told apart so the page can say
-- "waiting to be let in" to one and "you were not let in" to the other, which are different things
-- to be told while standing in a wing in the dark.
create or replace function public.show_state(p_member uuid)
returns json
language sql
stable
security definer
set search_path = public
as $function$
  select json_build_object('show', s.id, 'name', s.name, 'sequence', s.sequence_id,
    'started', s.started_at, 'host', m.host, 'status', m.status,
    'role', coalesce(r.name, case when m.host then 'Collaborator' else 'Crew' end),
    'perms', case when m.status <> 'admitted' then '{}'::text[]
                  when m.host then array['cues','script','stage','fire','edit','message']
                  else coalesce(r.perms, '{}') end)
  from public.show_members m
  join public.shows s on s.id = m.show_id
  left join public.show_roles r on r.id = m.role_id
  where m.id = p_member;
$function$;

-- Unchanged from what was already granted; restated because the bodies above were replaced and an
-- execute grant that exists only in a dashboard is the thing this migration exists to stop.
revoke all on function public.join_show(text, text) from public;
revoke all on function public.show_state(uuid) from public;
grant execute on function public.join_show(text, text) to anon, authenticated;
grant execute on function public.show_state(uuid) to anon, authenticated;
