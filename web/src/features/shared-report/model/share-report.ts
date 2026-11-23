import { subDays } from 'date-fns'

import type {
  PublicReport,
  SharedReport,
  SharedReportCreate,
} from '@/entities/shared-report'

import { routes } from '@/routes'
import { fromDay, toApiDateRange, toDay } from '@/shared'

/** What a page offers to share: its period and filters, before a title. */
export type ReportDraft = Omit<SharedReportCreate, 'title' | 'showAmounts'>

type DraftSource = {
  /** Reader's days, both ends included. */
  range: { from: string; to: string }
  /** The page's project filter; empty is every project it shows. */
  projectIds: string[]
  userIds?: string[]
  /** Every project the reader may see, which an empty filter stands for. */
  visibleProjectIds: string[]
  timeZone: string
}

/**
 * The report a page's filters describe. "Every project" is fixed to the
 * projects there are today, so the report does not grow as projects are
 * added. Nothing to share when the reader has no project at all.
 */
export const toReportDraft = ({
  range,
  projectIds,
  userIds,
  visibleProjectIds,
  timeZone,
}: DraftSource): ReportDraft | null => {
  const projects = projectIds.length > 0 ? projectIds : visibleProjectIds

  if (projects.length === 0) {
    return null
  }

  return {
    ...toApiDateRange(range),
    timeZone,
    projectIds: projects,
    ...(userIds?.length ? { userIds } : {}),
  }
}

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
