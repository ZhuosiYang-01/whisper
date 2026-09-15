create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;
create extension if not exists citext;

create type public.note_delivery_kind as enum ('fixed', 'random');
create type public.note_status as enum ('sealed', 'delivered', 'opened');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique check (
    char_length(username::text) between 2 and 20
    and username::text ~ '^[[:alnum:]_一-龥]+$'
  ),
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);
create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create unique index one_space_per_user on public.space_members(user_id);
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id),
  sender_id uuid not null references public.profiles(id),
  recipient_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 2000),
  delivery_kind public.note_delivery_kind not null,
  recipient_timezone text not null,
  deliver_at timestamptz not null,
  status public.note_status not null default 'sealed',
  delivered_at timestamptz,
  opened_at timestamptz,
  push_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index notes_due_idx on public.notes(deliver_at) where status = 'sealed';
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.invites enable row level security;
alter table public.notes enable row level security;
alter table public.push_subscriptions enable row level security;

create or replace function public.is_space_member(target_space uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.space_members where space_id = target_space and user_id = auth.uid());
$$;
create policy "read own profile" on public.profiles for select using (id = auth.uid());
create policy "read fellow member profiles" on public.profiles for select using (exists(select 1 from public.space_members mine join public.space_members theirs using(space_id) where mine.user_id = auth.uid() and theirs.user_id = profiles.id));
create policy "update own timezone" on public.profiles for update using (id=auth.uid()) with check (id=auth.uid());
create policy "read member space" on public.spaces for select using (public.is_space_member(id));
create policy "read fellow members" on public.space_members for select using (public.is_space_member(space_id));
create policy "manage own subscriptions" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.claim_username(desired_username text) returns public.profiles language plpgsql security definer set search_path = public as $$
declare p public.profiles; clean_name text := btrim(desired_username);
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if char_length(clean_name) not between 2 and 20 or clean_name !~ '^[[:alnum:]_一-龥]+$' then
    raise exception 'username_invalid';
  end if;
  select * into p from profiles where id = auth.uid();
  if found then return p; end if;
  begin
    insert into profiles(id, username) values(auth.uid(), clean_name) returning * into p;
    return p;
  exception when unique_violation then
    raise exception 'username_taken';
  end;
end $$;

create or replace function public.get_my_context()
returns table(username text, space_id uuid, partner_username text, member_count bigint)
language sql stable security definer set search_path = public as $$
  select p.username::text,
         mine.space_id,
         partner.username::text,
         coalesce((select count(*) from space_members members where members.space_id = mine.space_id), 0)
  from profiles p
  left join space_members mine on mine.user_id = p.id
  left join space_members other on other.space_id = mine.space_id and other.user_id <> p.id
  left join profiles partner on partner.id = other.user_id
  where p.id = auth.uid();
$$;

create or replace function public.get_invite_preview(raw_token text)
returns table(inviter_username text, invite_status text)
language plpgsql stable security definer set search_path = public as $$
declare inv invites; members bigint;
begin
  select * into inv from invites where token_hash = encode(digest(raw_token,'sha256'),'hex');
  if not found then return query select null::text, 'invalid'::text; return; end if;
  select count(*) into members from space_members where space_id = inv.space_id;
  return query select (select username::text from profiles where id = inv.created_by),
    case when inv.accepted_at is not null or members >= 2 then 'full'
         when inv.expires_at <= now() then 'expired'
         else 'ready' end;
end $$;

create or replace function public.create_space_with_invite() returns text language plpgsql security definer set search_path = public as $$
declare sid uuid; raw_token text := encode(gen_random_bytes(24),'hex'); member_count bigint;
begin
  if not exists(select 1 from profiles where id = auth.uid()) then raise exception 'username_required'; end if;
  select space_id into sid from space_members where user_id = auth.uid();
  if sid is null then
    insert into spaces(created_by) values(auth.uid()) returning id into sid;
    insert into space_members values(sid, auth.uid(), now());
  else
    select count(*) into member_count from space_members where space_id = sid;
    if member_count >= 2 then raise exception 'already_bound'; end if;
    delete from invites where space_id = sid and accepted_at is null;
  end if;
  insert into invites(space_id, token_hash, created_by) values(sid, encode(digest(raw_token,'sha256'),'hex'), auth.uid());
  return raw_token;
