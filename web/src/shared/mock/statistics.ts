/**
 * The `/statistics/*` routes over the demo database, on the API's terms
 * (`StatisticsManager`, `StatisticsRepository`): the same scope, the same
 * visibility per role, the same review window. The rules the API keeps in
 * code - scope, report permissions, focus, hours, assisted time - come from the
 * shared package. What the API computes in SQL is checked instead: the scenarios
 * in packages/api-contract run against both. Window titles and gaps stay empty,
 * because the demo's seed has no data to draw them from.
 */
import {
  StatisticsInsights,
  TimeSpans,
  hiddenHistory,
  projectsForPeople,
  refusesQuery,
  refusesReport,
  zonedMidnight,
  zonedParts,
  type ReaderRole,
  type Span,
} from '@work-address/statistics-core'

import {
  agentIdOf,
  hasDetail,
  isInvoiced,
  isOwner,
  isPublished,
  isWorker,
  ownerPremium,
  projectOf,
  roleOf,
  userOf,
  visibleProjects,
} from './shape'

import type { Db, MockProject, MockTime } from './db'

export type StatisticsQuery = {
  projectIds?: string[]
  userIds?: string[]
  from: string
  to: string
  timeZone: string
  invoiceId?: string
  app?: string
  bucket?: 'day' | 'hour'
  /** Read by `agents/daily` alone. The demo's ids: `agentIdOf` in shape.ts. */
  agentIds?: string[]
}

/** A refusal with the status the API would answer. */
export class DemoHttpError extends Error {
  status: number
  /** Why, where the API's answer says so: a shared report a plan hides. */
  reason?: string

  constructor(status: number, message: string, reason?: string) {
    super(message)
    this.status = status
    this.reason = reason
  }
}

type Scope = {
  db: Db
  meId: string
  query: StatisticsQuery
  projects: MockProject[]
  from: number
  to: number
  owners: Set<string>
  viewers: Set<string>
  now: number
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** `FREE_RETENTION_DAYS` in the API's model/plan.ts. */
const FREE_RETENTION_MS = 14 * 86_400_000

/** Whether a report is refused to this scope's reader. */
export const reportRefused = (scope: Scope, kind: string) =>
  refusesReport(
    kind,
    scope.projects.map((project) => roleOf(project, scope.meId)),
  )

/** The query's days as instants in its time zone, or the API's refusal. */
function period(query: StatisticsQuery): { from: number; to: number } {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: query.timeZone })
  } catch {
    throw new DemoHttpError(400, 'Invalid timezone')
  }
  if (!DAY.test(query.from ?? '') || !DAY.test(query.to ?? '')) {
    throw new DemoHttpError(
      400,
      'Use a date range of at most 366 days; to is exclusive',
    )
  }
  const from = zonedMidnight(query.from, query.timeZone)
  const to = zonedMidnight(query.to, query.timeZone)
  if (to <= from || (to - from) / 86_400_000 > 366) {
    throw new DemoHttpError(
      400,
      'Use a date range of at most 366 days; to is exclusive',
    )
  }
  return { from, to }
}

const scopeOf = (
  db: Db,
  meId: string,
  query: StatisticsQuery,
  projects: MockProject[],
  span: { from: number; to: number },
  now: number,
): Scope => ({
  db,
  meId,
  query,
  projects,
  ...span,
  owners: new Set(projects.filter((p) => isOwner(p, meId)).map((p) => p.id)),
  viewers: new Set(
    projects.filter((p) => !isWorker(db, p, meId)).map((p) => p.id),
  ),
  now,
})

/**
 * What is left today of a scope kept from earlier, as a shared report keeps
 * one (`StatisticsManager.remainingScope`): the projects its reader no longer
 * sees drop out, with those its people filter no longer applies to. Nothing
 * when none is left.
 */
