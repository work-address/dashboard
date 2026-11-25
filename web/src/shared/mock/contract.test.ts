import {
  CONTRACT_SCENARIOS,
  contractSpan,
  runScenario,
  type ContractAdapter,
  type ContractPerson,
  type ContractReader,
  type ContractRequest,
} from '@work-address/api-contract'
import { humanLine } from '@work-address/statistics-core'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { handlers } from './handlers'
import { DEMO_ACCESS_TOKEN } from './session'
import { demoDb } from './store'

import type {
  MockInvoice,
  MockProject,
  MockReport,
  MockRun,
  MockTime,
} from './db'

const server = setupServer(...handlers)

const HOUR = 3_600_000

const PEOPLE: Record<ContractPerson, string> = {
  owner: 'contract-owner',
  worker: 'contract-worker',
  viewer: 'contract-viewer',
  outsider: 'contract-outsider',
  freeOwner: 'contract-free-owner',
}

/** The demo's mock over MSW, held to what the API answers. */
const mock: ContractAdapter = {
  async seed() {
    const db = demoDb()
    const person = db.users[0]
    db.users = Object.values(PEOPLE).map((id) => ({
      ...person,
      id,
      address: `address-${id}`,
      premium: id !== PEOPLE.freeOwner,
    }))
    const project = (
      id: string,
      state: MockProject['state'],
      people: Pick<MockProject, 'ownerId' | 'workerIds' | 'viewerIds'> = {
        ownerId: PEOPLE.owner,
        workerIds: [PEOPLE.worker],
        viewerIds: [PEOPLE.viewer],
      },
    ): MockProject => ({
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: id,
      text: '',
      rateHour: '60',
      state,
      ...people,
      trackScreenshots: false,
      trackProcesses: false,
      trackAgents: false,
      trackWindowTitles: false,
      trackBrowserDomains: false,
      allowManualTime: true,
      allowMobileTime: false,
      trackLocation: false,
      reviewWindowHours: 24,
      screenshotRetentionDays: null,
      deletedAt: null,
    })
    db.projects = [
      {
        ...project('active', 'Active'),
        // The worker's first agent is on the project at $12/h.
        agentRates: { [`${PEOPLE.worker}:claude-code`]: 1200 },
      },
      project('closed', 'Inactive'),
      project('free', 'Active', {
        ownerId: PEOPLE.freeOwner,
        workerIds: [],
        viewerIds: [],
      }),
    ]
    const entry = (
      id: string,
      hoursAgo: number,
      fields: Partial<MockTime> = {},
    ): MockTime => ({
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectId: 'active',
      userId: PEOPLE.worker,
      fromAt: new Date(Date.now() - hoursAgo * HOUR - HOUR / 2).toISOString(),
      toAt: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
      isPaid: false,
      note: id,
      screenshot: null,
      appsStatus: 'ok',
      apps: [{ name: 'code', seconds: 60 }],
      source: 'desktop',
      locationStatus: null,
      locations: [],
      publishedAt: null,
      minutesActive: 5,
      keyboardKeys: 1,
      mouseKeys: 1,
      mouseDistance: 1,
      invoiceId: null,
      ...fields,
    })
    db.times = [
      entry('draft', 1),
      entry('old', 72),
      entry('loose', 100),
      entry('paid', 101, { isPaid: true }),
      entry('invoiced', 200, { invoiceId: 'invoice' }),
      entry('closed', 2, { projectId: 'closed' }),
      entry('own', 5, { userId: PEOPLE.owner }),
      entry('settled', 300, { invoiceId: 'settled' }),
      entry('free', 4, {
        projectId: 'free',
        userId: PEOPLE.freeOwner,
        invoiceId: 'free',
        isPaid: true,
      }),
      entry('free-old', 20 * 24, {
        projectId: 'free',
        userId: PEOPLE.freeOwner,
      }),
    ]
    const invoice: MockInvoice = {
      id: 'invoice',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectId: 'active',
      userId: PEOPLE.worker,
      fromAt: new Date(Date.now() - 201 * HOUR).toISOString(),
      toAt: new Date(Date.now() - 200 * HOUR).toISOString(),
      amountCents: 3000,
      // Half an hour at $60, as the API would have frozen it.
      lines: [
        humanLine(
          [
            {
              fromAt: 0,
              toAt: 30 * 60_000,
              source: 'desktop',
              minutesActive: 5,
            },
          ],
          60,
        ),
      ],
      state: 'Requested',
      rejectionReason: null,
      rejectedAt: null,
      paidAt: null,
      timeIds: ['invoiced'],
    }
    db.invoices = [
      invoice,
      {
        ...invoice,
        id: 'settled',
        fromAt: new Date(Date.now() - 301 * HOUR).toISOString(),
        toAt: new Date(Date.now() - 300 * HOUR).toISOString(),
        state: 'PAID',
        paidAt: new Date().toISOString(),
        timeIds: ['settled'],
      },
      {
        ...invoice,
        id: 'free',
        projectId: 'free',
        userId: PEOPLE.freeOwner,
        fromAt: new Date(Date.now() - 5 * HOUR).toISOString(),
        toAt: new Date(Date.now() - 4 * HOUR).toISOString(),
        timeIds: ['free'],
      },
    ]
    // Timed from the draft entry itself, so what overlaps it is exact.
    const draftFrom = Date.parse(db.times[0].fromAt)
    const run = (
      product: string,
      status: string,
      from: number,
      minutes: number,
    ): MockRun => ({
      runKey: `run-${product}`,
      userId: PEOPLE.worker,
      projectId: 'active',
      // Its source's own id: the demo's agent is `userId:product`.
      agentId: `instance-${product}`,
      product,
      surface: 'cli',
      fromAt: new Date(from).toISOString(),
      toAt: new Date(from + minutes * 60_000).toISOString(),
      status,
      segments: [
        {
          state: 'running',
          fromAt: new Date(from).toISOString(),
          toAt: new Date(from + minutes * 60_000).toISOString(),
          evidence: 'contract',
        },
      ],
      prompt: null,
      invoiceId: null,
      isPaid: false,
    })
    const agentRunFromUnix = draftFrom - 10 * 60_000
    const otherAgentRunFromUnix = draftFrom - 26 * HOUR
    db.runs = [
      run('claude-code', 'completed', agentRunFromUnix, 30),
      run('codex', 'failed', otherAgentRunFromUnix, 10),
    ]
    db.reports = []
    // Each a second newer than the one before, so a list has an order.
    const share = (
      id: string,
      sharer: ContractPerson,
      fields: Partial<MockReport> = {},
    ) =>
      db.reports.push({
        id,
        createdAt: new Date(
          Date.now() - 60_000 + db.reports.length * 1000,
        ).toISOString(),
        userId: PEOPLE[sharer],
        token: `link-${id}`.padEnd(43, '-'),
        title: null,
        ...contractSpan(),
        projectIds: ['active'],
        userIds: [],
        showAmounts: false,
        invoiceId: null,
        ...fields,
      })
    share('report-owner', 'owner', { showAmounts: true })
    share('report-viewer', 'viewer')
    share('report-invoiced', 'worker', { invoiceId: 'invoice' })
    // The newest of the worker's. The one they deleted is simply not kept.
    share('report-worker', 'worker')
    share('report-free', 'freeOwner', { projectIds: ['free'] })
    share('report-free-recent', 'freeOwner', {
      projectIds: ['free'],
      ...contractSpan(7),
    })
    const linkOf = (id: string) => ({
      id,
      token: db.reports.find((row) => row.id === id)?.token ?? `gone-${id}`,
    })

    return {
      project: 'active',
      ownerId: PEOPLE.owner,
      workerId: PEOPLE.worker,
      draftEntry: 'draft',
      oldEntry: 'old',
      looseEntry: 'loose',
      paidEntry: 'paid',
      billableFromUnix: Date.now() - 102 * HOUR,
      billableToUnix: Date.now() - 99 * HOUR,
      invoicedEntry: 'invoiced',
      invoice: 'invoice',
      closedEntry: 'closed',
      ownerEntry: 'own',
      settledEntry: 'settled',
      agent: `${PEOPLE.worker}:claude-code`,
      otherAgent: `${PEOPLE.worker}:codex`,
      agentRunFromUnix,
      otherAgentRunFromUnix,
      freeProject: 'free',
      freeInvoice: 'free',
      ownerReport: linkOf('report-owner'),
      workerReport: linkOf('report-worker'),
      viewerReport: linkOf('report-viewer'),
      invoicedReport: linkOf('report-invoiced'),
      deletedReport: linkOf('report-deleted'),
      freeReport: linkOf('report-free'),
      freeRecentReport: linkOf('report-free-recent'),
    }
  },

  async send(reader: ContractReader, request: ContractRequest) {
    // With no session the demo is still someone's: a stranger's here, so a
    // route that is open to anyone cannot lean on who is signed in.
    demoDb().meId = PEOPLE[reader === 'anyone' ? 'outsider' : reader]
    const response = await fetch(`http://demo.test/api${request.path}`, {
      method: request.method.toUpperCase(),
      headers: {
        ...(reader === 'anyone' ? {} : { authorization: DEMO_ACCESS_TOKEN }),
        'content-type': 'application/json',
      },
      body:
        request.method === 'get'
          ? undefined
          : JSON.stringify(request.body ?? {}),
    })
    // A deletion answers 204, with nothing to parse.
    const text = await response.text()

    return { status: response.status, body: text ? JSON.parse(text) : null }
  },
}

