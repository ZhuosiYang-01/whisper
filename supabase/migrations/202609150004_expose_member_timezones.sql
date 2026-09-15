drop function if exists public.get_my_context();

create function public.get_my_context()
returns table(
  username text,
  timezone text,
  space_id uuid,
  partner_username text,
  partner_timezone text,
  member_count bigint
)
language sql stable security definer set search_path = public as $$
  select p.username::text,
         p.timezone,
         mine.space_id,
         partner.username::text,
         partner.timezone,
         coalesce((select count(*) from space_members members where members.space_id = mine.space_id), 0)
  from profiles p
  left join space_members mine on mine.user_id = p.id
  left join space_members other on other.space_id = mine.space_id and other.user_id <> p.id
  left join profiles partner on partner.id = other.user_id
  where p.id = auth.uid();
$$;

revoke all on function public.get_my_context() from public;
grant execute on function public.get_my_context() to authenticated;
