drop function if exists public.seal_note(text, note_delivery_kind, int, time, int);

create or replace function public.seal_note(
  note_body text,
  kind note_delivery_kind,
  days_after int default null,
  local_time time default null,
  random_window int default null,
  delivery_date date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; recipient uuid; tz text; due timestamptz; nid uuid;
begin
  select sm.space_id into sid from space_members sm where sm.user_id=auth.uid();
  select sm.user_id into recipient from space_members sm where sm.space_id=sid and sm.user_id<>auth.uid();
  if recipient is null then raise exception 'partner_not_bound'; end if;
  select timezone into tz from profiles where id=recipient;

  if kind='fixed' and local_time is not null then
    if delivery_date is not null then
      due := (delivery_date + local_time) at time zone tz;
    elsif days_after between 0 and 365 then
      due := (((now() at time zone tz)::date + days_after) + local_time) at time zone tz;
    else
      raise exception 'invalid_delivery_rule';
    end if;
    if due <= now() then raise exception 'delivery_in_past'; end if;
  elsif kind='random' and random_window in (3,7,14,30) then
    due := now() + (random() * random_window * interval '1 day');
  else
    raise exception 'invalid_delivery_rule';
  end if;

  insert into notes(space_id,sender_id,recipient_id,body,delivery_kind,recipient_timezone,deliver_at)
  values(sid,auth.uid(),recipient,note_body,kind,tz,due)
  returning id into nid;
  return nid;
end $$;

revoke all on function public.seal_note(text,note_delivery_kind,int,time,int,date) from public;
grant execute on function public.seal_note(text,note_delivery_kind,int,time,int,date) to authenticated;
