import { describe, expect, it } from 'vitest'

import {
  detailPendingReview,
  invoiceable,
  invoiced,
  phoneTimeAllowed,
  published,
  reviewEnded,
  seesDetail,
  type CoveringInvoice,
} from '../src/index'

const HOUR = 3_600_000
const NOW = Date.parse('2026-11-25T12:00:00Z')
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString()

const project = { ownerId: 'owner', reviewWindowHours: 24 }
const entry = (hoursAgo: number, fields: Record<string, unknown> = {}) => ({
  projectId: 'project',
  authorId: 'worker',
  fromAt: ago(hoursAgo + 0.5),
  toAt: ago(hoursAgo),
  publishedAt: null,
  invoiceId: null,
  isPaid: false,
  ...fields,
})

describe('reviewEnded', () => {
  it('ends the window exactly its hours after the entry ends', () => {
    expect(reviewEnded(ago(24), 24, NOW)).toBe(true)
    expect(reviewEnded(ago(23.9), 24, NOW)).toBe(false)
  })

  it('takes 24 hours for a project that never set a window', () => {
    expect(reviewEnded(ago(24), null, NOW)).toBe(true)
    expect(reviewEnded(ago(23), undefined, NOW)).toBe(false)
  })
})

describe('published', () => {
  it('is published once released, invoiced, or past review', () => {
    expect(published(entry(1), project, NOW)).toBe(false)
    expect(published(entry(1, { publishedAt: ago(0) }), project, NOW)).toBe(
      true,
    )
    expect(published(entry(1, { invoiceId: 'i' }), project, NOW)).toBe(true)
    expect(published(entry(72), project, NOW)).toBe(true)
  })
})

describe('seesDetail', () => {
  it('shows the author their own detail before review', () => {
    expect(seesDetail(entry(1), project, 'worker', NOW)).toBe(true)
  })

  it('holds a worker’s detail from the owner until it is published', () => {
    expect(seesDetail(entry(1), project, 'owner', NOW)).toBe(false)
    expect(detailPendingReview(entry(1), project, 'owner', NOW)).toBe(true)
    expect(seesDetail(entry(72), project, 'owner', NOW)).toBe(true)
    expect(detailPendingReview(entry(72), project, 'owner', NOW)).toBe(false)
  })

  it('never shows anyone else’s detail to a viewer or another worker', () => {
    expect(seesDetail(entry(72), project, 'viewer', NOW)).toBe(false)
    expect(detailPendingReview(entry(1), project, 'viewer', NOW)).toBe(false)
  })
})

describe('invoiced', () => {
  const invoice = (fields: Partial<CoveringInvoice> = {}): CoveringInvoice => ({
    id: 'invoice',
    projectId: 'project',
    authorId: 'worker',
    rejected: false,
    legacy: false,
    fromAt: ago(10),
    toAt: ago(0),
    ...fields,
  })

  it('is invoiced when an invoice of its author bills it', () => {
    expect(invoiced(entry(1, { invoiceId: 'invoice' }), [invoice()])).toBe(true)
  })

  it('is not invoiced once that invoice is rejected', () => {
    expect(
      invoiced(entry(1, { invoiceId: 'invoice' }), [
        invoice({ rejected: true }),
      ]),
    ).toBe(false)
  })

  it('is covered by an invoice from before frozen lines by its period alone', () => {
    expect(invoiced(entry(1), [invoice({ legacy: true })])).toBe(true)
    expect(invoiced(entry(1), [invoice()])).toBe(false)
    expect(invoiced(entry(20), [invoice({ legacy: true })])).toBe(false)
  })

  it('is not covered by someone else’s invoice, but is by one with no issuer kept', () => {
    expect(
      invoiced(entry(1), [invoice({ legacy: true, authorId: 'owner' })]),
    ).toBe(false)
    expect(
      invoiced(entry(1), [invoice({ legacy: true, authorId: null })]),
    ).toBe(true)
  })

  it('is not covered by an invoice on another project', () => {
    expect(
      invoiced(entry(1, { invoiceId: 'invoice' }), [
        invoice({ projectId: 'other' }),
      ]),
    ).toBe(false)
  })
})

describe('invoiceable', () => {
  it('bills the issuer’s own entry on no invoice and not paid', () => {
    expect(invoiceable(entry(1), 'worker')).toBe(true)
    expect(invoiceable(entry(1), 'owner')).toBe(false)
    expect(invoiceable(entry(1, { invoiceId: 'i' }), 'worker')).toBe(false)
    expect(invoiceable(entry(1, { isPaid: true }), 'worker')).toBe(false)
  })

  it('with a period, bills only an entry wholly inside it', () => {
    const period = { from: ago(2), to: ago(0) }

    expect(invoiceable(entry(1), 'worker', period)).toBe(true)
    expect(invoiceable(entry(1.75), 'worker', period)).toBe(false)
  })
})

describe('phoneTimeAllowed', () => {
  it('takes phone time while the owner allows it', () => {
    expect(phoneTimeAllowed({ allowMobileTime: true }, ago(1))).toBe(true)
  })

  it('takes time that started before the owner turned it off, and nothing after', () => {
    const off = { allowMobileTime: false, mobileTimeOffAt: ago(2) }

    expect(phoneTimeAllowed(off, ago(3))).toBe(true)
    expect(phoneTimeAllowed(off, ago(1))).toBe(false)
    expect(phoneTimeAllowed({ allowMobileTime: false }, ago(3))).toBe(false)
  })
})
