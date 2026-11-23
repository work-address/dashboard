import { suite, test, timeout } from '@testdeck/mocha'
import axios from 'axios'
import { expect } from 'chai'
import { randomUUID } from 'crypto'

import { App } from '@/app/app'
import { Project } from '@/entity/project'
import { SharedReport } from '@/entity/shared-report'
import { TimeAgent } from '@/entity/time-agent'
import { User } from '@/entity/user'
import { ILogger } from '@/model/logging'
import { IPublicReport, ISharedReportView } from '@/model/shared-report'
import { runPromise } from '@/service/effect-bridge'
import { UserManager } from '@/service/user-manager'
import { BaseControllerTest } from '@/test/controller/base-controller.test'

const DAY = 86400000
const HOUR = 3600000
const TOKEN = /^[A-Za-z0-9_-]{43}$/

/** Midnight UTC `offset` days from today, and its `YYYY-MM-DD`. */
const midnight = (offset: number) =>
  new Date().setUTCHours(0, 0, 0, 0) + offset * DAY
const day = (offset: number) =>
  new Date(midnight(offset)).toISOString().slice(0, 10)

type Draft = Partial<{
  title: string
  from: string
  to: string
  timeZone: string
  projectIds: string[]
  userIds: string[]
  showAmounts: boolean
}>

/**
 * Shared reports over HTTP: what a reader may share, what the link answers
 * anyone, and when a report can be billed (SPEC.md, "A shared report is
 * `Statistics` at a link").
 */
@suite()
export class ReportControllerTest extends BaseControllerTest {
  private savedSecret: string

  constructor() {
    super()
    this.savedSecret = this.parameters.entitlementSecret
  }

  async after() {
    this.parameters.entitlementSecret = this.savedSecret
    await super.after()
  }

  private client(user?: User, headers: Record<string, string> = {}) {
    return axios.create({
      baseURL: `${this.url}/api`,
      headers: {
        ...(user
          ? { Authorization: this.authenticator.getTokens(user).accessToken }
          : {}),
        ...headers,
      },
      validateStatus: () => true,
    })
  }

  /** `author`'s time on `project`, `minutes` long from `hour` on a day. */
  private track(
    project: Project,
    author: User,
    offset: number,
    hour: number,
    minutes: number,
  ) {
    const from = midnight(offset) + hour * HOUR

    return this.timeFixture.create(
      project,
      new Date(from),
      new Date(from + minutes * 60000),
      author,
    )
  }

  /**
   * A project at $60/h with three days of time: the worker an hour two days
   * ago and half an hour yesterday, a colleague an hour and the owner half an
   * hour yesterday. With `agents`, the worker's agent at $12/h worked half an
   * hour yesterday.
   */
  private async world(agents = true) {
    const owner = await this.userFixture.createPremiumUser()
    const worker = await this.userFixture.createUser()
    worker.name = 'Wanda Worker'
    await runPromise(
      this.container.get<UserManager>('UserManager').saveSingle(worker),
    )
    const colleague = await this.userFixture.createUser()
    const viewer = await this.userFixture.createUser()
    const outsider = await this.userFixture.createUser()
    const project = await this.projectFixture.createPersonal(owner, 60)
    project.workerAddresses = [worker.address, colleague.address]
    project.viewerAddresses = [viewer.address]
    project.trackAgents = true
    await App.conn.manager.save(project)

    await this.track(project, worker, -2, 12, 60)
    await this.track(project, worker, -1, 12, 30)
    await this.track(project, colleague, -1, 13, 60)
    await this.track(project, owner, -1, 9, 30)

    const agentId = agents ? await this.agent(project, worker, 1200) : null

    return { owner, worker, colleague, viewer, outsider, project, agentId }
  }

