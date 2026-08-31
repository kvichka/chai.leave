-- =============================================================================
-- 0009_storage.sql
-- Private bucket for sick notes and other supporting documents.
-- Path convention: {employee_id}/{request_id}/{filename}
--
-- These are medical documents. The bucket is private, there are no public URLs,
-- and the app only ever hands out short-lived signed URLs.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'leave-attachments',
  'leave-attachments',
  false,
  10485760,  -- 10 MB
  array['application/pdf', 'image/png', 'image/jpeg', 'image/heic',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: your own prefix, anyone beneath you in the reporting tree, or HR.
drop policy if exists leave_attachments_select on storage.objects;
create policy leave_attachments_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'leave-attachments'
    and (
      (storage.foldername(name))[1] = app_private.current_uid()::text
      or app_private.fn_is_hr()
      or (
        -- Guard the cast: a malformed object name must not raise an error and
        -- take the whole query down with it.
        (storage.foldername(name))[1] ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        and app_private.fn_is_descendant_of(
              app_private.current_uid(),
              ((storage.foldername(name))[1])::uuid
            )
      )
    )
  );

-- Write: your own prefix only. Nobody uploads a document on someone else's behalf.
drop policy if exists leave_attachments_insert on storage.objects;
create policy leave_attachments_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'leave-attachments'
    and (storage.foldername(name))[1] = app_private.current_uid()::text
  );

drop policy if exists leave_attachments_update on storage.objects;
create policy leave_attachments_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'leave-attachments'
    and (storage.foldername(name))[1] = app_private.current_uid()::text
  )
  with check (
    bucket_id = 'leave-attachments'
    and (storage.foldername(name))[1] = app_private.current_uid()::text
  );

drop policy if exists leave_attachments_delete on storage.objects;
create policy leave_attachments_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'leave-attachments'
    and (
      (storage.foldername(name))[1] = app_private.current_uid()::text
      or app_private.fn_is_hr()
    )
  );
