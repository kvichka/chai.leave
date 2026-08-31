import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Reads ?request=<uuid> and scrolls that row into view once it has rendered.
 *
 * Arriving from a notification onto a page of forty rows, with no indication of
 * which one you were sent for, is barely better than not linking at all.
 *
 * `ready` should be false while the list is still loading - the element cannot
 * be found before it exists.
 */
export function useHighlightedRequest(ready: boolean): string | null {
  const [params] = useSearchParams()
  const id = params.get('request')

  useEffect(() => {
    if (!id || !ready) return
    // One frame, so the row is painted before we measure it.
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-request-id="${CSS.escape(id)}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [id, ready])

  return id
}

/** Ring applied to the row a notification pointed at. */
export const HIGHLIGHT_CLASS = 'ring-2 ring-inset ring-chai-400 bg-chai-50/70'
