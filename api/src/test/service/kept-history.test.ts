import { suite, test } from '@testdeck/mocha'
import { expect } from 'chai'
import { randomUUID } from 'crypto'
import moment from 'moment'

import { Project } from '@/entity/project'
import { Time } from '@/entity/time'
import { TimeAgent } from '@/entity/time-agent'
import { User } from '@/entity/user'
import { IConfigParameters } from '@/model/config'
import { TimeSearchDto } from '@/model/dto/time'
import { AgentRunRecord } from '@/service/agent-run-record'
import { runPromise } from '@/service/effect-bridge'
import { InvoiceManager } from '@/service/invoice-manager'
import { KeptHistory } from '@/service/kept-history'
import { ProjectTotals } from '@/service/project-totals'
import { StatisticsManager } from '@/service/statistics-manager'
import { TimeManager } from '@/service/time-manager'
import { UserManager } from '@/service/user-manager'
import { AbstractDatabaseIntegration } from '@/test/abstract-database.integration'
import { ProjectFixture } from '@/test/fixture/project-fixture'
import { TimeFixture } from '@/test/fixture/time-fixture'

const HOUR = 3600000
const day = (offset: number) =>
  moment.utc().add(offset, 'days').format('YYYY-MM-DD')
const noon = (offset: number) =>
  moment.utc().add(offset, 'days').startOf('day').add(12, 'hours').valueOf()

/** A period that reaches well past the free plan's 14 days. */
const LONG = { from: day(-30), to: day(1), timeZone: 'UTC' }

/**
 * A project shows what its owner's plan still keeps, on every read of it
 * (SPEC.md, "What premium governs"): a read settles the project first, so a
 * project nobody has written to for weeks hides its old time all the same.
 */
@suite()
export class KeptHistoryTest extends AbstractDatabaseIntegration {
  private statistics: StatisticsManager
  private history: KeptHistory
  private projects: ProjectFixture
  private times: TimeFixture
  private config: IConfigParameters
  private savedSecret: string

  constructor() {
    super()
    this.statistics = this.container.get('StatisticsManager')
    this.history = this.container.get('KeptHistory')
    this.projects = this.container.get('ProjectFixture')
    this.times = this.container.get('TimeFixture')
    this.config = this.container.get('parameters')
    this.savedSecret = this.config.entitlementSecret
    // Hosted: only there does an account without Premium have a limit.
    this.config.entitlementSecret = 'secret'
  }

  async after() {
    this.config.entitlementSecret = this.savedSecret
    await super.after()
  }

  private async owner(premium: boolean): Promise<User> {
    const user = await this.userFixture.createUser()
    user.premium = premium
    return runPromise(
      this.container.get<UserManager>('UserManager').saveSingle(user),
    )
  }

  private async project(owner: User) {
    const project = await this.projects.createPersonal(owner, 60)
    project.user = owner
    project.trackAgents = true
    return this.conn.getRepository(Project).save(project)
  }

  private entry(project: Project, daysAgo: number, minutes: number) {
    const from = noon(-daysAgo)

    return this.times.create(
      project,
      new Date(from),
      new Date(from + minutes * 60000),
    )
  }

  private run(project: Project, daysAgo: number) {
    const from = noon(-daysAgo)

    return this.conn.getRepository(TimeAgent).save({
      runKey: randomUUID().split('-').join(''),
      userId: project.user.id,
      projectId: project.id,
      agentId: randomUUID(),
      product: 'codex',
      surface: 'cli',
      sourceInstanceId: randomUUID(),
      sourceSessionId: 's',
      sourceRunId: 'r',
      sourceAgentId: 'a',
      prompt: null,
      segments: [
        {
          state: 'running',
          fromAt: new Date(from).toISOString(),
          toAt: new Date(from + HOUR / 2).toISOString(),
        },
      ],
      fromAt: new Date(from),
      toAt: new Date(from + HOUR / 2),
      status: 'completed',
      measurement: {
        coverage: 'run',
        mode: 'timer',
        waitCoverage: 'none',
        liveness: true,
        provisional: false,
        qualification: 'unqualified',
        normalizerRevision: 1,
        adapterVersion: '1',
        runtimeVersion: '1',
        schemaVersion: 1,
      },
    } as Partial<TimeAgent>)
  }

  /** Old and recent time and runs, with one old entry on an invoice. */
  private async quietProject(owner: User) {
    const project = await this.project(owner)
    const old = await this.entry(project, 20, 60)
    const billed = await this.entry(project, 21, 15)
    const recent = await this.entry(project, 2, 30)
    await runPromise(
      this.container
        .get<InvoiceManager>('InvoiceManager')
        .createFromTimeIds(project, owner, [billed.id]),
    )
    await this.run(project, 20)
    await this.run(project, 2)

    return { project, old, billed, recent }
  }