end $$;

create or replace function public.accept_invite(raw_token text) returns uuid language plpgsql security definer set search_path = public as $$
declare inv invites; member_count int;
begin
  if not exists(select 1 from profiles where id = auth.uid()) then raise exception 'username_required'; end if;
  select * into inv from invites where token_hash = encode(digest(raw_token,'sha256'),'hex') and accepted_at is null and expires_at > now() for update;
  if not found then raise exception 'invite_invalid'; end if;
  select count(*) into member_count from space_members where space_id = inv.space_id;
  if member_count >= 2 then raise exception 'space_full'; end if;
  if exists(select 1 from space_members where user_id = auth.uid()) then raise exception 'already_bound'; end if;
  insert into space_members values(inv.space_id, auth.uid(), now());
  update invites set accepted_by = auth.uid(), accepted_at = now() where id = inv.id;
  return inv.space_id;
end $$;

create or replace function public.seal_note(note_body text, kind note_delivery_kind, days_after int, local_time time default null, random_window int default null) returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; recipient uuid; tz text; due timestamptz; nid uuid;
begin
  select sm.space_id into sid from space_members sm where sm.user_id=auth.uid();
  select sm.user_id into recipient from space_members sm where sm.space_id=sid and sm.user_id<>auth.uid();
  if recipient is null then raise exception 'partner_not_bound'; end if;
  select timezone into tz from profiles where id=recipient;
  if kind='fixed' then due := (((now() at time zone tz)::date + days_after) + local_time) at time zone tz;
  elsif random_window in (3,7,14,30) then due := now() + (random() * random_window * interval '1 day');
  else raise exception 'invalid_delivery_rule'; end if;
  insert into notes(space_id,sender_id,recipient_id,body,delivery_kind,recipient_timezone,deliver_at) values(sid,auth.uid(),recipient,note_body,kind,tz,due) returning id into nid;
  return nid;
end $$;

create policy "recipient sees opened notes" on public.notes for select using (recipient_id=auth.uid() and status='opened');
create or replace function public.pending_note_count() returns bigint language sql stable security definer set search_path=public as $$
  select count(*) from notes where sender_id=auth.uid() and status='sealed';
$$;
create or replace function public.unread_note_index() returns table(id uuid, delivered_at timestamptz) language sql stable security definer set search_path=public as $$
  select n.id,n.delivered_at from notes n where n.recipient_id=auth.uid() and n.status='delivered' order by n.delivered_at desc;
$$;
create or replace function public.open_note(note_id uuid) returns table(id uuid, body text, created_at timestamptz, delivered_at timestamptz) language plpgsql security definer set search_path=public as $$
begin
  return query update notes n set status='opened', opened_at=coalesce(n.opened_at,now()) where n.id=note_id and n.recipient_id=auth.uid() and n.status in ('delivered','opened') returning n.id,n.body,n.created_at,n.delivered_at;
end $$;
revoke all on function public.open_note(uuid) from public; grant execute on function public.open_note(uuid) to authenticated;
revoke all on function public.claim_username(text) from public; grant execute on function public.claim_username(text) to authenticated;
revoke all on function public.get_my_context() from public; grant execute on function public.get_my_context() to authenticated;
revoke all on function public.get_invite_preview(text) from public; grant execute on function public.get_invite_preview(text) to authenticated;
revoke all on function public.create_space_with_invite() from public; grant execute on function public.create_space_with_invite() to authenticated;
revoke all on function public.accept_invite(text) from public; grant execute on function public.accept_invite(text) to authenticated;
revoke all on function public.seal_note(text,note_delivery_kind,int,time,int) from public; grant execute on function public.seal_note(text,note_delivery_kind,int,time,int) to authenticated;
revoke all on function public.pending_note_count() from public; grant execute on function public.pending_note_count() to authenticated;
revoke all on function public.unread_note_index() from public; grant execute on function public.unread_note_index() to authenticated;

create or replace function public.prevent_note_mutation() returns trigger language plpgsql as $$ begin raise exception 'sealed_notes_are_immutable'; end $$;
create trigger immutable_note_fields before update of body,sender_id,recipient_id,space_id,delivery_kind,recipient_timezone,deliver_at on public.notes for each row execute function public.prevent_note_mutation();
