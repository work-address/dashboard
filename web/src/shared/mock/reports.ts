/**
 * Shared reports, on the terms of the API's `SharedReportManager`: what a
 * reader may share, what the link shows anyone, and when a report can be
 * billed. Only the span, the filters and the link's secret are kept; the
 * figures are read from `statistics.ts`, in the sharer's scope, each time the
 * link is opened. The demo has no addresses to count, so nothing here limits
 * how often a link is opened.
 */
import { zonedMidnight } from '@work-address/statistics-core'

import { projectOf, roleOf, userOf } from './shape'
import {
  DemoHttpError,
  hidden,
  remainingScope,
  sharedFigures,
  statisticsScope,
  type StatisticsQuery,
} from './statistics'
import { saveRow } from './store'

import type { Db, MockReport } from './db'

/** What `SharedReportCreateDto` takes, and nothing else. */
const FIELDS = new Set([
  'title',
  'from',
  'to',
  'timeZone',
  'projectIds',
  'userIds',
  'showAmounts',
])

const queryOf = (
  report: Pick<
    MockReport,
    'from' | 'to' | 'timeZone' | 'projectIds' | 'userIds'
  >,
): StatisticsQuery => ({
  from: report.from,
  to: report.to,
  timeZone: report.timeZone,
  projectIds: report.projectIds,
  userIds: report.userIds,
})

/** 32 random bytes as base64url, like the API's. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))

  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/**
 * The invoice a report remembers, while the demo still has it: a day's
 * invoices are drawn again at midnight, and a report outlives them.
 */
const invoiceIdOf = (db: Db, report: MockReport) =>
  db.invoices.some((invoice) => invoice.id === report.invoiceId)
    ? report.invoiceId
    : null

/**
 * A report of the sharer's own time on one project, not yet invoiced: a
 * worker's is their own time whatever it names, an owner's only when it names
 * them alone.
 */
function canInvoice(db: Db, report: MockReport): boolean {
  if (invoiceIdOf(db, report) || report.projectIds.length !== 1) {
    return false
  }
  const project = projectOf(db, report.projectIds[0])
  const role = project ? roleOf(project, report.userId) : null

  return (
    role === 'worker' ||
    (role === 'owner' &&
      report.userIds.length === 1 &&
      report.userIds[0] === report.userId)
  )
}

/** A report as its sharer reads it back, with the link's secret. */
export const reportView = (db: Db, report: MockReport) => ({
  id: report.id,
  token: report.token,
  title: report.title,
  from: report.from,
  to: report.to,
  timeZone: report.timeZone,
  projectIds: report.projectIds,
  userIds: report.userIds,
  showAmounts: report.showAmounts,
  createdAt: report.createdAt,
  invoiceId: invoiceIdOf(db, report),
  canInvoice: canInvoice(db, report),
})

/** What the body asks to share, or the API's 400 for a body it would refuse. */
function reportDraft(body: Record<string, unknown>) {
  const { title, from, to, timeZone, projectIds, userIds, showAmounts } = body
  const ids = (value: unknown, least: number): value is string[] =>
    Array.isArray(value) &&
    value.length >= least &&
    value.length <= 100 &&
    value.every((id) => typeof id === 'string' && id.length > 0)
  const day = (value: unknown): value is string =>
    typeof value === 'string' && value.length <= 10
  const named =
    title == null ||
    (typeof title === 'string' &&
      title.length <= 120 &&
      !/[<>\p{Cc}]/u.test(title))

  if (
    !Object.keys(body).every((key) => FIELDS.has(key)) ||
    !named ||
    !day(from) ||
    !day(to) ||
    typeof timeZone !== 'string' ||
    timeZone.length > 64 ||
    !ids(projectIds, 1) ||
    !(userIds == null || ids(userIds, 0)) ||
    !(showAmounts == null || typeof showAmounts === 'boolean')
  ) {
    throw new DemoHttpError(400, 'Invalid body, check the errors property')
  }

  return {
    title: (title as string | undefined)?.trim() || null,
    from,
    to,
    timeZone,
    projectIds: [...new Set(projectIds)],
    userIds: [...new Set(userIds ?? [])],
    showAmounts: showAmounts === true,
  }
}

/**
 * Shares a span of what the sharer sees. Whatever statistics would refuse
 * this reader is refused here, and amounts are refused to a sharer who may
 * not see money on one of the projects.
 */
export function shareReport(
  db: Db,
  meId: string,
  body: Record<string, unknown>,
  now = Date.now(),
) {
  const draft = reportDraft(body)
  const scope = statisticsScope(db, meId, queryOf(draft), now)

  if (draft.showAmounts && scope.viewers.size > 0) {
    throw new DemoHttpError(
      403,
      'Access error: Amounts can be shared only for projects you own or work on',
    )
  }

  return reportView(
    db,
    saveRow<MockReport>('reports', {
      ...draft,
      id: crypto.randomUUID(),
      createdAt: new Date(now).toISOString(),
      userId: meId,
      token: newToken(),
      invoiceId: null,
    }),
  )
}

/** The sharer's own reports, newest first. */
export const listReports = (db: Db, meId: string) =>
  db.reports
    .filter((report) => report.userId === meId)
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    )
    .map((report) => reportView(db, report))

/** A report of this sharer's; anyone else's is refused, as the API refuses it. */
export function ownReport(db: Db, meId: string, id: string): MockReport {
  const report = db.reports.find((row) => row.id === id)

  if (!report) {
    throw new DemoHttpError(404, 'Report not found')
  }
  if (report.userId !== meId) {
    throw new DemoHttpError(403, 'Access error: The report is not yours')
  }

  return report
}

/** The instants an invoice of the report's period spans: its days in its zone. */
export const reportPeriod = (report: MockReport) => ({
  fromUnix: zonedMidnight(report.from, report.timeZone),
  toUnix: zonedMidnight(report.to, report.timeZone),
})

/**
 * What the link answers anyone: the report read now, in the sharer's scope as
 * it is now. Not found once the sharer sees none of its projects; gone while a
 * project owner's plan hides part of its span. Whoever asks is never read.
 */
export function openReport(db: Db, token: string, now = Date.now()) {
  const report = db.reports.find((row) => row.token === token)
  const sharer = report && userOf(db, report.userId)
  const scope =
    report && sharer && remainingScope(db, sharer.id, queryOf(report), now)

  if (!report || !sharer || !scope) {
    throw new DemoHttpError(404, 'Report not found')
  }
  if (hidden(scope).hiddenBefore) {
    throw new DemoHttpError(
      410,
      'This report reaches past what the plan keeps',
      'retention',
    )
  }

  return {
    title: report.title,
    sharedBy: sharer.name || sharer.address,
    from: report.from,
    to: report.to,
    timeZone: report.timeZone,
    createdAt: report.createdAt,
    ...sharedFigures(scope, report.showAmounts),
  }
}
