import { suite, test } from '@testdeck/mocha'
import { expect } from 'chai'
import moment from 'moment'

import { Project } from '@/entity/project'
import { User } from '@/entity/user'
import { IConfigParameters } from '@/model/config'
import { StatisticsQueryDto } from '@/model/dto/statistics'
import { FREE_RETENTION_DAYS } from '@/model/plan'
import { runPromise } from '@/service/effect-bridge'
import { InvoiceManager } from '@/service/invoice-manager'
import { StatisticsManager } from '@/service/statistics-manager'
import { UserManager } from '@/service/user-manager'
import { AbstractDatabaseIntegration } from '@/test/abstract-database.integration'
import { ProjectFixture } from '@/test/fixture/project-fixture'
import { TimeFixture } from '@/test/fixture/time-fixture'

type Hidden = { hiddenBefore?: string; canUpgrade?: boolean }

const day = (offset: number) =>
  moment.utc().add(offset, 'days').format('YYYY-MM-DD')

/** A period that reaches past the free plan's window, and one inside it. */
const LONG = { from: day(-30), to: day(1), timeZone: 'UTC' }
const SHORT = { from: day(-7), to: day(1), timeZone: 'UTC' }

/**
 * What tells a reader that an owner's plan hides part of the period they asked
 * for (SPEC.md, "What premium governs"), on the two routes that say so.
 */
@suite()
export class StatisticsHiddenHistoryTest extends AbstractDatabaseIntegration {
  private statistics: StatisticsManager
  private projects: ProjectFixture
  private times: TimeFixture
  private config: IConfigParameters
  private savedSecret: string

  constructor() {
    super()
    this.statistics = this.container.get('StatisticsManager')
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

  private async person(premium: boolean): Promise<User> {
    const user = await this.userFixture.createUser()
    user.premium = premium
    return runPromise(
      this.container.get<UserManager>('UserManager').saveSingle(user),
    )
  }

  private async project(
    owner: User,
    workers: User[] = [],
    viewers: User[] = [],
  ) {
    const project = await this.projects.createPersonal(owner, 60)
    project.user = owner
    project.workerAddresses = workers.map((worker) => worker.address)
    project.viewerAddresses = viewers.map((viewer) => viewer.address)
    return this.conn.getRepository(Project).save(project)
  }

  private async overview(query: StatisticsQueryDto, reader: User) {
    return (await this.statistics.read('overview', query, reader)) as Hidden
  }

  private async agents(query: StatisticsQueryDto, reader: User) {
    return (await this.statistics.agentsDaily(query, reader)) as Hidden
  }

  /** The limit as `Plan.keptFrom` put it, give or take the test's own time. */
  private expectLimit(hiddenBefore: string | undefined, since: number) {
    const at = Date.parse(hiddenBefore ?? '')
    const window = FREE_RETENTION_DAYS * 86400000

    expect(hiddenBefore, 'an ISO instant').to.equal(new Date(at).toISOString())
    expect(at).to.be.within(since - window, Date.now() - window)
  }

  @test()
  async aFreeOwnersLimitIsToldToEveryReaderAndOnlyTheOwnerCanLiftIt() {
    const since = Date.now()
    const owner = await this.person(false)
    const worker = await this.person(false)
    const viewer = await this.person(false)
    const project = await this.project(owner, [worker], [viewer])
    const query = { ...LONG, projectIds: [project.id] }

    for (const read of [this.overview, this.agents]) {
      const mine = await read.call(this, query, owner)
      this.expectLimit(mine.hiddenBefore, since)
      expect(mine.canUpgrade).to.equal(true)

      // The plan is the owner's: a worker and a viewer are told, and cannot
      // lift it.
      for (const reader of [worker, viewer]) {
        const theirs = await read.call(this, query, reader)
        this.expectLimit(theirs.hiddenBefore, since)
        expect(theirs.canUpgrade).to.equal(false)
      }
    }
  }

  @test()
  async aPeriodInsideTheWindowHidesNothing() {
    const owner = await this.person(false)
    const project = await this.project(owner)
    const query = { ...SHORT, projectIds: [project.id] }

    for (const answer of [
      await this.overview(query, owner),
      await this.agents(query, owner),
    ]) {
      expect(answer).to.not.have.property('hiddenBefore')
      expect(answer).to.not.have.property('canUpgrade')
    }
  }

  /** `scope()` loads each project's owner with their plan, not the reader's. */
  @test()
  async thePlanReadIsEachProjectOwnersNotTheReaders() {
    const since = Date.now()
    const premium = await this.person(true)
    const free = await this.person(false)
    const kept = await this.project(premium, [free])
    const limited = await this.project(free, [premium])

    // A free worker on a Premium owner's project: nothing is hidden.
    for (const reader of [premium, free]) {
      const answer = await this.overview(
        { ...LONG, projectIds: [kept.id] },
        reader,
      )
      expect(answer).to.not.have.property('hiddenBefore')
      expect(answer).to.not.have.property('canUpgrade')
    }

    // "All projects" holds one that hides history: its owner can upgrade,
    // the Premium owner who only works on it cannot.
    const asFree = await this.overview(LONG, free)
    this.expectLimit(asFree.hiddenBefore, since)
    expect(asFree.canUpgrade).to.equal(true)

    const asPremium = await this.agents(LONG, premium)
    this.expectLimit(asPremium.hiddenBefore, since)
    expect(asPremium.canUpgrade).to.equal(false)

    // Narrowed to the limited project by naming it, the answer is the same.
    const named = await this.overview(
      { ...LONG, projectIds: [limited.id] },
      premium,
    )
    this.expectLimit(named.hiddenBefore, since)
    expect(named.canUpgrade).to.equal(false)
  }

  @test()
  async aSelfHostedInstanceHidesNothing() {
    const owner = await this.person(false)
    const project = await this.project(owner)
    this.config.entitlementSecret = ''

    for (const answer of [
      await this.overview({ ...LONG, projectIds: [project.id] }, owner),
      await this.agents({ ...LONG, projectIds: [project.id] }, owner),
    ]) {
      expect(answer).to.not.have.property('hiddenBefore')
      expect(answer).to.not.have.property('canUpgrade')
    }
  }

  /** Rotation keeps what an invoice covers, so a read by invoice hides nothing. */
  @test()
  async aReadByInvoiceHidesNothing() {
    const owner = await this.person(false)
    const project = await this.project(owner)
    const to = moment.utc().subtract(1, 'hour')
    const time = await this.times.create(
      project,
      to.clone().subtract(1, 'hour').toDate(),
      to.toDate(),
      owner,
    )
    const invoice = await runPromise(
      this.container
        .get<InvoiceManager>('InvoiceManager')
        .createFromTimeIds(project, owner, [time.id]),
    )
    const query = { ...LONG, projectIds: [project.id], invoiceId: invoice.id }

    for (const answer of [
      await this.overview(query, owner),
      await this.agents(query, owner),
    ]) {
      expect(answer).to.not.have.property('hiddenBefore')
      expect(answer).to.not.have.property('canUpgrade')
    }
  }

  @test()
  async aReaderWithNoProjectsIsToldNothing() {
    const nobody = await this.person(false)

    expect(await this.overview(LONG, nobody)).to.deep.equal({
      totals: [],
      apps: [],
      gaps: [],
    })
    expect(await this.agents(LONG, nobody)).to.deep.equal({
      daily: [],
      runs: [],
      runsDaily: [],
      people: [],
      agents: [],
    })
  }
}
