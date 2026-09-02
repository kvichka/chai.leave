-- =============================================================================
-- 0017_avatar_emoji.sql
--
-- An emoji as an alternative to a photo.
--
-- Most staff will never upload anything, and plenty would rather not have
-- their face in a shared directory at all. An emoji is a real choice rather
-- than a consolation: it identifies a row as well as a monogram does, costs no
-- storage, and needs no signed URL.
--
-- A person has exactly one avatar, and it is a photo, an emoji, or their
-- initials. Setting one clears the other, so there is never a stored
-- preference the screen is ignoring.
-- =============================================================================

alter table public.employees
  add column if not exists avatar_emoji text;

-- Short, and not a place to write text. The picker offers a fixed palette, but
-- rpc_set_my_avatar_emoji is callable directly, so the column defends itself:
-- a handful of characters, and nothing from the ASCII alphabet.
do $$ begin
  alter table public.employees
    add constraint employees_avatar_emoji_shape
    check (
      avatar_emoji is null
      or (char_length(avatar_emoji) between 1 and 8 and avatar_emoji !~ '[a-zA-Z0-9]')
    );
exception when duplicate_object then null; end $$;

comment on column public.employees.avatar_emoji is
  'Emoji shown in place of a photo. Mutually exclusive with avatar_path; the '
  'rpc_set_my_avatar* functions keep it that way.';

-- ------------------------------------------------------------- set an emoji --
create or replace function public.rpc_set_my_avatar_emoji(p_emoji text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.current_uid();
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  update public.employees
  set avatar_emoji = nullif(btrim(p_emoji), ''),
      -- One avatar per person. Choosing an emoji drops the photo reference so
      -- the two can never disagree about which is in use.
      avatar_path   = case when nullif(btrim(p_emoji), '') is null then avatar_path else null end
  where id = v_uid;
end;
$$;

comment on function public.rpc_set_my_avatar_emoji(text) is
  'Sets or clears the caller''s own emoji avatar, clearing any photo. Exists '
  'because employees_update is HR-only and RLS cannot grant per-column writes.';

revoke execute on function public.rpc_set_my_avatar_emoji(text) from public, anon;
grant   execute on function public.rpc_set_my_avatar_emoji(text) to authenticated;

-- -------------------------------------------- uploading a photo drops it --
create or replace function public.rpc_set_my_avatar(p_path text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.current_uid();
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if p_path is not null then
    -- Belt and braces: the storage policy already confines a writer to their
    -- own folder, but this stops a crafted call pointing the column at
    -- somebody else's file.
    if split_part(p_path, '/', 1) <> v_uid::text then
      raise exception 'A profile photo must live in your own folder.'
        using errcode = '42501';
    end if;
  end if;

  update public.employees
  set avatar_path  = p_path,
      avatar_emoji = case when p_path is null then avatar_emoji else null end
  where id = v_uid;
end;
$$;