  /** The worker's agent on the project, with half an hour of work yesterday. */
  private async agent(project: Project, worker: User, rateHourCents: number) {
    const client = this.client(worker)
    const agent = (
      await client.post('/agents', {
        name: 'My Codex',
        slug: 'my-codex',
        product: 'codex',
        isDefault: true,
        bindings: [],
      })
    ).data as { id: string }
    const attached = await client.put(
      `/project/${project.id}/agents/${agent.id}`,
      { rateHourCents },
    )
    expect(attached.status).to.equal(200)
    const from = new Date(midnight(-1) + 15 * HOUR)
    const to = new Date(+from + 30 * 60000)
    await App.conn.getRepository(TimeAgent).save({
      runKey: randomUUID().split('-').join(''),
      userId: worker.id,
      projectId: project.id,
      agentId: agent.id,
      product: 'codex',
      surface: 'cli',
      sourceInstanceId: randomUUID(),
      sourceSessionId: 's',
      sourceRunId: 'r',
      sourceAgentId: 'a',
      fromAt: from,
      toAt: to,
      status: 'completed',
      prompt: 'Never shown on a report',
      segments: [
        {
          state: 'running',
          fromAt: from.toISOString(),
          toAt: to.toISOString(),
          evidence: 'fixture',
        },
      ],
      measurement: {
        coverage: 'run',
        mode: 'timer',
        waitCoverage: 'none',
        liveness: false,
        provisional: false,
        qualification: 'unqualified',
        normalizerRevision: 1,
        adapterVersion: '0',
        runtimeVersion: '0',
        schemaVersion: 1,
      },
    })

    return agent.id
  }

  private draft(project: Project, fields: Draft = {}) {
    return {
      from: day(-3),
      to: day(1),
      timeZone: 'UTC',
      projectIds: [project.id],
      ...fields,
    }
  }

  private async share(sharer: User, project: Project, fields: Draft = {}) {
    const response = await this.client(sharer).post(
      '/report',
      this.draft(project, fields),
    )
    expect(response.status, JSON.stringify(response.data)).to.equal(200)

    return response.data as ISharedReportView
  }

  /** The link, opened by someone with no session. */
  private async open(token: string) {
    const response = await this.client().get(`/report/public/${token}`)
    expect(response.status, JSON.stringify(response.data)).to.equal(200)

    return response.data as IPublicReport
  }

  private status(token: string) {
    return this.client()
      .get(`/report/public/${token}`)
      .then((response) => response.status)
  }

  @test()
  async aReportIsSharedListedAndDeletedByItsSharerOnly() {
    const { owner, worker, project } = await this.world(false)

    const first = await this.share(owner, project, { title: '  March  ' })
    expect(first.token).to.match(TOKEN)
    expect(first).to.deep.include({
      title: 'March',
      from: day(-3),
      to: day(1),
      timeZone: 'UTC',
      projectIds: [project.id],
      userIds: [],
      showAmounts: false,
      invoiceId: null,
      canInvoice: false,
    })
    expect(Object.keys(first).sort()).to.deep.equal(
      [
        'canInvoice',
        'createdAt',
        'from',
        'id',
        'invoiceId',
        'projectIds',
        'showAmounts',
        'timeZone',
        'title',
        'to',
        'token',
        'userIds',
      ].sort(),
    )
    expect(new Date(first.createdAt).toISOString()).to.equal(first.createdAt)
    const second = await this.share(owner, project, { showAmounts: true })
    expect(second.title).to.equal(null)
    expect(second.token).to.not.equal(first.token)

    // Newest first, and the sharer's own alone.
    const listed = (await this.client(owner).get('/report')).data
    expect(listed).to.deep.equal([second, first])
    expect((await this.client(worker).get('/report')).data).to.deep.equal([])
    expect((await this.client().get('/report')).status).to.equal(401)
    expect(
      (await this.client().post('/report', this.draft(project))).status,
    ).to.equal(401)

    // Only the sharer ends a link; an id that is not one is simply not found.
    expect(
      (await this.client(worker).delete(`/report/${first.id}`)).status,
    ).to.equal(403)
    expect(await this.status(first.token)).to.equal(200)
    expect(
      (await this.client(owner).delete('/report/not-an-id')).status,
    ).to.equal(404)
    expect(
      (await this.client(owner).delete(`/report/${randomUUID()}`)).status,
    ).to.equal(404)
    expect(
      (await this.client(owner).delete(`/report/${first.id}`)).status,
    ).to.equal(204)
    expect(await this.status(first.token)).to.equal(404)
    expect((await this.client(owner).get('/report')).data).to.deep.equal([
      second,
    ])
    expect(
      (await this.client(owner).delete(`/report/${first.id}`)).status,
    ).to.equal(404)
    // Deleted softly: the row stays, and is never found again.
    expect(
      await App.conn
        .getRepository(SharedReport)
        .count({ where: { id: first.id }, withDeleted: true }),
    ).to.equal(1)
  }

