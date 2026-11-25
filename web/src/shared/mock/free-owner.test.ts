import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { handlers } from './handlers'
import { DEMO_ACCESS_TOKEN } from './session'
import { demoDb } from './store'

import type { MockProject, MockRun, MockTime, MockUser } from './db'

/**
 * A free owner's workers, through the mock's routes. The plan limits only who
 * may record (`Plan.mayTrack`), never who keeps sight of the record or may
 * invoice it (`ProjectAccess.role` reads no plan).
 */
const server = setupServer(...handlers)

const HOUR = 3_600_000
const OWNER = 'free-owner'
const WORKERS = ['first-worker', 'second-worker', 'third-worker']

function seed() {
  const db = demoDb()
  const person = db.users[0]
  db.users = [OWNER, ...WORKERS].map(
    (id): MockUser => ({
      ...person,
      id,
      address: `address-${id}`,
      premium: false,
    }),
  )
  const project = (id: string, workerIds: string[]): MockProject => ({
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: id,
    text: '',
    rateHour: '60',
    state: 'Active',
    ownerId: OWNER,
    workerIds,
    viewerIds: [],
    trackScreenshots: false,
    trackProcesses: false,
    trackAgents: true,
    trackWindowTitles: false,
    trackBrowserDomains: false,
    allowManualTime: true,
    allowMobileTime: false,
    trackLocation: false,
    reviewWindowHours: 24,
    screenshotRetentionDays: null,
    deletedAt: null,
  })
  // Three workers listed across the owner's projects: one past the free plan.
  db.projects = [project('free', WORKERS.slice(0, 2)), project('more', WORKERS)]
  const from = Date.now() - 3 * HOUR
  db.times = [
    {
      id: 'entry',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectId: 'free',
      userId: WORKERS[0],
      fromAt: new Date(from).toISOString(),
      toAt: new Date(from + HOUR / 2).toISOString(),
      isPaid: false,
      note: 'entry',
      screenshot: null,
      appsStatus: 'ok',
      apps: [],
      source: 'desktop',
      locationStatus: null,
      locations: [],
      publishedAt: null,
      minutesActive: 5,
      keyboardKeys: 1,
      mouseKeys: 1,
      mouseDistance: 1,
      invoiceId: null,
    } satisfies MockTime,
  ]
  db.runs = [
    {
      runKey: 'run',
      userId: WORKERS[0],
      projectId: 'free',
      agentId: 'instance',
      product: 'claude-code',
      surface: 'cli',
      fromAt: new Date(from).toISOString(),
      toAt: new Date(from + HOUR / 2).toISOString(),
      status: 'completed',
      segments: [],
      prompt: null,
      invoiceId: null,
      isPaid: false,
    } satisfies MockRun,
  ]
  db.invoices = []
  db.reports = []
}

async function send(as: string, method: string, path: string, body?: unknown) {
  demoDb().meId = as
  const response = await fetch(`http://demo.test/api${path}`, {
    method,
    headers: {
      authorization: DEMO_ACCESS_TOKEN,
      'content-type': 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  const text = await response.text()

  return { status: response.status, body: text ? JSON.parse(text) : null }
}

describe('a free owner’s worker', () => {
  beforeAll(() => server.listen())
  afterAll(() => server.close())
  beforeEach(seed)

  it('sees the project, and may track on it within the plan’s workers', async () => {
    const { body } = await send(WORKERS[0], 'POST', '/project/search', {})
    const [projects] = body as [
      { id: string; role: string; canTrack: boolean }[],
    ]

    expect(projects.map((p) => [p.id, p.role, p.canTrack])).toEqual([
      ['free', 'worker', true],
      ['more', 'worker', true],
    ])
  })

  it('past the plan’s workers, still sees the project but may not track', async () => {
    const { body } = await send(WORKERS[2], 'POST', '/project/search', {})
    const [projects] = body as [
      { id: string; role: string; canTrack: boolean }[],
    ]

    expect(projects.map((p) => [p.id, p.role, p.canTrack])).toEqual([
      ['more', 'worker', false],
    ])
  })

  it('lists their own entries', async () => {
    const { body } = await send(WORKERS[0], 'POST', '/time/search', {})

    expect((body[0] as { id: string }[]).map((t) => t.id)).toEqual(['entry'])
  })

  it('invoices their own time', async () => {
    const { status, body } = await send(
      WORKERS[0],
      'POST',
      '/invoice/project/free',
    )

    expect(status).toBe(200)
    expect(body.amountCents).toBe(3000)
  })

  it('lists their own agent runs', async () => {
    const { body } = await send(WORKERS[0], 'POST', '/agent-tracking/search', {
      projectId: 'free',
    })

    expect((body[0] as { runKey: string }[]).map((r) => r.runKey)).toEqual([
      'run',
    ])
  })
})
