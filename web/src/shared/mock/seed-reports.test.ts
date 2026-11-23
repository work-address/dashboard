import { describe, expect, it } from 'vitest'

import { buildDb } from './db'
import { openReport, reportView } from './reports'
import { seedReports } from './seed-reports'
import {
  DEFAULT_DEMO_SETTINGS,
  type DemoRole,
  type DemoSettings,
  type DemoWorldId,
} from './settings'

// Wednesday, 21 October 2026, mid-afternoon.
const NOW = new Date(2026, 9, 21, 15, 30).getTime()
const DAY_MS = 86_400_000

const world = (
  id: DemoWorldId,
  role: DemoRole = 'owner',
  patch: Partial<DemoSettings> = {},
  now = NOW,
) => {
  const settings = { ...DEFAULT_DEMO_SETTINGS, world: id, role, ...patch }
  const db = buildDb(settings, now)
  db.reports = seedReports(db, settings, now)

  return db
}

const status = (read: () => unknown) => {
  try {
    read()
    return 200
  } catch (error) {
    return (error as { status?: number }).status
  }
}

/** The reports a demo world opens with (`seed-reports.ts`). */
describe('the reports a demo world opens with', () => {
  it('gives an owner one of each kind, all shared before now', () => {
    const db = world('typical')
    const views = db.reports.map((report) => reportView(db, report))

    expect(views.map((view) => view.title)).toEqual([
      'Weekly update',
      expect.stringMatching(/: four weeks$/),
      expect.stringMatching(/^My hours on /),
      expect.stringMatching(/: invoiced week$/),
    ])
    expect(db.reports.every((report) => report.userId === db.meId)).toBe(true)
    expect(views.every((view) => Date.parse(view.createdAt) < NOW)).toBe(true)

    const [week, project, own, invoiced] = views

    // Everything the owner sees, with no amounts; one project with them.
    expect(week.projectIds.length).toBeGreaterThan(1)
    expect(week.showAmounts).toBe(false)
    expect(project.projectIds).toHaveLength(1)
    expect(project.showAmounts).toBe(true)

    // Only the owner's own uninvoiced week can become an invoice.
    expect(views.map((view) => view.canInvoice)).toEqual([
      false,
      false,
      true,
      false,
    ])
    expect(own.userIds).toEqual([db.meId])
    expect(own.invoiceId).toBeNull()
    expect(db.invoices.map((invoice) => invoice.id)).toContain(
      invoiced.invoiceId,
    )
  })

  it('opens every link, with time in it, whoever the visitor is', () => {
    for (const role of ['owner', 'worker', 'viewer', 'mixed'] as const) {
      const db = world('typical', role)

      expect(db.reports.length, role).toBeGreaterThan(1)
      for (const report of db.reports) {
        const opened = openReport(db, report.token, NOW)

        expect(opened.title).toBe(report.title)
        expect(opened.daily.length, `${role}: ${report.title}`).toBeGreaterThan(
          0,
        )
      }
    }
  })

  it('shows a viewer no amounts and nothing to invoice', () => {
    const db = world('typical', 'viewer')
    const views = db.reports.map((report) => reportView(db, report))

    expect(views.length).toBeGreaterThan(0)
    expect(views.some((view) => view.showAmounts)).toBe(false)
    expect(views.some((view) => view.canInvoice || view.invoiceId)).toBe(false)
  })

  it('gives a worker their own week to invoice', () => {
    const db = world('typical', 'worker')
    const views = db.reports.map((report) => reportView(db, report))

    expect(views.some((view) => view.canInvoice)).toBe(true)
    expect(views.some((view) => view.invoiceId)).toBe(true)
  })

  it('has none where there is nothing to share', () => {
    expect(world('empty').reports).toEqual([])
  })

  it('keeps each link from day to day and moves its period', () => {
    const today = world('typical').reports
    const tomorrow = world('typical', 'owner', {}, NOW + DAY_MS).reports

    expect(tomorrow.map(({ id, token }) => [id, token])).toEqual(
      today.map(({ id, token }) => [id, token]),
    )
    expect(tomorrow[0].from).not.toBe(today[0].from)
    expect(today[0].token).toMatch(/^[\w-]{43}$/)
  })

  it('ends the four-week link on the free plan and keeps the week', () => {
    const db = world('typical', 'owner', { plan: 'free' })
    const [week, project] = db.reports

    expect(status(() => openReport(db, week.token, NOW))).toBe(200)
    expect(status(() => openReport(db, project.token, NOW))).toBe(410)
  })
})