export function remainingScope(
  db: Db,
  meId: string,
  query: StatisticsQuery,
  now = Date.now(),
): Scope | null {
  const span = period(query)
  const visible = visibleProjects(db, meId)
  const role = (project: MockProject): ReaderRole => roleOf(project, meId)
  const projects = projectsForPeople(
    [...new Set(query.projectIds ?? [])].flatMap((id) =>
      visible.filter((project) => project.id === id),
    ),
    role,
    meId,
    query.userIds,
  )
  return projects.length > 0 && !refusesQuery(projects, role, meId, query)
    ? scopeOf(db, meId, query, projects, span, now)
    : null
}

export function statisticsScope(
  db: Db,
  meId: string,
  query: StatisticsQuery,
  now = Date.now(),
): Scope {
  const span = period(query)
  const visible = visibleProjects(db, meId)
  const role = (project: MockProject): ReaderRole => roleOf(project, meId)
  let projects: MockProject[]
  if (query.projectIds?.length) {
    projects = [...new Set(query.projectIds)].map((id) => {
      const project = visible.find((p) => p.id === id)
      if (!project) {
        throw new DemoHttpError(403, 'Access denied')
      }
      return project
    })
  } else {
    projects = projectsForPeople(visible, role, meId, query.userIds)
  }
  if (refusesQuery(projects, role, meId, query)) {
    throw new DemoHttpError(403, 'Access denied')
  }
  return scopeOf(db, meId, query, projects, span, now)
}

const seconds = (time: MockTime) =>
  Math.max(0, (Date.parse(time.toAt) - Date.parse(time.fromAt)) / 1000)

const activeSeconds = (time: MockTime) =>
  Math.min(seconds(time), Math.max(0, (time.minutesActive ?? 0) * 60))

/** Entries in the scope's projects and period, narrowed to the people asked for. */
function baseEntries(scope: Scope): MockTime[] {
  const projectIds = new Set(scope.projects.map((p) => p.id))
  const users = scope.query.userIds?.length
    ? new Set(scope.query.userIds)
    : null
  return scope.db.times.filter((time) => {
    if (!projectIds.has(time.projectId)) {
      return false
    }
    if (users && !users.has(time.userId)) {
      return false
    }
    if (scope.query.invoiceId) {
      return time.invoiceId === scope.query.invoiceId
    }
    const at = Date.parse(time.fromAt)
    return at >= scope.from && at < scope.to
  })
}

/** Time the reader may count: shared projects in full, their own elsewhere. */
const countable = (scope: Scope, time: MockTime) =>
  scope.owners.has(time.projectId) ||
  scope.viewers.has(time.projectId) ||
  time.userId === scope.meId

/** Time whose apps the reader may see: their own, or published on a shared project. */
const appVisible = (scope: Scope, time: MockTime) =>
  time.userId === scope.meId ||
  ((scope.owners.has(time.projectId) || scope.viewers.has(time.projectId)) &&
    isPublished(time, projectOf(scope.db, time.projectId)!, scope.now))

const pad = (n: number) => String(n).padStart(2, '0')

const dayOf = (iso: string, timeZone: string) =>
  zonedParts(Date.parse(iso), timeZone).day

/** The reader's day, or their hour after it, as `time/daily` keys them. */
const bucketOf = (
  iso: string,
  bucket: StatisticsQuery['bucket'],
  timeZone: string,
) =>
  bucket === 'hour'
    ? `${dayOf(iso, timeZone)}T${pad(zonedParts(Date.parse(iso), timeZone).hour)}`
    : dayOf(iso, timeZone)

type TotalsSpan = {
  from?: number
  to?: number
  userIds?: string[]
  invoiceId?: string
}

