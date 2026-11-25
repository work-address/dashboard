import { describe, expect, it, vi } from 'vitest'

import {
  CLOSE_GRACE_MS,
  parseWebsiteReturn,
  returnToWebsite,
} from './website-return'

const ALLOWED = ['https://address.work', 'http://localhost:3000']
const RETURN_TO = 'https://address.work/en/jobs/123/'

describe('parseWebsiteReturn', () => {
  it('keeps the whole page address on an allowed origin', () => {
    const page = 'https://address.work/en/jobs/123/?tab=apply#salary'

    expect(parseWebsiteReturn(page, ALLOWED)).toBe(page)
    expect(parseWebsiteReturn('http://localhost:3000/en/', ALLOWED)).toBe(
      'http://localhost:3000/en/',
    )
  })

  it.each([
    ['nothing', null],
    ['an empty value', ''],
    ['another site', 'https://evil.example/'],
    ['a lookalike subdomain', 'https://address.work.evil.example/'],
    ['a sibling subdomain', 'https://app.address.work/'],
    ['the allowed host as a username', 'https://address.work@evil.example/'],
    ['credentials on the allowed host', 'https://user:pass@address.work/'],
    ['the wrong scheme', 'http://address.work/'],
    ['the wrong port', 'https://address.work:8443/'],
    ['a script URL', 'javascript:alert(1)'],
    ['a protocol-relative path', '//evil.example/'],
    ['a relative path', '/en/'],
    ['something unparseable', 'not a url'],
  ])('refuses %s', (_label, raw) => {
    expect(parseWebsiteReturn(raw, ALLOWED)).toBeNull()
  })
})

const fakeWindow = (opener: { closed: boolean } | null) => ({
  opener,
  close: vi.fn(),
  location: { replace: vi.fn() },
  setTimeout: vi.fn((handler: () => void, _timeout: number) => handler),
})

describe('returnToWebsite', () => {
  it('closes the tab when the website tab is still open', () => {
    const win = fakeWindow({ closed: false })

    returnToWebsite(win, RETURN_TO)

    expect(win.close).toHaveBeenCalledOnce()
    expect(win.location.replace).not.toHaveBeenCalled()
  })

  it('goes to the return page when the website tab has been closed', () => {
    const win = fakeWindow({ closed: true })

    returnToWebsite(win, RETURN_TO)

    expect(win.close).not.toHaveBeenCalled()
    expect(win.setTimeout).not.toHaveBeenCalled()
    expect(win.location.replace).toHaveBeenCalledWith(RETURN_TO)
  })

  it('goes to the return page when this tab has no opener', () => {
    const win = fakeWindow(null)

    returnToWebsite(win, RETURN_TO)

    expect(win.close).not.toHaveBeenCalled()
    expect(win.setTimeout).not.toHaveBeenCalled()
    expect(win.location.replace).toHaveBeenCalledWith(RETURN_TO)
  })

  it('goes to the return page when the browser refuses to close the tab', () => {
    const win = fakeWindow({ closed: false })

    returnToWebsite(win, RETURN_TO)

    expect(win.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      CLOSE_GRACE_MS,
    )
    win.setTimeout.mock.calls[0][0]()
    expect(win.location.replace).toHaveBeenCalledWith(RETURN_TO)
  })
})
