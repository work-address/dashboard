import { subDays } from 'date-fns'

import type {
  PublicReport,
  SharedReport,
  SharedReportCreate,
} from '@/entities/shared-report'
import type { StatisticsQuery } from '@/entities/statistics'

import { routes } from '@/routes'
import { fromDay, toDay } from '@/shared'

/** What a page offers to share: its period and filters, before a title. */
export type ReportDraft = Omit<SharedReportCreate, 'title' | 'showAmounts'>

/**
 * The report a page's own statistics query describes: the same period and
 * filters, without what only a chart's request carries. The server judges
 * it by the rule it judges the page's reads by, so whatever the page shows
 * can be shared; with no project named, the server fixes "every project".
 */
export const toReportDraft = (
  query: StatisticsQuery | null | undefined,
): ReportDraft | null =>
  query
    ? {
        from: query.from,
        to: query.to,
        timeZone: query.timeZone,
        ...(query.projectIds?.length ? { projectIds: query.projectIds } : {}),
        ...(query.userIds?.length ? { userIds: query.userIds } : {}),
      }
    : null

/** The link anyone can open, independent of the page it was made on. */
export const getReportUrl = (origin: string, token: string): string =>
  new URL(routes.report.build({ token }), origin).toString()

/** A report's days as people read them: both ends included. */
export const getReportDays = (
  report: Pick<SharedReport | PublicReport | ReportDraft, 'from' | 'to'>,
): { from: string; to: string } => ({
  from: report.from,
  to: toDay(subDays(fromDay(report.to), 1)),
})

/** "Acme" or "Acme and 2 more": what a report is called until it is given a title. */
export const getReportProjectsLabel = (
  projectIds: string[],
  titles: Map<string, string>,
  more: (count: number) => string,
  fallback: string,
): string => {
  const known = projectIds
    .map((id) => titles.get(id))
    .filter((title): title is string => Boolean(title))

  if (known.length === 0) {
    return fallback
  }

  return known.length === 1 ? known[0] : `${known[0]} ${more(known.length - 1)}`
}