/** Which figures a reader may see, on the terms of the API's `ProjectTotals`. */
export function projectFigures(
  db: Db,
  meId: string,
  projects: MockProject[],
  span: TotalsSpan = {},
  now = Date.now(),
) {
  const rows: Record<string, unknown>[] = []
  for (const project of projects) {
    const role = roleOf(project, meId)
    if (!role) {
      continue
    }
    const entries = db.times.filter((time) => {
      if (time.projectId !== project.id) {
        return false
      }
      if (role === 'worker' && time.userId !== meId) {
        return false
      }
      if (span.userIds?.length && !span.userIds.includes(time.userId)) {
        return false
      }
      if (span.invoiceId) {
        return time.invoiceId === span.invoiceId
      }
      return inSpan(time.fromAt, span)
    })
    const settled =
      role === 'viewer'
        ? []
        : db.invoices.filter((invoice) => {
            if (invoice.projectId !== project.id || invoice.state !== 'PAID') {
              return false
            }
            if (role === 'worker' && invoice.userId !== meId) {
              return false
            }
            if (
              span.userIds?.length &&
              !span.userIds.includes(invoice.userId)
            ) {
              return false
            }
            return span.invoiceId
              ? invoice.id === span.invoiceId
              : inSpan(invoice.fromAt, span)
          })
    if (entries.length === 0 && settled.length === 0) {
      continue
    }
    const total = (list: MockTime[]) =>
      list.reduce((sum, time) => sum + seconds(time), 0)
    const tracked = total(entries)
    if (role === 'viewer') {
      rows.push({ projectId: project.id, trackedSeconds: Math.round(tracked) })
      continue
    }
    const detail = entries.filter((time) => hasDetail(time, project, meId, now))
    const desktop = detail.filter((time) => time.source === 'desktop')
    const active = desktop.reduce((sum, time) => sum + activeSeconds(time), 0)
    const sum = (key: 'keyboardKeys' | 'mouseKeys' | 'mouseDistance') =>
      detail.reduce((all, time) => all + (time[key] ?? 0), 0)
    const paid = total(entries.filter((time) => time.isPaid))
    const handPaid = total(
      entries.filter(
        (time) => time.isPaid && !settledIds(db).has(time.invoiceId ?? ''),
      ),
    )
    const unpaid = Math.max(0, tracked - paid)
    const invoiced = entries.filter(isInvoiced)
    const rateHourCents = Math.round(Number(project.rateHour) * 100)
    const priced = (s: number) => Math.round((s * rateHourCents) / 3600)
    rows.push({
      projectId: project.id,
      trackedSeconds: Math.round(tracked),
      activeSeconds: Math.round(active),
      idleSeconds: Math.round(total(desktop) - active),
      manualSeconds: Math.round(
        total(
          detail.filter(
            (time) => time.source === 'manual' || time.source === 'web',
          ),
        ),
      ),
      mobileSeconds: Math.round(
        total(detail.filter((time) => time.source === 'mobile')),
      ),
      keyboardKeys: sum('keyboardKeys'),
      mouseKeys: sum('mouseKeys'),
      mouseDistance: sum('mouseDistance'),
      paidSeconds: Math.round(paid),
      unpaidSeconds: Math.round(unpaid),
      invoicedSeconds: Math.round(total(invoiced)),
      invoicedUnpaidSeconds: Math.round(
        total(invoiced.filter((time) => !time.isPaid)),
      ),
      rateHour: Number(project.rateHour),
      earnedCents: priced(tracked),
      paidCents:
        settled.reduce((sum, invoice) => sum + invoice.amountCents, 0) +
        priced(handPaid),
      unpaidCents: priced(unpaid),
    })
  }
  return rows
}

const inSpan = (iso: string, span: TotalsSpan) => {
  const at = Date.parse(iso)
  return (
    (span.from === undefined || at >= span.from) &&
    (span.to === undefined || at < span.to)
  )
}

const settledIds = (db: Db) =>
  new Set(
    db.invoices
      .filter((invoice) => invoice.state === 'PAID')
      .map((invoice) => invoice.id),
  )

export const totals = (scope: Scope) =>
  projectFigures(
    scope.db,
    scope.meId,
    scope.projects,
    {
      from: scope.from,
      to: scope.to,
      userIds: scope.query.userIds,
      invoiceId: scope.query.invoiceId,
    },
    scope.now,
  )

const APP_KINDS = new Set([
  'summary',
  'daily',
  'ranking',
  'titles',
  'workers',
  'projects',
])

