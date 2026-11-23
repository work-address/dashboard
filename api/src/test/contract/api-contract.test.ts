import { suite, test, timeout } from '@testdeck/mocha'
import axios from 'axios'
import { expect } from 'chai'
import { randomUUID } from 'crypto'
import moment from 'moment'

import {
  CONTRACT_SCENARIOS,
  ContractAdapter,
  ContractPerson,
  ContractReader,
  ContractReport,
  ContractRequest,
  ContractWorld,
  contractSpan,
  runScenario,
} from '@work-address/api-contract'

import { getDataSource } from '@/connector/data-source'
import { Project } from '@/entity/project'
import { TimeAgent } from '@/entity/time-agent'
import { User } from '@/entity/user'
import { EProjectState } from '@/model/project'
import { ProjectRepository } from '@/repository/project-repository'
import { SharedReportRepository } from '@/repository/shared-report-repository'
import { TimeRepository } from '@/repository/time-repository'
import { BaseControllerTest } from '@/test/controller/base-controller.test'
import { runPromise } from '@/service/effect-bridge'
import { InvoiceManager } from '@/service/invoice-manager'
import { SharedReportManager } from '@/service/shared-report-manager'
import { TimeManager } from '@/service/time-manager'

/** The real API over HTTP and Postgres: what the demo's mock is held to. */
@suite()
export class ApiContractTest
  extends BaseControllerTest
  implements ContractAdapter
{
  private people: Record<ContractPerson, User>
  private savedSecret: string

  constructor() {
    super()
    this.savedSecret = this.parameters.entitlementSecret
    // Hosted, as the demo is: only there is the Free plan a plan with limits.
    this.parameters.entitlementSecret = 'secret'
  }

  async after() {
    this.parameters.entitlementSecret = this.savedSecret
    await super.after()
  }

  /** A finished run of the worker's, one running stretch long. */
  private async agentRun(
    project: Project,
    worker: User,
    run: Pick<TimeAgent, 'agentId' | 'product' | 'status'>,
    from: moment.Moment,
    minutes: number,
  ): Promise<number> {
    const to = from.clone().add(minutes, 'minutes')
    await getDataSource()
      .getRepository(TimeAgent)
      .save({
        ...run,
        runKey: randomUUID().split('-').join(''),
        userId: worker.id,
        projectId: project.id,
        surface: 'cli',
        sourceInstanceId: randomUUID(),
        sourceSessionId: 'contract',
        sourceRunId: randomUUID(),
        sourceAgentId: 'root',
        fromAt: from.toDate(),
        toAt: to.toDate(),
        prompt: null,
        segments: [
          {
            state: 'running',
            fromAt: from.toISOString(),
            toAt: to.toISOString(),
            evidence: 'contract',
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
    return from.valueOf()
  }

  async seed(): Promise<ContractWorld> {
    const projects = this.container.get<ProjectRepository>('ProjectRepository')
    const times = this.container.get<TimeRepository>('TimeRepository')
    const invoices = this.container.get<InvoiceManager>('InvoiceManager')
    const owner = await this.userFixture.createPremiumUser()
    const worker = await this.userFixture.createUser()
    const viewer = await this.userFixture.createUser()
    const outsider = await this.userFixture.createUser()
    const freeOwner = await this.userFixture.createUser()
    this.people = { owner, worker, viewer, outsider, freeOwner }

    const onProject = async (state: EProjectState) => {
      const project = await this.projectFixture.createPersonal(owner, 60)
      project.state = state
      project.reviewWindowHours = 24
      project.workerAddresses = [worker.address]
      project.viewerAddresses = [viewer.address]
      return runPromise(projects.saveSingle(project))
    }
    const project = await onProject(EProjectState.ACTIVE)
    const closed = await onProject(EProjectState.INACTIVE)

    const entry = async (
      onto: typeof project,
      hoursAgo: number,
      note: string,
      author: User = worker,
    ) => {
      const to = moment.utc().subtract(hoursAgo, 'hours')
      const time = await this.timeFixture.create(
        onto,
        to.clone().subtract(30, 'minutes').toDate(),
        to.toDate(),
        author,
      )
      time.note = note
      return runPromise(times.saveSingle(time))
    }

    const draft = await entry(project, 1, 'draft')
    const old = await entry(project, 72, 'old')
    const loose = await entry(project, 100, 'loose')
    const paid = await entry(project, 101, 'paid')
    paid.isPaid = true
    await runPromise(times.saveSingle(paid))
    const invoiced = await entry(project, 200, 'invoiced')
    const closedEntry = await entry(closed, 2, 'closed')
    const invoice = await runPromise(
      invoices.createFromTimeIds(project, worker, [invoiced.id]),
    )
    const ownerEntry = await entry(project, 5, 'own', owner)
    const settled = await entry(project, 300, 'settled')
    await runPromise(
      invoices.markPaid(
        await runPromise(
          invoices.createFromTimeIds(project, worker, [settled.id]),
        ),
        worker,
      ),
    )
    const timeManager = this.container.get<TimeManager>('TimeManager')
    await runPromise(timeManager.setIsPaidMany([settled.id], false, worker))

    // Timed from the draft entry itself, so what overlaps it is exact.
    const agent = randomUUID()
    const otherAgent = randomUUID()
    const agentRunFromUnix = await this.agentRun(
      project,
      worker,
      { agentId: agent, product: 'claude-code', status: 'completed' },
      moment.utc(draft.fromAt).subtract(10, 'minutes'),
      30,
    )
    const otherAgentRunFromUnix = await this.agentRun(
      project,
      worker,
      { agentId: otherAgent, product: 'codex', status: 'failed' },
      moment.utc(draft.fromAt).subtract(26, 'hours'),
      10,
    )

    // The first agent is the worker's by name and on the project at $12/h.
    const at = new Date().toISOString()
    await getDataSource()
      .getRepository(User)
      .update(worker.id, {
        agents: [
          {
            id: agent,
            name: 'claude-code',
            slug: 'claude-code',
            product: 'claude-code',
            isDefault: true,
            bindings: [],
            createdAt: at,
            removedAt: null,
          },
        ],
      })
    await getDataSource()
      .getRepository(Project)
      .update(project.id, {
        agentAttachments: [
          {
            agentId: agent,
            workerId: worker.id,
            rateHourCents: 1200,
            rateChanges: [],
            attachedAt: at,
            detachedAt: null,
          },
        ],
      })

    const freeProject = await this.projectFixture.createPersonal(freeOwner, 60)
    const free = await entry(freeProject, 4, 'free', freeOwner)
    const freeInvoice = await runPromise(
      invoices.createFromTimeIds(freeProject, freeOwner, [free.id]),
    )
    await runPromise(timeManager.setIsPaidMany([free.id], true, freeOwner))

    const reports = this.container.get<SharedReportManager>(
      'SharedReportManager',
    )
    const share = async (
      sharer: User,
      projectId: string,
      fields: { days?: number; showAmounts?: boolean } = {},
    ): Promise<ContractReport> => {
      const { id, token } = await reports.create(
        {
          ...contractSpan(fields.days),
          projectIds: [projectId],
          showAmounts: fields.showAmounts,
        },
        sharer,
      )
      return { id, token }
    }
    const ownerReport = await share(owner, project.id, { showAmounts: true })
    const viewerReport = await share(viewer, project.id)
    const invoicedReport = await share(worker, project.id)
    await this.container
      .get<SharedReportRepository>('SharedReportRepository')
      .linkInvoice(invoicedReport.id, invoice.id)
    const deletedReport = await share(worker, project.id)
    await reports.remove(deletedReport.id, worker)
    // The newest of the worker's, so their list has it first.
    const workerReport = await share(worker, project.id)
    const freeReport = await share(freeOwner, freeProject.id)
    const freeRecentReport = await share(freeOwner, freeProject.id, { days: 7 })

    return {
      project: project.id,
      ownerId: owner.id,
      workerId: worker.id,
      draftEntry: draft.id,
      oldEntry: old.id,
      looseEntry: loose.id,
      paidEntry: paid.id,
      billableFromUnix: moment.utc().subtract(102, 'hours').valueOf(),
      billableToUnix: moment.utc().subtract(99, 'hours').valueOf(),
      invoicedEntry: invoiced.id,
      invoice: invoice.id,
      closedEntry: closedEntry.id,
      ownerEntry: ownerEntry.id,
      settledEntry: settled.id,
      agent,
      otherAgent,
      agentRunFromUnix,
      otherAgentRunFromUnix,
      freeProject: freeProject.id,
      freeInvoice: freeInvoice.id,
      ownerReport,
      workerReport,
      viewerReport,
      invoicedReport,
      deletedReport,
      freeReport,
      freeRecentReport,
    }
  }

  async send(reader: ContractReader, request: ContractRequest) {
    const { status, data } = await axios.request({
      baseURL: `${this.url}/api`,
      url: request.path,
      method: request.method,
      data: request.body ?? {},
      validateStatus: () => true,
      headers:
        reader === 'anyone'
          ? {}
          : {
              Authorization: this.authenticator.getTokens(this.people[reader])
                .accessToken,
            },
    })

    return { status, body: data }
  }

  @test()
  @timeout(60000)
  async everyScenario() {
    const failures: string[] = []

    for (const scenario of CONTRACT_SCENARIOS) {
      const failure = await runScenario(this, scenario)
      if (failure) failures.push(`${scenario.name}: ${failure}`)
    }

    expect(failures).to.deep.equal([])
  }
}
