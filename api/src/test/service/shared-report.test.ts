import { suite, test } from '@testdeck/mocha'
import { expect } from 'chai'
import { NotFoundError } from 'routing-controllers'

import { Project } from '@/entity/project'
import { User } from '@/entity/user'
import SharedReportGoneException from '@/exception/shared-report-gone-exception'
import { IConfigParameters } from '@/model/config'
import { runPromise } from '@/service/effect-bridge'
import { ErrorFormatter } from '@/service/error-formatter'
import { SharedReportLimit } from '@/service/shared-report-limit'
import { SharedReportManager } from '@/service/shared-report-manager'
import { StatisticsManager } from '@/service/statistics-manager'
import { UserManager } from '@/service/user-manager'
import { AbstractDatabaseIntegration } from '@/test/abstract-database.integration'
import { ProjectFixture } from '@/test/fixture/project-fixture'
import { TimeFixture } from '@/test/fixture/time-fixture'

const DAY = 86400000
const HOUR = 3600000

const midnight = (offset: number) =>
  new Date().setUTCHours(0, 0, 0, 0) + offset * DAY
const day = (offset: number) =>
  new Date(midnight(offset)).toISOString().slice(0, 10)

/**
 * The rules a shared report reads by, below HTTP: who is named in its rows,
 * when a plan hides it, and what is left of it once its sharer sees less.
 */
@suite()
export class SharedReportTest extends AbstractDatabaseIntegration {
  private reports: SharedReportManager
  private statistics: StatisticsManager
  private projects: ProjectFixture
  private times: TimeFixture
  private config: IConfigParameters
  private savedSecret: string

  constructor() {
    super()
    this.reports = this.container.get('SharedReportManager')
    this.statistics = this.container.get('StatisticsManager')
    this.projects = this.container.get('ProjectFixture')
    this.times = this.container.get('TimeFixture')
    this.config = this.container.get('parameters')
    this.savedSecret = this.config.entitlementSecret
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
    rateHour: number,
    lists: { workers?: User[]; viewers?: User[] } = {},
  ): Promise<Project> {
    const project = await this.projects.createPersonal(owner, rateHour)
    project.user = owner
    project.workerAddresses = (lists.workers ?? []).map((u) => u.address)
    project.viewerAddresses = (lists.viewers ?? []).map((u) => u.address)

    return this.conn.getRepository(Project).save(project)
  }

  /** Yesterday at noon UTC, `minutes` long. */
  private track(project: Project, author: User, minutes: number) {
    const from = midnight(-1) + 12 * HOUR

    return this.times.create(
      project,
      new Date(from),
      new Date(from + minutes * 60000),
      author,
    )
  }

  private async leave(project: Project, person: User, to?: 'viewer') {
    const stored = await this.conn
      .getRepository(Project)
      .findOneByOrFail({ id: project.id })
    stored.workerAddresses = stored.workerAddresses.filter(
      (address) => address !== person.address,
    )
    if (to) stored.viewerAddresses = [person.address]
    await this.conn.getRepository(Project).save(stored)
  }

  private share(
    sharer: User,
    projects: Project[],
    fields: { from?: string; userIds?: string[]; showAmounts?: boolean } = {},
  ) {
    return this.reports.create(
      {
        from: day(-3),
        to: day(1),
        timeZone: 'UTC',
        projectIds: projects.map((project) => project.id),
        ...fields,
      },
      sharer,
    )
  }

  private async refusal(token: string): Promise<unknown> {
    try {
      await this.reports.readPublic(token)
    } catch (error) {
      return error
    }

    return undefined
  }