export function apps(scope: Scope, kind: string) {
  if (!APP_KINDS.has(kind)) {
    throw new DemoHttpError(400, 'Unknown statistics report')
  }
  if (kind === 'workers' && scope.owners.size !== scope.projects.length) {
    throw new DemoHttpError(403, 'Access denied')
  }
  if (kind === 'titles' && scope.viewers.size > 0) {
    throw new DemoHttpError(403, 'Access denied')
  }
  const rows = new Map<string, Record<string, string | number>>()
  for (const time of baseEntries(scope)) {
    if (!appVisible(scope, time)) {
      continue
    }
    for (const app of time.apps) {
      if (scope.query.app && app.name !== scope.query.app) {
        continue
      }
      const dims: Record<string, string> = { app: app.name }
      if (kind === 'daily') {
        dims.day = dayOf(time.fromAt, scope.query.timeZone)
      }
      if (kind === 'titles') {
        Object.assign(dims, { title: '', domain: '' })
      }
      if (kind === 'workers') {
        dims.userId = time.userId
      }
      if (kind === 'projects') {
        dims.projectId = time.projectId
      }
      const key = JSON.stringify(dims)
      const row = rows.get(key) ?? { ...dims, seconds: 0 }
      ;(row.seconds as number) += app.seconds
      rows.set(key, row)
    }
  }
  return [...rows.values()].sort(
    (a, b) => (b.seconds as number) - (a.seconds as number),
  )
}

/**
 * What the period asks for and a plan hides, on the API's terms
 * (`StatisticsManager.hiddenHistory`): the limit is each project owner's, and
 * a read by invoice hides nothing. The demo's Free plan is its visitor's, so
 * it shows on the projects they own. The demo only says so: its seed keeps
 * the older time in place.
 */
export const hidden = (scope: Scope) =>
  scope.query.invoiceId
    ? {}
    : hiddenHistory(
        scope.projects.map((project) => ({
          keptFrom: ownerPremium(scope.db, project)
            ? null
            : scope.now - FREE_RETENTION_MS,
          owned: isOwner(project, scope.meId),
        })),
        scope.from,
      )

export const overview = (scope: Scope) => ({
  totals: totals(scope),
  apps: apps(scope, 'projects'),
  gaps: [],
  ...hidden(scope),
})

