import { inject, injectable } from 'inversify'
import moment from 'moment-timezone'
import { BadRequestError } from 'routing-controllers'
import { ProjectRepository } from '@/repository/project-repository'
import {
  StatisticsRepository,
  StatisticsScope,
} from '@/repository/statistics-repository'
import { InvoiceRepository } from '@/repository/invoice-repository'
import { Project } from '@/entity/project'
import { Invoice } from '@/entity/invoice'
import { User } from '@/entity/user'
import { StatisticsQueryDto } from '@/model/dto/statistics'
import { runPromise } from '@/service/effect-bridge'
import AccessException from '@/exception/access-exception'
import { ISharedFigures } from '@/model/shared-report'
import {
  AgentWorkedRow,
  StatisticsInsights,
} from '@/service/statistics-insights'
import { Span, TimeSpans } from '@/service/time-spans'
import { WorkerAgents } from '@/service/worker-agents'
import {
  HiddenHistory,
  hiddenHistory,
  projectsForPeople,
  refusesQuery,
  refusesReport,
} from '@work-address/statistics-core'
import { Plan } from '@/service/plan'
import { ProjectAccess } from '@/service/project-access'
import { ProjectTotals } from '@/service/project-totals'

const APP_KINDS = ['daily', 'ranking', 'titles', 'workers', 'projects']

@injectable()
export class StatisticsManager {
  @inject('ProjectAccess') protected access: ProjectAccess
  @inject('Plan') protected plan: Plan
  @inject('ProjectRepository') protected projects: ProjectRepository
  @inject('ProjectTotals') protected totals: ProjectTotals
  @inject('InvoiceRepository') protected invoices: InvoiceRepository
  @inject('StatisticsRepository') protected repository: StatisticsRepository

  public async scope(
    query: StatisticsQueryDto,
    user: User,
  ): Promise<StatisticsScope> {
    const period = this.period(query)
    const projects = query.projectIds?.length
      ? await Promise.all(
          [...new Set(query.projectIds)].map((id) =>
            runPromise(
              this.projects.findProjectWithAccessOrFail(
                Object.assign(new Project(), { id }),
                user,
              ),
            ),
          ),
        )
      : await this.visibleProjects(query, user)
    const roleOf = (project: Project) => this.access.role(project, user)
    if (refusesQuery(projects, roleOf, user.id, query))
      throw new AccessException()
    if (query.invoiceId) {
      const invoice = await runPromise(
        this.invoices.findOneConfirmUser(
          Object.assign(new Invoice(), { id: query.invoiceId }),
          user,
        ),
      )
      if (!projects.some((p) => p.id === invoice.project.id))
        throw new AccessException()
    }
    return this.scopeOf(projects, query, user, period)
  }

  /**
   * What is left today of a scope kept from earlier, as a shared report keeps
   * one: the projects its reader can no longer see drop out, with those its
   * people filter no longer applies to. Nothing when none is left, where
   * `scope` would refuse.
   */
  public async remainingScope(
    query: StatisticsQueryDto,
    user: User,
  ): Promise<StatisticsScope | null> {
    const period = this.period(query)
    const roleOf = (project: Project) => this.access.role(project, user)
    const found = await Promise.all(
      [...new Set(query.projectIds ?? [])].map((id) =>
        runPromise(
          this.projects.findProjectWithAccess(
            Object.assign(new Project(), { id }),
            user,
          ),
        ),
      ),
    )
    const projects = projectsForPeople(
      found.filter((project): project is Project => project !== undefined),
      roleOf,
      user.id,
      query.userIds,
    )
    return projects.length && !refusesQuery(projects, roleOf, user.id, query)
      ? this.scopeOf(projects, query, user, period)
      : null
  }