/**
 * Scenarios the mock no longer runs, each with the core rule that decides it.
 * The mock calls the shared core (`@work-address/statistics-core`) for these,
 * which tests them once in packages/statistics-core/test, and another
 * scenario here still holds the mock's wiring of the same rule. The API runs
 * every scenario, since its SQL forms are not the core's.
 */
const COVERED_BY_CORE: Record<string, string> = {
  'an author sees their own detail before review': 'seesDetail',
  'the owner sees detail once the review window ends': 'seesDetail',
  'a viewer lists no entries': 'listsRow',
  'naming a person shows a viewer no entries either': 'listsRow',
  'the owner lists everyone’s entries': 'listsRow',
  'an outsider sees nothing': 'listsRow',
  'a viewer cannot read an entry': 'listsRow',
  'an invoice bills each unpaid entry’s own span in the period':
    'invoiceable, humanLine',
}

describe('demo mock contract', () => {
  beforeAll(() => server.listen())
  afterAll(() => server.close())

  it('leaves out only scenarios that exist', () => {
    const names = new Set(CONTRACT_SCENARIOS.map((scenario) => scenario.name))

    expect(
      Object.keys(COVERED_BY_CORE).filter((name) => !names.has(name)),
    ).toEqual([])
  })

  for (const scenario of CONTRACT_SCENARIOS) {
    if (scenario.name in COVERED_BY_CORE) {
      continue
    }
    it(scenario.name, async () => {
      expect(await runScenario(mock, scenario)).toBeUndefined()
    })
  }
})