  /** SPEC.md, "Who can see what": the split by person is the reader's to see. */
  @test()
  async rowsNameAPersonOnlyWhereTheSharerMaySeeThem() {
    const sharer = await this.person(true)
    const boss = await this.person(true)
    const colleague = await this.person(false)
    const owned = await this.project(sharer, 60, { workers: [colleague] })
    const worked = await this.project(boss, 30, {
      workers: [sharer, colleague],
    })
    const viewed = await this.project(boss, 90, {
      workers: [colleague],
      viewers: [sharer],
    })
    await this.track(owned, sharer, 60)
    await this.track(owned, colleague, 30)
    await this.track(worked, sharer, 30)
    await this.track(worked, colleague, 60)
    await this.track(viewed, colleague, 60)
    await this.track(viewed, boss, 30)

    const all = await this.reports.readPublic(
      (await this.share(sharer, [owned, worked, viewed])).token,
    )
    const of = (project: Project) =>
      all.daily
        .filter((row) => row.projectId === project.id)
        .map(({ userId, trackedSeconds }) => [userId, trackedSeconds])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))

    // Owned: everyone, by name. Worked on: their own alone. Viewed: the
    // project's total, with nobody in it.
    expect(of(owned)).to.deep.equal(
      [
        [sharer.id, 3600],
        [colleague.id, 1800],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    )
    expect(of(worked)).to.deep.equal([[sharer.id, 1800]])
    expect(of(viewed)).to.deep.equal([[undefined, 5400]])
    expect(all.daily.every((row) => row.day === day(-1))).to.equal(true)
    // The owner of the viewed project tracked on it and is named nowhere.
    expect(all.people.map((person) => person.id).sort()).to.deep.equal(
      [sharer.id, colleague.id].sort(),
    )

    // Money needs every project: asked for, it is left off while one is
    // viewed, and the report says so.
    const mixed = await this.share(sharer, [owned, viewed], {
      showAmounts: true,
    })
    expect(mixed.showAmounts).to.equal(false)
    expect(await this.reports.readPublic(mixed.token)).to.not.have.property(
      'amounts',
    )
    const priced = await this.reports.readPublic(
      (await this.share(sharer, [owned, worked], { showAmounts: true })).token,
    )
    // An hour and a half at $60 on the owned project, the sharer's own half
    // hour at $30 on the other.
    expect(priced.amounts).to.deep.equal({
      peopleCents: 9000 + 1500,
      agentsCents: 0,
    })

    // The same rule read straight off a scope.
    const scope = await this.statistics.scope(
      {
        from: day(-3),
        to: day(1),
        timeZone: 'UTC',
        projectIds: [viewed.id],
      },
      sharer,
    )
    const figures = await this.statistics.sharedFigures(scope, true)
    expect(figures.daily).to.deep.equal([
      { day: day(-1), projectId: viewed.id, trackedSeconds: 5400 },
    ])
    expect(figures).to.not.have.property('amounts')
  }

  /** SPEC.md, "What premium governs": a report is not exempt from the window. */
  @test()
  async aReportIsGoneWhileAProjectItStillReadsHidesPartOfItsSpan() {
    this.config.entitlementSecret = 'secret'
    const free = await this.person(false)
    const premium = await this.person(true)
    const worker = await this.person(false)
    const limited = await this.project(free, 60, { workers: [worker] })
    const kept = await this.project(premium, 60, { workers: [worker] })
    await this.track(limited, worker, 60)
    await this.track(kept, worker, 60)

    const both = await this.share(worker, [limited, kept], { from: day(-30) })
    const gone = await this.refusal(both.token)
    expect(gone).to.be.instanceOf(SharedReportGoneException)
    expect(gone).to.include({ httpCode: 410, reason: 'retention' })
    expect(ErrorFormatter.format(gone)).to.include({ reason: 'retention' })

    // The window is the owner's, so a Premium owner's project hides nothing.
    const fine = await this.share(worker, [kept], { from: day(-30) })
    expect((await this.reports.readPublic(fine.token)).daily).to.have.length(1)

    // The first day decides: one that began before the window is hidden,
    // the next one is whole.
    const edge = await this.share(worker, [limited], { from: day(-14) })
    expect(await this.refusal(edge.token)).to.be.instanceOf(
      SharedReportGoneException,
    )
    const inside = await this.share(worker, [limited], { from: day(-13) })
    expect((await this.reports.readPublic(inside.token)).daily).to.have.length(
      1,
    )

    // Checked on the projects the report still reads: once the sharer is off
    // the limited one, the rest opens again.
    await this.leave(limited, worker)
    const rest = await this.reports.readPublic(both.token)
    expect(rest.projects.map((project) => project.id)).to.deep.equal([kept.id])
  }

  @test()
  async aLinkEndsWhenNothingOfItIsLeftToTheSharer() {
    const owner = await this.person(true)
    const worker = await this.person(false)
    const project = await this.project(owner, 60, { workers: [worker] })
    await this.track(project, worker, 60)
    await this.track(project, owner, 30)
    const mine = await this.share(worker, [project], { userIds: [worker.id] })
    const plain = await this.share(worker, [project])

    expect((await this.reports.readPublic(mine.token)).daily).to.deep.equal([
      {
        day: day(-1),
        projectId: project.id,
        userId: worker.id,
        trackedSeconds: 3600,
      },
    ])

    // Now only a viewer: a report narrowed to a person no longer applies,
    // and the plain one reads as a viewer reads, the project's total.
    await this.leave(project, worker, 'viewer')
    expect(await this.refusal(mine.token)).to.be.instanceOf(NotFoundError)
    expect((await this.reports.readPublic(plain.token)).daily).to.deep.equal([
      { day: day(-1), projectId: project.id, trackedSeconds: 5400 },
    ])

    // Off the project altogether, and a link that never was one.
    await this.conn
      .getRepository(Project)
      .update(project.id, { viewerAddresses: [] })
    expect(await this.refusal(plain.token)).to.be.instanceOf(NotFoundError)
    expect(await this.refusal('not-a-link')).to.be.instanceOf(NotFoundError)
  }

  @test()
  anAddressGetsABurstOfOpeningsThatComesBackWithTime() {
    const limit = new SharedReportLimit()
    const opens = (address: string, at: number) => {
      try {
        limit.take(address, at)
      } catch (error) {
        return (error as { httpCode?: number }).httpCode
      }

      return 200
    }

    const burst = Array.from({ length: 60 }, () => opens('203.0.113.5', 0))
    expect(burst.every((status) => status === 200)).to.equal(true)
    expect(opens('203.0.113.5', 0)).to.equal(429)
    // Asking again while refused earns nothing.
    expect(opens('203.0.113.5', 500)).to.equal(429)
    // One comes back a second, and the allowance never grows past the burst.
    expect(opens('203.0.113.5', 1000)).to.equal(200)
    expect(opens('203.0.113.5', 1000)).to.equal(429)
    const later = Array.from({ length: 61 }, () =>
      opens('203.0.113.5', 10 * 3600000),
    )
    expect(later.filter((status) => status === 200)).to.have.length(60)

    // Each address has its own, and a mapped IPv4 address is that address.
    expect(opens('203.0.113.6', 0)).to.equal(200)
    expect(opens('::ffff:203.0.113.5', 10 * 3600000)).to.equal(429)
    expect(limit.retryAfterSeconds()).to.equal(1)
  }
}
