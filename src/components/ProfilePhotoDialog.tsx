import { useRef, useState } from 'react'
import { ImageUp, Trash2 } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Avatar, AVATAR_BUCKET, forgetAvatarUrl } from '@/components/Avatar'
import { useToast } from '@/components/ui/Toast'
import { useSetMyAvatar, useSetMyAvatarEmoji } from '@/hooks/useMutations'
import { supabase } from '@/lib/supabase'
import { humanError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import type { Employee } from '@/lib/database.types'

/**
 * A small, deliberately mixed palette: faces, plus a few things people use to
 * stand for themselves. Kept short so the picker stays one glance rather than
 * a search problem, and stored as a plain character - see migration 0017.
 */
const AVATAR_EMOJI = [
  '🙂', '😄', '😎', '🤓', '🥳', '😴',
  '🐱', '🐶', '🦊', '🐧', '🦉', '🐢',
  '🌻', '🌴', '⚽', '🎧', '☕', '🚴',
]

const MAX_BYTES = 2 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

/**
 * Upload or remove your own profile photo.
 *
 * The file goes to <employee_id>/<timestamp>.<ext> rather than a fixed name.
 * A fixed name would be cached by the browser and the CDN, so a replacement
 * photo would keep showing the old face until the cache expired; a new path
 * each time sidesteps that entirely. The previous file is deleted after the
 * new one is safely in place.
 */
export function ProfilePhotoDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: Employee
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const toast = useToast()
  const setAvatar = useSetMyAvatar()
  const setEmoji = useSetMyAvatarEmoji()

  async function upload(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      toast.error('That file type is not supported', 'Choose a JPEG, PNG or WebP image.')
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error(
        'That image is too large',
        `The limit is 2 MB and this one is ${(file.size / 1024 / 1024).toFixed(1)} MB. Most phone photos need shrinking first.`,
      )
      return
    }

    setBusy(true)
    setPreview(URL.createObjectURL(file))
    const previous = employee.avatar_path
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${employee.id}/${Date.now()}.${ext}`

    try {
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) throw uploadError

      await setAvatar.mutateAsync(path)

      // Only now that the column points at the new file is the old one safe to
      // remove. Failing to delete it is untidy, not broken, so it is ignored.
      if (previous && previous !== path) {
        await supabase.storage.from(AVATAR_BUCKET).remove([previous])
        forgetAvatarUrl(previous)
      }

      onOpenChange(false)
    } catch (err) {
      toast.error('Could not upload that photo', humanError(err))
    } finally {
      setBusy(false)
      setPreview(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function pickEmoji(emoji: string) {
    const previous = employee.avatar_path
    setBusy(true)
    try {
      // The RPC clears avatar_path, so the stored file is now orphaned.
      await setEmoji.mutateAsync(employee.avatar_emoji === emoji ? null : emoji)
      if (previous) {
        await supabase.storage.from(AVATAR_BUCKET).remove([previous])
        forgetAvatarUrl(previous)
      }
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not set that emoji', humanError(err))
    } finally {
      setBusy(false)
    }
  }

  async function removePhoto() {
    const previous = employee.avatar_path
    setBusy(true)
    try {
      await setAvatar.mutateAsync(null)
      if (employee.avatar_emoji) await setEmoji.mutateAsync(null)
      if (previous) {
        await supabase.storage.from(AVATAR_BUCKET).remove([previous])
        forgetAvatarUrl(previous)
      }
      onOpenChange(false)
    } catch (err) {
      toast.error('Could not remove the photo', humanError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title="Your avatar"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
          {employee.avatar_path || employee.avatar_emoji ? (
            <Button variant="secondary" onClick={() => void removePhoto()} loading={busy}>
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          ) : null}
          <Button onClick={() => fileInput.current?.click()} loading={busy}>
            <ImageUp className="h-4 w-4" />
            {employee.avatar_path ? 'Replace' : 'Choose a photo'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 py-2">
        {preview ? (
          <img
            src={preview}
            alt=""
            className="h-20 w-20 shrink-0 rounded-full object-cover"
          />
        ) : (
          <Avatar
            fullName={employee.full_name}
            avatarPath={employee.avatar_path}
            avatarEmoji={employee.avatar_emoji}
            size="xl"
          />
        )}

        <div className="text-center">
          <p className="text-sm font-medium text-slate-800">{employee.full_name}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Pick an emoji below, or upload a photo — JPEG, PNG or WebP up to 2 MB, square
            works best. Colleagues who can already see your name can see it; nobody outside the
            app can.
          </p>
        </div>

        {/* Offered before the upload, not after: most people will pick one
            of these rather than find, crop and upload a photograph. */}
        <div className="w-full border-t border-slate-100 pt-3">
          <p className="mb-2 text-center text-xs font-medium text-slate-600">
            Or choose an emoji instead
          </p>
          <div className="flex flex-wrap justify-center gap-1">
            {AVATAR_EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                disabled={busy}
                onClick={() => void pickEmoji(e)}
                aria-label={`Use ${e} as your avatar`}
                className={cn(
                  'grid h-9 w-9 place-items-center rounded-full text-xl transition-colors',
                  'hover:bg-chai-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chai-500',
                  employee.avatar_emoji === e && 'bg-chai-100 ring-2 ring-chai-600',
                  busy && 'opacity-50',
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED.join(',')}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
          }}
        />
      </div>
    </Dialog>
  )
}