  private async tracked(project: Project, reader: User) {
    const [totals] = (
      (await this.statistics.read(
        'overview',
        { ...LONG, projectIds: [project.id] },
        reader,
      )) as { totals: { trackedSeconds: number }[] }
    ).totals

    return totals?.trackedSeconds ?? 0
  }

  private async listed(reader: User) {
    const search = Object.assign(new TimeSearchDto(), {
      filter: {},
      sort: {},
      pagination: { limit: 100, offset: 0 },
    })
    const [entries] = await runPromise(
      this.container.get<TimeManager>('TimeManager').search(search, reader),
    )

    return entries.map((entry) => entry.id).sort()
  }

  private async runs(reader: User) {
    const [runs] = await this.container
      .get<AgentRunRecord>('AgentRunRecord')
      .search(reader, {} as never)

    return runs.length
  }

  @test()
  async aQuietFreeProjectHidesWhatItNoLongerKeepsOnEveryRead() {
    const owner = await this.owner(false)
    const { project, billed, recent } = await this.quietProject(owner)
    const query = { ...LONG, projectIds: [project.id] }

    // Nothing was written to the project after its old time: reading is
    // what hides it. Totals and charts count the recent entry and the one
    // an invoice covers, and not the hour from twenty days ago.
    expect(await this.tracked(project, owner)).to.equal((30 + 15) * 60)
    const daily = (await this.statistics.timeDaily(query, owner)) as {
      rows: { day: string; trackedSeconds: number }[]
    }
    expect(daily.rows.map((row) => row.day).sort()).to.deep.equal(
      [day(-21), day(-2)].sort(),
    )
    const agents = await this.statistics.agentsDaily(query, owner)
    expect(agents.daily.map((row) => row.day)).to.deep.equal([day(-2)])

    // The lists show the same: no entry and no run that the charts leave out.
    expect(await this.listed(owner)).to.deep.equal(
      [billed.id, recent.id].sort(),
    )
    expect(await this.runs(owner)).to.equal(1)

    // Hidden, not gone: an upgrade can bring it back.
    expect(
      await this.conn
        .getRepository(Time)
        .count({ where: { project: { id: project.id } }, withDeleted: true }),
    ).to.equal(3)
    expect(
      await this.conn
        .getRepository(TimeAgent)
        .count({ where: { projectId: project.id }, withDeleted: true }),
    ).to.equal(2)
  }

  @test()
  async theListsHideItTooWhenTheyAreReadFirst() {
    const owner = await this.owner(false)
    const { billed, recent } = await this.quietProject(owner)

    expect(await this.listed(owner)).to.deep.equal(
      [billed.id, recent.id].sort(),
    )
    expect(await this.runs(owner)).to.equal(1)
  }

  @test()
  async projectTotalsAreAReadLikeAnyOther() {
    const owner = await this.owner(false)
    const { project } = await this.quietProject(owner)

    const [totals] = await this.container
      .get<ProjectTotals>('ProjectTotals')
      .read([project], owner)

    expect(totals.trackedSeconds).to.equal((30 + 15) * 60)
  }

  @test()
  async aPremiumProjectKeepsEverything() {
    const owner = await this.owner(true)
    const { project } = await this.quietProject(owner)

    expect(await this.tracked(project, owner)).to.equal((60 + 30 + 15) * 60)
    expect(await this.listed(owner)).to.have.length(3)
    expect(await this.runs(owner)).to.equal(2)
  }

  @test()
  async aReadSettlesAProjectNowAndThenAndAWriteAlways() {
    const owner = await this.owner(false)
    const project = await this.project(owner)
    await this.entry(project, 2, 30)
    expect(await this.tracked(project, owner)).to.equal(30 * 60)

    // Time cannot arrive this old - it is refused - but it does grow this old.
    // A project settled minutes ago is not settled again by the next read...
    await this.entry(project, 20, 60)
    expect(await this.tracked(project, owner)).to.equal((30 + 60) * 60)

    // ...and what follows a write always is.
    await this.history.settle([project], { force: true })
    expect(await this.tracked(project, owner)).to.equal(30 * 60)

    expect(
      this.history.refuses(project, new Date(noon(-20))),
      'older than the project keeps',
    ).to.equal(true)
    expect(this.history.refuses(project, new Date(noon(-2)))).to.equal(false)
  }
}
