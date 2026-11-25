/** How long a tab gets to close itself before we navigate it instead. */
export const CLOSE_GRACE_MS = 300

type ExitWindow = {
  opener: { closed: boolean } | null
  close: () => void
  location: { replace: (url: string) => void }
  setTimeout: (handler: () => void, timeout: number) => unknown
}

/**
 * The page to return to, when `/connect` was opened by the website. Only an
 * exact match on a configured origin counts: this value ends up in a redirect,
 * so anything else is treated as no return address at all, which leaves the
 * page behaving as it does for the desktop time tracker.
 */
export const parseWebsiteReturn = (
  raw: string | null,
  allowedOrigins: readonly string[],
): string | null => {
  if (!raw) {
    return null
  }

  try {
    const url = new URL(raw)

    if (url.username || url.password) {
      return null
    }

    return allowedOrigins.includes(url.origin) ? url.href : null
  } catch {
    return null
  }
}

/** The website tab that opened this one is still there to go back to. */
const hasLiveOpener = ({ opener }: ExitWindow): boolean =>
  Boolean(opener && !opener.closed)

/**
 * Close the confirmation tab when the original tab is still open. If the
 * browser keeps this tab open, go back to the page that started the request.
 */
export const returnToWebsite = (win: ExitWindow, returnTo: string): void => {
  if (!hasLiveOpener(win)) {
    win.location.replace(returnTo)
    return
  }

  win.close()
  win.setTimeout(() => win.location.replace(returnTo), CLOSE_GRACE_MS)
}
