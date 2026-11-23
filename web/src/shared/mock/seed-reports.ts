/**
 * The reports a demo world opens with, so the Reports page shows each kind
 * before the visitor shares one of their own:
 *
 * - everything they see, for a week;
 * - one project for four weeks, with its amounts;
 * - their own week on a project, still to invoice;
 * - a week an invoice was made from.
 *
 * Each is kept as sharing it would keep it (`shareReport`): fixed to the
 * projects its query reaches, with amounts left off where the visitor may not
 * see money. Ids and links are the same every day, so a link opened yesterday
 * still opens; the periods move with today.
 */
import { seeded } from './random'
import { demoDataKey, type DemoSettings } from './settings'
import { roleOf } from './shape'
import { statisticsScope, type StatisticsQuery } from './statistics'

import type { Db, MockReport, MockTime } from './db'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

const KINDS = ['week', 'project', 'own', 'invoiced'] as const

type Draft = {
  kind: (typeof KINDS)[number]
  title: string
  createdAt: number
  query: StatisticsQuery
  showAmounts: boolean
  invoiceId?: string
}

/** The day an instant falls on, on the visitor's own calendar. */
function localDay(at: number): string {
  const date = new Date(at)
  const pad = (part: number) => String(part).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Midnight today on the visitor's calendar, moved by whole days. */
function dayStart(now: number, offset = 0): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offset)

  return date.getTime()
}

/** The project most of these entries are on. */
function busiest(times: MockTime[]): string | null {
  const counts = new Map<string, number>()
  for (const time of times) {
    counts.set(time.projectId, (counts.get(time.projectId) ?? 0) + 1)
  }

  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

export function seedReports(
  db: Db,
  settings: DemoSettings,
  now: number,
): MockReport[] {
  const meId = db.meId
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const span = (days: number) => ({
    from: localDay(dayStart(now, 1 - days)),
    to: localDay(dayStart(now, 1)),
    timeZone,
  })
  const scopeOf = (query: StatisticsQuery) => {
    try {
      return statisticsScope(db, meId, query, now)
    } catch {
      // A query this visitor may not ask is a report they could not share.
      return null
    }
  }
  const visible = new Set(
    scopeOf(span(7))?.projects.map((project) => project.id),
  )
  const projectOf = (projectId: string) =>
    db.projects.find((project) => project.id === projectId)
  const titleOf = (projectId: string) => projectOf(projectId)?.title ?? ''
  // What a report of theirs would count: a worker's own time, else everyone's.
  const seen = db.times.filter((time) => {
    const project = visible.has(time.projectId) && projectOf(time.projectId)

    return (
      project && (roleOf(project, meId) !== 'worker' || time.userId === meId)
    )
  })
  /** The visitor alone: an owner names themself, a worker's time is theirs anyway. */
  const alone = (projectId: string) => {
    const project = projectOf(projectId)

    return project && roleOf(project, meId) === 'owner' ? [meId] : []
  }

  const drafts: Draft[] = [
    {
      kind: 'week',
      title: 'Weekly update',
      createdAt: now - 2 * HOUR_MS,
      query: span(7),
      showAmounts: false,
    },
  ]

  // The last seven days are not invoiced yet, so this one can still be.
  const own = busiest(
    seen.filter(
      (time) =>
        time.userId === meId && Date.parse(time.fromAt) >= dayStart(now, -6),
    ),
  )
  // Another project than their own week's, where they have one.
  const lately = seen.filter(
    (time) => Date.parse(time.fromAt) >= dayStart(now, -27),
  )
  const project =
    busiest(lately.filter((time) => time.projectId !== own)) ?? busiest(lately)
  if (project) {
    drafts.push({
      kind: 'project',
      title: `${titleOf(project)}: four weeks`,
      createdAt: now - 27 * HOUR_MS,
      query: { ...span(28), projectIds: [project] },
      showAmounts: true,
    })
  }
  if (own) {
    drafts.push({
      kind: 'own',
      title: `My hours on ${titleOf(own)}`,
      createdAt: now - 2 * DAY_MS,
      query: { ...span(7), projectIds: [own], userIds: alone(own) },
      showAmounts: true,
    })
  }

  const invoice = db.invoices
    .filter(
      (row) =>
        row.userId === meId &&
        row.state !== 'REJECTED' &&
        visible.has(row.projectId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (invoice) {
    drafts.push({
      kind: 'invoiced',
      title: `${titleOf(invoice.projectId)}: invoiced week`,
      createdAt: Date.parse(invoice.createdAt) - 60_000,
      query: {
        from: localDay(Date.parse(invoice.fromAt)),
        to: localDay(dayStart(Date.parse(invoice.toAt), 1)),
        timeZone,
        projectIds: [invoice.projectId],
        userIds: alone(invoice.projectId),
      },
      showAmounts: true,
      invoiceId: invoice.id,
    })
  }

  // Drawn for every kind, so one a world lacks never moves another's link.
  const f = seeded(`${demoDataKey(settings)}:reports`)
  const links = new Map(
    KINDS.map((kind) => [
      kind,
      { id: f.string.uuid(), token: f.string.alphanumeric(43) },
    ]),
  )

  return drafts.flatMap((draft) => {
    const scope = scopeOf(draft.query)

    if (!scope || scope.projects.length === 0) {
      return []
    }

    return [
      {
        ...links.get(draft.kind)!,
        createdAt: new Date(draft.createdAt).toISOString(),
        userId: meId,
        title: draft.title,
        from: draft.query.from,
        to: draft.query.to,
        timeZone,
        projectIds: scope.projects.map((row) => row.id),
        userIds: draft.query.userIds ?? [],
        showAmounts: draft.showAmounts && scope.viewers.size === 0,
        invoiceId: draft.invoiceId ?? null,
      },
    ]
  })
}