  /** The query's days as instants in its time zone; `to` is exclusive. */
  private period(query: StatisticsQueryDto): { from: Date; to: Date } {
    if (!moment.tz.zone(query.timeZone))
      throw new BadRequestError('Invalid timezone')
    const from = moment.tz(query.from, 'YYYY-MM-DD', true, query.timeZone)
    const to = moment.tz(query.to, 'YYYY-MM-DD', true, query.timeZone)
    if (
      !from.isValid() ||
      !to.isValid() ||
      !to.isAfter(from) ||
      to.diff(from, 'days') > 366
    )
      throw new BadRequestError(
        'Use a date range of at most 366 days; to is exclusive',
      )
    return { from: from.toDate(), to: to.toDate() }
  }

  private scopeOf(
    projects: Project[],
    query: StatisticsQueryDto,
    user: User,
    period: { from: Date; to: Date },
  ): StatisticsScope {
    return {
      projects,
      query,
      user,
      ...period,
      owners: projects.filter((p) => p.isOwner(user)).map((p) => p.id),
      viewers: projects
        .filter((p) => this.access.role(p, user) === 'viewer')
        .map((p) => p.id),
    }
  }
  /**
   * "All projects", narrowed to the ones the people filter can apply to, so
   * an owner who also works on someone else's project can still filter by
   * their workers instead of being refused.
   */
  private async visibleProjects(query: StatisticsQueryDto, user: User) {
    const projects = await runPromise(this.projects.findAllWithAccess(user))
    return projectsForPeople(
      projects,
      (p) => this.access.role(p, user),
      user.id,
      query.userIds,
    )
  }

  public async read(kind: string, query: StatisticsQueryDto, user: User) {
    const scope = await this.scope(query, user)
    if (!scope.projects.length) {
      if (!['overview', 'summary', ...APP_KINDS].includes(kind))
        throw new BadRequestError('Unknown statistics report')
      return kind === 'overview' || kind === 'summary'
        ? { totals: [], apps: [], gaps: [] }
        : { rows: [] }
    }
    if (
      refusesReport(
        kind,
        scope.projects.map((p) => this.access.role(p, user)),
      )
    )
      throw new AccessException()
    if (kind === 'overview' || kind === 'summary') {
      const [totals, apps, gaps] = await Promise.all([
        this.totals.read(scope.projects, user, {
          from: scope.from,
          to: scope.to,
          userIds: query.userIds,
          invoiceId: query.invoiceId,
        }),
        this.repository.apps(scope, 'projects'),
        this.repository.gaps(scope),
      ])
      return {
        totals,
        apps,
        gaps: scope.viewers.length ? [] : gaps,
        ...this.hiddenHistory(scope),
      }
    }
    if (!APP_KINDS.includes(kind))
      throw new BadRequestError('Unknown statistics report')
    return { rows: await this.repository.apps(scope, kind) }
  }

  /** Tracked time per day and project. */
  public async timeDaily(query: StatisticsQueryDto, user: User) {
    const scope = await this.scope(query, user)
    if (!scope.projects.length) return { rows: [] }
    const rows = await this.repository.timeDaily(scope)
    return {
      rows: rows.map((row) => ({
        day: row.day,
        projectId: row.projectId,
        trackedSeconds: Math.round(Number(row.trackedSeconds)),
      })),
    }
  }

  /**
   * The caller's own entries. Insights describe the person reading them,
   * whoever the people filter selects - an owner never gets another
   * person's focus or intensity from here.
   */
  private async ownEntries(query: StatisticsQueryDto, user: User) {
    const scope = await this.scope({ ...query, userIds: undefined }, user)
    if (!scope.projects.length) return []
    const rows = await this.repository.ownEntries(scope)
    const apps = new Map<string, { name: string; seconds: number }[]>()
    for (const usage of await this.repository.appsOf(rows.map((r) => r.id)))
      apps.set(usage.timeId, [
        ...(apps.get(usage.timeId) ?? []),
        { name: usage.app, seconds: Number(usage.seconds) },
      ])
    const number = (value: unknown) => (value == null ? null : Number(value))
    return rows.map((row) => ({
      projectId: row.projectId as string,
      apps: apps.get(row.id) ?? [],
      fromAt: new Date(row.fromAt),
      toAt: new Date(row.toAt),
      activeSeconds: number(row.activeSeconds),
      keyboardKeys: number(row.keyboardKeys),
      mouseKeys: number(row.mouseKeys),
    }))
  }