  @test()
  async whatStatisticsWouldRefuseIsRefusedHere() {
    const { owner, worker, colleague, viewer, outsider, project } =
      await this.world(false)
    const post = (sharer: User, fields: Record<string, unknown>) =>
      this.client(sharer)
        .post('/report', { ...this.draft(project), ...fields })
        .then((response) => response.status)

    // A project the sharer cannot see, and a people filter they may not use.
    expect(await post(outsider, {})).to.equal(403)
    expect(await post(worker, { userIds: [colleague.id] })).to.equal(403)
    expect(await post(viewer, { userIds: [worker.id] })).to.equal(403)
    expect(await post(worker, { userIds: [worker.id] })).to.equal(200)
    expect(await post(owner, { userIds: [colleague.id] })).to.equal(200)

    // A viewer shares time, and may not switch on money they cannot see.
    expect(await post(viewer, {})).to.equal(200)
    expect(await post(viewer, { showAmounts: true })).to.equal(403)
    expect(await post(worker, { showAmounts: true })).to.equal(200)

    // The period statistics takes, and no other.
    expect(await post(owner, { from: day(-400) })).to.equal(400)
    expect(await post(owner, { from: day(1), to: day(-1) })).to.equal(400)
    expect(await post(owner, { from: 'yesterday' })).to.equal(400)
    expect(await post(owner, { timeZone: 'Mars/Olympus' })).to.equal(400)

    // The body itself.
    expect(await post(owner, { projectIds: [] })).to.equal(400)
    expect(await post(owner, { projectIds: ['nope'] })).to.equal(400)
    expect(await post(owner, { projectIds: undefined })).to.equal(400)
    expect(await post(owner, { userIds: ['nope'] })).to.equal(400)
    expect(await post(owner, { title: 'x'.repeat(121) })).to.equal(400)
    expect(await post(owner, { title: '<b>March</b>' })).to.equal(400)
    expect(await post(owner, { title: 'Mar\u0007ch' })).to.equal(400)
    expect(await post(owner, { showAmounts: 'yes' })).to.equal(400)
    expect(await post(owner, { token: 'chosen-by-the-caller' })).to.equal(400)
    expect(await post(owner, { title: 'x'.repeat(120) })).to.equal(200)
  }