export function timeDaily(scope: Scope) {
  const rows = new Map<
    string,
    { day: string; projectId: string; trackedSeconds: number }
  >()
  for (const time of baseEntries(scope)) {
    if (!countable(scope, time)) {
      continue
    }
    const day = bucketOf(time.fromAt, scope.query.bucket, scope.query.timeZone)
    const key = `${day}:${time.projectId}`
    const row = rows.get(key) ?? {
      day,
      projectId: time.projectId,
      trackedSeconds: 0,
    }
    row.trackedSeconds += seconds(time)
    rows.set(key, row)
  }
  return [...rows.values()]
    .map((row) => ({ ...row, trackedSeconds: Math.round(row.trackedSeconds) }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

/** The reader's own entries: insights describe them, whoever is selected. */
function ownEntries(db: Db, meId: string, query: StatisticsQuery, now: number) {
  const scope = statisticsScope(db, meId, { ...query, userIds: undefined }, now)
  return baseEntries({
    ...scope,
    query: { ...scope.query, userIds: [meId] },
  }).map((time) => ({
    fromAt: new Date(time.fromAt),
    toAt: new Date(time.toAt),
    activeSeconds: time.source === 'desktop' ? activeSeconds(time) : null,
    keyboardKeys: time.keyboardKeys,
    projectId: time.projectId,
    apps: time.apps,
    mouseKeys: time.mouseKeys,
  }))
}

export const timeHourly = (
  db: Db,
  meId: string,
  query: StatisticsQuery,
  now = Date.now(),
) => ({
  rows: StatisticsInsights.hourly(
    ownEntries(db, meId, query, now),
    query.timeZone,
  ),
})

export const insightsMe = (
  db: Db,
  meId: string,
  query: StatisticsQuery,
  now = Date.now(),
) => StatisticsInsights.me(ownEntries(db, meId, query, now), query.timeZone)

/**
 * Runs every worker made on owned projects, the reader's own elsewhere, none
 * on viewed ones; `only` narrows them to some projects, or to some agents.
 * Each goes by the demo's agent id, so one agent's overlapping runs count once.
 */
function agentRuns(
  scope: Scope,
  only: { projectIds?: Set<string>; agentIds?: string[] } = {},
) {
  const users = scope.query.userIds?.length
    ? new Set(scope.query.userIds)
    : null
  const agents = only.agentIds?.length ? new Set(only.agentIds) : null
  const ids = new Set(scope.projects.map((p) => p.id))
  const visible = scope.db.runs.filter((run) => {
    if (
      !ids.has(run.projectId) ||
      (only.projectIds && !only.projectIds.has(run.projectId))
    ) {
      return false
    }
    if (agents && !agents.has(agentIdOf(run))) {
      return false
    }
    if (scope.viewers.has(run.projectId)) {
      return false
    }
    if (!scope.owners.has(run.projectId) && run.userId !== scope.meId) {
      return false
    }
    if (users && !users.has(run.userId)) {
      return false
    }
    if (scope.query.invoiceId && run.invoiceId !== scope.query.invoiceId) {
      return false
    }
    return (
      Date.parse(run.toAt) > scope.from && Date.parse(run.fromAt) < scope.to
    )
  })
  return visible.map((run) => ({ ...run, agentId: agentIdOf(run) }))
}

/**
 * Who rows are about, as the API's `StatisticsManager.named` has it: each
 * agent by its name, and the people - the ones who run those agents, with
 * any others asked for. The demo's agent is named for its product, as on
 * the Team page.
 */
function named(
  db: Db,
  agentRows: { userId: string; agentId: string }[],
  runs: { agentId: string; product: string }[],
  otherPeople: string[] = [],
  /** For a reader with no session: nobody is named by an address. */
  forAnyone = false,
) {
  const byName = (
    a: { name: string; id: string },
    b: { name: string; id: string },
  ) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  const agents = new Map(
    agentRows.map(({ userId, agentId }) => [
      agentId,
      {
        id: agentId,
        name: runs.find((run) => run.agentId === agentId)?.product ?? '',
        userId,
      },
    ]),
  )

  return {
    people: [
      ...new Set([...otherPeople, ...agentRows.map((row) => row.userId)]),
    ]
      .map((id) => {
        const user = userOf(db, id)

        return {
          id,
          name: user?.name || (forAnyone ? '' : user?.address || id),
        }
      })
      .sort(byName),
    agents: [...agents.values()].sort(byName),
  }
}

export function agentsDaily(scope: Scope) {
  const runs = agentRuns(scope, { agentIds: scope.query.agentIds })
  const people = new Set(runs.map((run) => run.userId))
  const projects = new Set(runs.map((run) => run.projectId))
  const human = scope.db.times
    .filter(
      (time) =>
        people.has(time.userId) &&
        projects.has(time.projectId) &&
        Date.parse(time.toAt) > scope.from &&
        Date.parse(time.fromAt) < scope.to,
    )
    .map((time) => ({
      userId: time.userId,
      projectId: time.projectId,
      span: [Date.parse(time.fromAt), Date.parse(time.toAt)] as Span,
    }))
  const counts = new Map<
    string,
    { product: string; status: string; count: number }
  >()
  for (const run of runs) {
    const key = `${run.product}:${run.status}`
    const row = counts.get(key) ?? {
      product: run.product,
      status: run.status,
      count: 0,
    }
    row.count++
    counts.set(key, row)
  }
  const daily = StatisticsInsights.agentDaily(
    runs,
    human,
    [scope.from, scope.to],
    scope.query.timeZone,
    scope.query.bucket ?? 'day',
  )

  return {
    daily,
    runs: [...counts.values()].sort(
      (a, b) =>
        a.product.localeCompare(b.product) || a.status.localeCompare(b.status),
    ),
    runsDaily: StatisticsInsights.runsDaily(runs, scope.query.timeZone),
    // Names travel with the rows, as the API sends them.
    ...named(scope.db, daily, runs),
    ...hidden(scope),
  }
}

export function team(scope: Scope) {
  if (scope.owners.size === 0) {
    throw new DemoHttpError(403, 'Access denied')
  }
  const rows = new Map<
    string,
    {
      userId: string
      name: string
      trackedSeconds: number
      activeSeconds: number
      unpaidSeconds: number
      agentSeconds: number
    }
  >()
  const row = (userId: string) => {
    let current = rows.get(userId)
    if (!current) {
      const user = userOf(scope.db, userId)
      current = {
        userId,
        name: user?.name || user?.address || userId,
        trackedSeconds: 0,
        activeSeconds: 0,
        unpaidSeconds: 0,
        agentSeconds: 0,
      }
      rows.set(userId, current)
    }
    return current
  }
  for (const time of baseEntries(scope)) {
    if (!scope.owners.has(time.projectId)) {
      continue
    }
    const project = projectOf(scope.db, time.projectId)!
    const person = row(time.userId)
    person.trackedSeconds += seconds(time)
    if (
      time.source === 'desktop' &&
      hasDetail(time, project, scope.meId, scope.now)
    ) {
      person.activeSeconds += activeSeconds(time)
    }
    if (!time.isPaid) {
      person.unpaidSeconds += seconds(time)
    }
  }
  const byAgent = new Map<string, Span[]>()
  for (const run of agentRuns(scope, { projectIds: scope.owners })) {
    const key = `${run.userId}|${run.agentId}`
    byAgent.set(key, [
      ...(byAgent.get(key) ?? []),
      ...StatisticsInsights.workedSpans(run.segments),
    ])
  }
  for (const [key, spans] of byAgent) {
    const ms = TimeSpans.ms(
      TimeSpans.intersect(TimeSpans.union(spans), [[scope.from, scope.to]]),
    )
    row(key.split('|')[0]).agentSeconds += ms / 1000
  }
  return {
    rows: [...rows.values()]
      .map((r) => ({
        ...r,
        trackedSeconds: Math.round(r.trackedSeconds),
        activeSeconds: Math.round(r.activeSeconds),
        unpaidSeconds: Math.round(r.unpaidSeconds),
        agentSeconds: Math.round(r.agentSeconds),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/**
 * What a shared report shows of a scope, on the terms of the API's
 * `StatisticsManager.sharedFigures`: time by day and project, by person and
 * agent where the scope's reader may see that, a name for every id in those
 * rows, and amounts at today's rates only when asked for and the reader may
 * see money on every project. Never detail.
 */
export function sharedFigures(scope: Scope, withAmounts: boolean) {
  const { db, query } = scope
  const daily = StatisticsInsights.dailyByPerson(
    baseEntries(scope)
      .filter((time) => countable(scope, time))
      .map((time) => ({
        day: dayOf(time.fromAt, query.timeZone),
        projectId: time.projectId,
        userId: time.userId,
        trackedSeconds: seconds(time),
      })),
    scope.viewers,
  )
  const runs = agentRuns(scope)
  const agentsDaily = StatisticsInsights.agentWorkedDaily(
    runs,
    [scope.from, scope.to],
    query.timeZone,
  )
  return {
    projects: scope.projects
      .map(({ id, title }) => ({ id, title }))
      .sort(
        (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      ),
    ...named(
      db,
      agentsDaily,
      runs,
      daily.flatMap((row) => (row.userId ? [row.userId] : [])),
      true,
    ),
    daily,
    agentsDaily,
    ...(withAmounts && scope.viewers.size === 0
      ? {
          amounts: {
            peopleCents: totals(scope).reduce(
              (cents, row) => cents + Number(row.earnedCents ?? 0),
              0,
            ),
            agentsCents: StatisticsInsights.agentCents(
              agentsDaily,
              ({ projectId, agentId }) =>
                projectOf(db, projectId)?.agentRates?.[agentId] ?? 0,
            ),
          },
        }
      : {}),
  }
}