  /** The caller's active time by weekday and hour. */
  public async timeHourly(query: StatisticsQueryDto, user: User) {
    const entries = await this.ownEntries(query, user)
    return { rows: StatisticsInsights.hourly(entries, query.timeZone) }
  }

  public async insightsMe(query: StatisticsQueryDto, user: User) {
    const entries = await this.ownEntries(query, user)
    return StatisticsInsights.me(entries, query.timeZone)
  }

  /**
   * Agent time per day, worker and agent, and the runs behind it, by product
   * and status over the period and by status on the day each started.
   */
  public async agentsDaily(query: StatisticsQueryDto, user: User) {
    const scope = await this.scope(query, user)
    if (!scope.projects.length) return { daily: [], runs: [], runsDaily: [] }
    const runs = await this.repository.agentRuns(scope, {
      agentIds: query.agentIds,
    })
    const human = await this.repository.humanSpans(
      scope,
      [...new Set(runs.map((run) => run.userId))],
      [...new Set(runs.map((run) => run.projectId))],
    )
    const daily = StatisticsInsights.agentDaily(
      runs,
      human.map((row) => ({
        userId: row.userId,
        projectId: row.projectId,
        span: [+new Date(row.fromAt), +new Date(row.toAt)] as Span,
      })),
      [+scope.from, +scope.to],
      query.timeZone,
      query.bucket ?? 'day',
    )
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
    return {
      daily,
      runs: [...counts.values()].sort(
        (a, b) =>
          a.product.localeCompare(b.product) ||
          a.status.localeCompare(b.status),
      ),
      runsDaily: StatisticsInsights.runsDaily(runs, query.timeZone),
      ...this.hiddenHistory(scope),
    }
  }

  /**
   * Each person's time on the caller's own projects, sorted by name. Never
   * ranked: the order says nothing about anyone.
   */
  public async team(query: StatisticsQueryDto, user: User) {
    const scope = await this.scope(query, user)
    if (!scope.owners.length) throw new AccessException()
    const [rows, runs] = await Promise.all([
      this.repository.team(scope, scope.owners),
      this.repository.agentRuns(scope, { projectIds: scope.owners }),
    ])
    const agentMs = new Map<string, number>()
    const byAgent = new Map<string, Span[]>()
    for (const run of runs) {
      const key = `${run.userId}:${run.agentId}`
      byAgent.set(key, [
        ...(byAgent.get(key) ?? []),
        ...StatisticsInsights.workedSpans(run.segments),
      ])
    }
    for (const [key, spans] of byAgent) {
      const userId = key.split(':')[0]
      const ms = TimeSpans.ms(
        TimeSpans.intersect(TimeSpans.union(spans), [[+scope.from, +scope.to]]),
      )
      agentMs.set(userId, (agentMs.get(userId) ?? 0) + ms)
    }
    const people = rows.map((row) => ({
      userId: row.userId as string,
      name: (row.name || row.address) as string,
      trackedSeconds: Math.round(Number(row.trackedSeconds)),
      activeSeconds: Math.round(Number(row.activeSeconds)),
      unpaidSeconds: Math.round(Number(row.unpaidSeconds)),
      agentSeconds: Math.round((agentMs.get(row.userId) ?? 0) / 1000),
    }))
    // Someone whose agents worked while they tracked nothing still appears.
    const agentsOnly = [...agentMs.keys()].filter(
      (userId) => !people.some((p) => p.userId === userId),
    )
    const names = await this.repository.personNames(agentsOnly)
    for (const userId of agentsOnly)
      people.push({
        userId,
        name: names.get(userId) ?? userId,
        trackedSeconds: 0,
        activeSeconds: 0,
        unpaidSeconds: 0,
        agentSeconds: Math.round((agentMs.get(userId) ?? 0) / 1000),
      })
    return {
      rows: people.sort((a, b) => a.name.localeCompare(b.name)),
    }
  }

