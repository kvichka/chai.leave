-- =============================================================================
-- 0016_profile_photos.sql
--
-- Lets a person upload their own profile photo.
--
-- WHY THIS NEEDS A FUNCTION RATHER THAN A POLICY
--   employees_update is HR-only, deliberately: staff must not be able to edit
--   their own hire date, department, role or supervisor. Row Level Security
--   cannot say "you may change this one column", because USING and WITH CHECK
--   cannot see which columns an UPDATE touched.
--
--   So self-service is a SECURITY DEFINER function that writes exactly one
--   column for exactly the caller. Nothing else becomes writable.
--
-- WHERE THE FILE GOES
--   Bucket 'avatars', at <employee_id>/<filename>. The storage policies key off
--   the first folder segment, so a person can only write inside their own
--   folder. Photos are readable by any signed-in colleague, which is the point
--   of a staff photo, and by nobody who is not signed in.
-- =============================================================================

alter table public.employees
  add column if not exists avatar_path text;

comment on column public.employees.avatar_path is
  'Object path inside the "avatars" storage bucket, e.g. <employee_id>/photo.jpg. '
  'Null means fall back to initials. Written only by rpc_set_my_avatar or HR.';

-- ------------------------------------------------------------------ bucket --
-- Not public: the file is served through a signed URL or an authenticated
-- request, so photos of staff are not left open to the internet.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', false, 2 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = false;

-- ---------------------------------------------------------------- policies --
-- Any signed-in colleague may look at a photo.
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

-- You may only write inside the folder named after your own employee id.
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = app_private.current_uid()::text
  );

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = app_private.current_uid()::text
  );

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = app_private.current_uid()::text
  );

-- ------------------------------------------------------- the one-column write --
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

  -- Passing null clears the photo and falls back to initials.
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
  set avatar_path = p_path
  where id = v_uid;
end;
$$;

comment on function public.rpc_set_my_avatar(text) is
  'Sets or clears the caller''s own avatar_path, and nothing else. Exists '
  'because employees_update is HR-only and RLS cannot grant per-column writes.';

revoke execute on function public.rpc_set_my_avatar(text) from public, anon;
grant   execute on function public.rpc_set_my_avatar(text) to authenticated;
