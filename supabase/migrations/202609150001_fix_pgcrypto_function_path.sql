-- Supabase installs pgcrypto in the extensions schema. These security-definer
-- functions deliberately use a restricted search path, so include that schema
-- when generating or hashing invitation tokens.
alter function public.get_invite_preview(text)
  set search_path = public, extensions;

alter function public.create_space_with_invite()
  set search_path = public, extensions;

alter function public.accept_invite(text)
  set search_path = public, extensions;
