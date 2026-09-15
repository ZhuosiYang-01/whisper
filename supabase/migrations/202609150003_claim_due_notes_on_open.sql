create or replace function public.unread_note_index()
returns table(id uuid, delivered_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
  update notes n
  set status='delivered', delivered_at=coalesce(n.delivered_at, now())
  where n.recipient_id=auth.uid()
    and n.status='sealed'
    and n.deliver_at<=now();

  return query
    select n.id,n.delivered_at
    from notes n
    where n.recipient_id=auth.uid() and n.status='delivered'
    order by n.delivered_at desc;
end $$;

revoke all on function public.unread_note_index() from public;
grant execute on function public.unread_note_index() to authenticated;