  @test()
  async theLinkShowsAnyoneTheSharersTimeAndNoDetail() {
    const { owner, worker, colleague, project, agentId } = await this.world()
    const shared = await this.share(owner, project, { title: 'Sprint 12' })
    const report = await this.open(shared.token)

    expect(report).to.deep.include({
      title: 'Sprint 12',
      sharedBy: owner.name || owner.address,
      from: day(-3),
      to: day(1),
      timeZone: 'UTC',
      createdAt: shared.createdAt,
      projects: [{ id: project.id, title: project.title }],
    })
    const by = <T extends { userId?: string; day: string }>(rows: T[]) =>
      [...rows].sort(
        (a, b) =>
          a.day.localeCompare(b.day) ||
          (a.userId ?? '').localeCompare(b.userId ?? ''),
      )
    expect(report.daily).to.deep.equal(
      by([
        {
          day: day(-2),
          projectId: project.id,
          userId: worker.id,
          trackedSeconds: 3600,
        },
        {
          day: day(-1),
          projectId: project.id,
          userId: worker.id,
          trackedSeconds: 1800,
        },
        {
          day: day(-1),
          projectId: project.id,
          userId: colleague.id,
          trackedSeconds: 3600,
        },
        {
          day: day(-1),
          projectId: project.id,
          userId: owner.id,
          trackedSeconds: 1800,
        },
      ]),
    )
    expect(report.agentsDaily).to.deep.equal([
      {
        day: day(-1),
        projectId: project.id,
        userId: worker.id,
        agentId,
        workedSeconds: 1800,
      },
    ])
    // Everyone named by a row and nobody else; nameless people by address.
    expect(
      [...report.people].sort((a, b) => a.id.localeCompare(b.id)),
    ).to.deep.equal(
      [
        { id: owner.id, name: owner.address },
        { id: worker.id, name: 'Wanda Worker' },
        { id: colleague.id, name: colleague.address },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    )
    expect(report.agents).to.deep.equal([
      { id: agentId, name: 'My Codex', userId: worker.id },
    ])
    // Money was not switched on.
    expect(report).to.not.have.property('amounts')

    // Time and names, and nothing an entry or a run holds beyond them.
    expect(Object.keys(report).sort()).to.deep.equal(
      [
        'agents',
        'agentsDaily',
        'createdAt',
        'daily',
        'from',
        'people',
        'projects',
        'sharedBy',
        'timeZone',
        'title',
        'to',
      ].sort(),
    )
    const text = JSON.stringify(report)
    for (const detail of [
      'prompt',
      'Never shown',
      'note',
      'screenshot',
      'keyboardKeys',
      'minutesActive',
      'activeSeconds',
      'rateHour',
      'address":',
      shared.token,
    ])
      expect(text, detail).to.not.include(detail)

    // No session is read: a stale or foreign one changes nothing.
    for (const Authorization of [
      '',
      'garbage',
      'Bearer expired.or.forged',
      this.authenticator.getTokens(colleague).accessToken,
    ]) {
      const response = await this.client(undefined, { Authorization }).get(
        `/report/public/${shared.token}`,
      )
      expect(response.status, Authorization).to.equal(200)
      expect(response.data).to.deep.equal(report)
    }

    // A link that is not one.
    expect(await this.status('short')).to.equal(404)
    expect(await this.status('x'.repeat(43))).to.equal(404)
    expect(await this.status(`${shared.token}x`)).to.equal(404)
    expect(await this.status(shared.id)).to.equal(404)
  }

  @test()
  async eachSharerSharesWhatTheySeeAndNoMore() {
    const { owner, worker, colleague, viewer, project, agentId } =
      await this.world()

    // A worker: their own time and their own agents.
    const own = await this.open((await this.share(worker, project)).token)
    expect(own.daily).to.deep.equal([
      {
        day: day(-2),
        projectId: project.id,
        userId: worker.id,
        trackedSeconds: 3600,
      },
      {
        day: day(-1),
        projectId: project.id,
        userId: worker.id,
        trackedSeconds: 1800,
      },
    ])
    expect(own.people).to.deep.equal([{ id: worker.id, name: 'Wanda Worker' }])
    expect(own.agents.map((agent) => agent.id)).to.deep.equal([agentId])
    expect(own.sharedBy).to.equal('Wanda Worker')

    // A colleague who ran no agent shares none.
    const theirs = await this.open((await this.share(colleague, project)).token)
    expect(theirs.daily.map((row) => row.userId)).to.deep.equal([colleague.id])
    expect(theirs.agents).to.deep.equal([])
    expect(theirs.agentsDaily).to.deep.equal([])

    // A viewer: the project's time by day, with nobody and no agent in it.
    const viewed = await this.open((await this.share(viewer, project)).token)
    expect(viewed.daily).to.deep.equal([
      { day: day(-2), projectId: project.id, trackedSeconds: 3600 },
      { day: day(-1), projectId: project.id, trackedSeconds: 7200 },
    ])
    expect(viewed.people).to.deep.equal([])
    expect(viewed.agents).to.deep.equal([])
    expect(viewed.agentsDaily).to.deep.equal([])
    expect(viewed).to.not.have.property('amounts')

    // An owner narrowing to one person shares that person, agents included.
    const narrowed = await this.open(
      (await this.share(owner, project, { userIds: [colleague.id] })).token,
    )
    expect(narrowed.daily).to.deep.equal([
      {
        day: day(-1),
        projectId: project.id,
        userId: colleague.id,
        trackedSeconds: 3600,
      },
    ])
    expect(narrowed.people.map((person) => person.id)).to.deep.equal([
      colleague.id,
    ])
    expect(narrowed.agentsDaily).to.deep.equal([])

    // The report's own time zone cuts its days: noon UTC is the next day's
    // small hours fourteen hours ahead.
    const ahead = await this.open(
      (
        await this.share(worker, project, {
          timeZone: 'Pacific/Kiritimati',
          from: day(-3),
          to: day(2),
        })
      ).token,
    )
    expect(ahead.daily.map((row) => row.day)).to.deep.equal([day(-1), day(0)])
    expect(ahead.agentsDaily.map((row) => row.day)).to.deep.equal([day(0)])
    // A span that ends before the time started shows none of it.
    const before = await this.open(
      (await this.share(worker, project, { from: day(-9), to: day(-5) })).token,
    )
    expect(before.daily).to.deep.equal([])
    expect(before.people).to.deep.equal([])
    expect(before.projects).to.have.length(1)
  }

  @test()
  async amountsShowOnlyWhenSwitchedOnAtTodaysRates() {
    const { owner, worker, project } = await this.world()

    const everyone = await this.open(
      (await this.share(owner, project, { showAmounts: true })).token,
    )
    // Three hours at $60, and the agent's half hour at $12.
    expect(everyone.amounts).to.deep.equal({
      peopleCents: 18000,
      agentsCents: 600,
    })
    const mine = await this.share(worker, project, { showAmounts: true })
    expect((await this.open(mine.token)).amounts).to.deep.equal({
      peopleCents: 9000,
      agentsCents: 600,
    })
    const plain = await this.share(worker, project)
    expect(await this.open(plain.token)).to.not.have.property('amounts')

    // Read at today's rates each time, not the rates of the day it was shared.
    await App.conn.getRepository(Project).update(project.id, { rateHour: 120 })
    expect((await this.open(mine.token)).amounts).to.deep.equal({
      peopleCents: 18000,
      agentsCents: 600,
    })

    // A sharer who can no longer see money shares none, whatever they chose.
    const stored = await App.conn
      .getRepository(Project)
      .findOneByOrFail({ id: project.id })
    stored.workerAddresses = stored.workerAddresses.filter(
      (address) => address !== worker.address,
    )
    stored.viewerAddresses = [...stored.viewerAddresses, worker.address]
    await App.conn.manager.save(stored)
    const demoted = await this.open(mine.token)
    expect(demoted).to.not.have.property('amounts')
    expect(demoted.daily.every((row) => !('userId' in row))).to.equal(true)
    expect(demoted.people).to.deep.equal([])
    expect(demoted.agents).to.deep.equal([])
  }

  @test()
  async aProjectTheSharerLosesDropsOutAndTheLastOneEndsTheLink() {
    const { owner, worker, project } = await this.world(false)
    const second = await this.projectFixture.createPersonal(owner, 60)
    second.workerAddresses = [worker.address]
    await App.conn.manager.save(second)
    await this.track(second, worker, -1, 18, 30)
    const shared = await this.share(worker, project, {
      projectIds: [project.id, second.id],
    })

    const both = await this.open(shared.token)
    expect(both.projects.map((p) => p.id).sort()).to.deep.equal(
      [project.id, second.id].sort(),
    )

    const leave = async (id: string) => {
      const stored = await App.conn
        .getRepository(Project)
        .findOneByOrFail({ id })
      stored.workerAddresses = stored.workerAddresses.filter(
        (address) => address !== worker.address,
      )
      await App.conn.manager.save(stored)
    }
    await leave(second.id)
    const one = await this.open(shared.token)
    expect(one.projects).to.deep.equal([
      { id: project.id, title: project.title },
    ])
    expect(one.daily.every((row) => row.projectId === project.id)).to.equal(
      true,
    )

    await leave(project.id)
    expect(await this.status(shared.token)).to.equal(404)
    // The report is still the sharer's to list and delete.
    expect((await this.client(worker).get('/report')).data).to.have.length(1)
  }

  @test()
  async aFreePlanHidesAReportThatReachesPastItsWindow() {
    this.parameters.entitlementSecret = 'secret'
    const users = this.container.get<UserManager>('UserManager')
    const owner = await this.userFixture.createUser()
    const project = await this.projectFixture.createPersonal(owner, 60)
    await this.track(project, owner, -1, 12, 60)

    const long = await this.share(owner, project, { from: day(-30) })
    const short = await this.share(owner, project, { from: day(-7) })

    const gone = await this.client().get(`/report/public/${long.token}`)
    expect(gone.status).to.equal(410)
    expect(gone.data.reason).to.equal('retention')
    expect(await this.status(short.token)).to.equal(200)

    // Upgrading brings it back; so does a self-hosted instance.
    owner.premium = true
    await runPromise(users.saveSingle(owner))
    expect((await this.open(long.token)).daily).to.have.length(1)
    owner.premium = false
    await runPromise(users.saveSingle(owner))
    expect(await this.status(long.token)).to.equal(410)
    this.parameters.entitlementSecret = ''
    expect(await this.status(long.token)).to.equal(200)
  }

  @test()
  async aReportOfTheSharersOwnTimeOnOneProjectCanBeInvoicedOnce() {
    const { owner, worker, viewer, project } = await this.world(false)
    const other = await this.projectFixture.createPersonal(owner, 60)
    other.workerAddresses = [worker.address]
    await App.conn.manager.save(other)

    // A worker's report is their own time, whoever it names.
    const mine = await this.share(worker, project)
    expect(mine.canInvoice).to.equal(true)
    expect(
      (await this.share(worker, project, { userIds: [worker.id] })).canInvoice,
    ).to.equal(true)
    // An owner's is, only when it names them alone.
    const everyone = await this.share(owner, project)
    expect(everyone.canInvoice).to.equal(false)
    const justMe = await this.share(owner, project, { userIds: [owner.id] })
    expect(justMe.canInvoice).to.equal(true)
    expect(
      (
        await this.share(owner, project, {
          userIds: [owner.id, worker.id],
        })
      ).canInvoice,
    ).to.equal(false)
    // Never two projects, and never a viewer.
    const two = await this.share(worker, project, {
      projectIds: [project.id, other.id],
    })
    expect(two.canInvoice).to.equal(false)
    const viewed = await this.share(viewer, project)
    expect(viewed.canInvoice).to.equal(false)

    const invoice = (sharer: User, id: string) =>
      this.client(sharer).post(`/report/${id}/invoice`, {})

    for (const [sharer, report] of [
      [owner, everyone],
      [worker, two],
      [viewer, viewed],
    ] as const)
      expect((await invoice(sharer, report.id)).status).to.equal(400)
    expect((await invoice(owner, mine.id)).status).to.equal(403)
    expect((await invoice(worker, 'not-an-id')).status).to.equal(404)
    expect(
      (await this.client().post(`/report/${mine.id}/invoice`)).status,
    ).to.equal(401)

    // The invoice is the period's, by the invoice's own rules.
    const made = await invoice(worker, mine.id)
    expect(made.status, JSON.stringify(made.data)).to.equal(200)
    expect(Object.keys(made.data)).to.deep.equal(['id'])
    const read = await this.client(worker).get(`/invoice/${made.data.id}`)
    expect(read.status).to.equal(200)
    // An hour and a half at $60.
    expect(read.data.amountCents).to.equal(9000)
    expect(read.data.project.id).to.equal(project.id)
    expect(new Date(read.data.fromAt).getTime()).to.equal(midnight(-3))
    expect(new Date(read.data.toAt).getTime()).to.equal(midnight(1))

    // Asked again, the same invoice; the report remembers it.
    expect((await invoice(worker, mine.id)).data).to.deep.equal(made.data)
    const listed = (await this.client(worker).get('/report'))
      .data as ISharedReportView[]
    expect(listed.find((report) => report.id === mine.id)).to.include({
      invoiceId: made.data.id,
      canInvoice: false,
    })
    expect(
      (
        await this.client(worker).post('/invoice/search', {
          filter: { projectId: project.id },
          sort: { createdAt: 'DESC' },
          page: 0,
        })
      ).data[1],
    ).to.equal(1)

    // A second report of time that is now billed has nothing left to bill,
    // and stays without an invoice.
    const again = await this.share(worker, project)
    expect(again.canInvoice).to.equal(true)
    expect((await invoice(worker, again.id)).status).to.equal(400)
    expect(
      (
        (await this.client(worker).get('/report')).data as ISharedReportView[]
      ).find((report) => report.id === again.id),
    ).to.include({ invoiceId: null, canInvoice: true })

    // The owner bills their own half hour the same way.
    const theirs = await invoice(owner, justMe.id)
    expect(theirs.status).to.equal(200)
    expect(
      (await this.client(owner).get(`/invoice/${theirs.data.id}`)).data
        .amountCents,
    ).to.equal(3000)
  }

  @test()
  async aLinksSecretStaysOutOfTheRequestLog() {
    const { owner, project } = await this.world(false)
    const shared = await this.share(owner, project)
    const logger = this.container.get<ILogger>('ILogger')
    const info = logger.info
    const logged: { url?: string }[] = []
    logger.info = (_message, entry) => {
      logged.push(entry as { url?: string })
    }

    try {
      expect(await this.status(shared.token)).to.equal(200)
      expect(await this.status(`${shared.token}?from=mail`)).to.equal(200)
      // The line is written once the response has gone out.
      await new Promise((resolve) => setTimeout(resolve, 50))
    } finally {
      logger.info = info
    }

    expect(logged.map((entry) => entry.url)).to.deep.equal([
      '/api/report/public/[REDACTED]',
      '/api/report/public/[REDACTED]?from=mail',
    ])
    expect(JSON.stringify(logged)).to.not.include(shared.token)
  }

  @test()
  @timeout(20000)
  async oneAddressOpensOnlySoManyLinksAtOnce() {
    const from = (address: string) =>
      this.client(undefined, { 'X-Forwarded-For': address }).get(
        '/report/public/not-a-link',
      )
    const answers = await Promise.all(
      Array.from({ length: 80 }, () => from('203.0.113.77')),
    )
    const refused = answers.filter((answer) => answer.status === 429)

    expect(refused.length).to.be.greaterThan(0)
    expect(answers.filter((answer) => answer.status === 404)).to.have.length(
      80 - refused.length,
    )
    expect(refused[0].headers['retry-after']).to.equal('1')
    expect(refused[0].data).to.include({ message: 'RATE_LIMITED' })
    // Another address has its own allowance.
    expect((await from('203.0.113.78')).status).to.equal(404)
  }
}
