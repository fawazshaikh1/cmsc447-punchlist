import { useEffect, useState } from 'react';

import { useServices } from '../ServiceContainer';

/**
 * Resolves a media key to a URL, re-rendering once it is ready.
 *
 * Returns `{ url, loading }`. A null url with `loading: false` means the photo
 * is genuinely not in the store — the caller should draw a placeholder rather
 * than a spinner, because waiting longer will not help.
 *
 * The cache owns the URL's lifetime, so this hook deliberately does NOT revoke
 * on unmount: the same photo is usually on screen somewhere else, and revoking
 * here would break it. See MediaUrlCache.
 *
 * @param {string|null|undefined} key
 */
export function useMediaUrl(key) {
  const { mediaUrls } = useServices();

  // Seeded synchronously from the cache so a photo that is already loaded
  // paints on the first frame — without this, switching sheets makes every
  // photo flash its placeholder before reappearing.
  const [url, setUrl] = useState(() => (key ? mediaUrls.peek(key) : null));
  const [loading, setLoading] = useState(() => Boolean(key) && !mediaUrls.peek(key));

  useEffect(() => {
    if (!key) {
      setUrl(null);
      setLoading(false);
      return undefined;
    }

    const cached = mediaUrls.peek(key);
    if (cached) {
      setUrl(cached);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    void mediaUrls.load(key).then((resolved) => {
      // The key can change while a read is in flight — a user flicking between
      // sheets. Applying a stale result would show one photo in another's frame.
      if (cancelled) return;
      setUrl(resolved);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [key, mediaUrls]);

  return { url, loading };
}
