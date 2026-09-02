import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { initials } from '@/lib/format'
import { cn } from '@/lib/cn'

export const AVATAR_BUCKET = 'avatars'

/**
 * Signed URLs, cached for the lifetime of the tab.
 *
 * The avatars bucket is private, so every photo needs a signed URL. Without a
 * cache, a list of 70 staff would mint 70 signatures on every render — and
 * again on every re-render. Keyed on the object path, which changes whenever
 * somebody uploads a new photo, so a stale face cannot stick around.
 */
const urlCache = new Map<string, Promise<string | null>>()

function signedUrlFor(path: string): Promise<string | null> {
  const cached = urlCache.get(path)
  if (cached) return cached

  const promise = supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, 60 * 60)
    .then(({ data, error }) => (error ? null : (data?.signedUrl ?? null)))
    .catch(() => null)

  urlCache.set(path, promise)
  return promise
}

/** Drop a cached signature, so a freshly uploaded photo is fetched again. */
export function forgetAvatarUrl(path: string | null | undefined) {
  if (path) urlCache.delete(path)
}

const SIZES = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-12 w-12 text-sm',
  xl: 'h-20 w-20 text-xl',
} as const

/**
 * A person's photo, falling back to their initials.
 *
 * Initials are not a placeholder to be ashamed of: most staff will never
 * upload anything, and a coloured monogram identifies a row perfectly well.
 */
export function Avatar({
  fullName,
  avatarPath,
  avatarEmoji,
  size = 'md',
  className,
}: {
  fullName: string
  avatarPath?: string | null
  avatarEmoji?: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!avatarPath) {
      setUrl(null)
      return
    }
    let live = true
    void signedUrlFor(avatarPath).then((u) => {
      if (live) setUrl(u)
    })
    return () => {
      live = false
    }
  }, [avatarPath])

  const shell = cn(
    'relative grid shrink-0 place-items-center overflow-hidden rounded-full',
    'bg-chai-100 font-semibold text-chai-800',
    SIZES[size],
    className,
  )

  return (
    <span className={shell} aria-hidden>
      {url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          // A signature that has expired, or a deleted file, should show the
          // monogram rather than a broken-image icon.
          onError={() => setUrl(null)}
        />
      ) : avatarEmoji ? (
        // Sized off the container so one component covers the 7px monogram and
        // the 20px dialog preview without a second set of classes.
        <span className="text-[1.6em] leading-none">{avatarEmoji}</span>
      ) : (
        initials(fullName)
      )}
    </span>
  )
}