  /**
   * What a shared report shows of a scope (SPEC.md, "A shared report is
   * `Statistics` at a link"): tracked time by day and project, by person and
   * by agent where the scope's reader may see that, a name for every id in
   * those rows, and amounts at today's rates only when asked for and the
   * reader may see money on every project. Never detail.
   */
  public async sharedFigures(
    scope: StatisticsScope,
    withAmounts: boolean,
  ): Promise<ISharedFigures> {
    const [entries, runs] = await Promise.all([
      this.repository.timeDailyByPerson(scope),
      this.repository.agentRuns(scope),
    ])
    const daily = StatisticsInsights.dailyByPerson(
      entries.map((row) => ({
        day: row.day as string,
        projectId: row.projectId as string,
        userId: row.userId as string,
        trackedSeconds: Number(row.trackedSeconds),
      })),
      scope.viewers,
    )
    const agentsDaily = StatisticsInsights.agentWorkedDaily(
      runs,
      [+scope.from, +scope.to],
      scope.query.timeZone,
    )
    const runners = [...new Set(agentsDaily.map((row) => row.userId))]
    const [names, agentNames] = await Promise.all([
      this.repository.personNames([
        ...new Set([
          ...daily.flatMap((row) => (row.userId ? [row.userId] : [])),
          ...runners,
        ]),
      ]),
      this.repository.agentNames(runners),
    ])
    const agents = new Map(
      agentsDaily.map(({ userId, agentId }) => [
        `${userId}/${agentId}`,
        {
          id: agentId,
          // Nameless once it is off its worker's list; a removed agent keeps
          // its name there, as it does on runs and invoice lines.
          name: agentNames.get(`${userId}/${agentId}`) ?? '',
          userId,
        },
      ]),
    )
    const byName = (a: { name: string; id: string }, b: typeof a) =>
      a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

    return {
      projects: scope.projects
        .map(({ id, title }) => ({ id, title }))
        .sort(
          (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
        ),
      people: [...names].map(([id, name]) => ({ id, name })).sort(byName),
      agents: [...agents.values()].sort(byName),
      daily,
      agentsDaily,
      ...(withAmounts && !scope.viewers.length
        ? { amounts: await this.sharedAmounts(scope, agentsDaily) }
        : {}),
    }
  }

  /**
   * What the time is worth today: people's as `ProjectTotals` prices it for
   * this reader and people filter, each agent's at the rate its attachment
   * holds on the project - the one an invoice would bill it at, detached or
   * not - and nothing for an agent that was never attached.
   */
  private async sharedAmounts(
    scope: StatisticsScope,
    agentsDaily: AgentWorkedRow[],
  ): Promise<{ peopleCents: number; agentsCents: number }> {
    const totals = await this.totals.read(scope.projects, scope.user, {
      from: scope.from,
      to: scope.to,
      userIds: scope.query.userIds,
    })
    const attachments = new Map(
      scope.projects.map((p) => [p.id, p.agentAttachments ?? []]),
    )

    return {
      peopleCents: totals.reduce(
        (cents, row) => cents + (row.earnedCents ?? 0),
        0,
      ),
      agentsCents: StatisticsInsights.agentCents(
        agentsDaily,
        ({ projectId, userId, agentId }) =>
          WorkerAgents.attachmentOf(
            attachments.get(projectId) ?? [],
            userId,
            agentId,
          )?.rateHourCents ?? 0,
      ),
    }
  }

  /**
   * What the period asks for and a plan hides (SPEC.md, "What premium
   * governs"): the limit is each project owner's, whoever reads. A read by
   * invoice hides nothing, since rotation keeps what an invoice covers.
   */
  public hiddenHistory(scope: StatisticsScope): HiddenHistory {
    if (scope.query.invoiceId) return {}
    const now = new Date()
    return hiddenHistory(
      scope.projects.map((project) => ({
        keptFrom: this.plan.keptFrom(project.user, now)?.getTime() ?? null,
        owned: project.isOwner(scope.user),
      })),
      +scope.from,
    )
  }
}
