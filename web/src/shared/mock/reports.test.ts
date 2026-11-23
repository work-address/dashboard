import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { handlers } from './handlers'
import { DEMO_ACCESS_TOKEN } from './session'
import { demoDb } from './store'

import type { MockProject } from './db'

const server = setupServer(...handlers)

const DAY_MS = 86_400_000
const day = (offset: number) =>
  new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10)

/** A request to the demo; `session: false` sends it as someone signed out. */
const call = async (
  method: string,
  path: string,
  body?: unknown,
  { session = true } = {},
) => {
  const response = await fetch(`http://demo.test/api${path}`, {
    method,
    headers: {
      ...(session ? { authorization: DEMO_ACCESS_TOKEN } : {}),
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()

  return { status: response.status, body: text ? JSON.parse(text) : null }
}

const span = (days = 13) => ({ from: day(-days), to: day(1), timeZone: 'UTC' })

const share = (fields: Record<string, unknown>) =>
  call('post', '/report', { ...span(), ...fields })

/** The link, opened by someone with no session. */
const open = (token: string) =>
  call('get', `/report/public/${token}`, undefined, { session: false })

const sum = <T>(rows: T[], of: (row: T) => number) =>
  rows.reduce((total, row) => total + of(row), 0)

/** The visitor's projects with time on them, busiest first. */
const tracked = () => {
  const db = demoDb()
  const seconds = (project: MockProject) =>
    db.times.filter((time) => time.projectId === project.id).length

  return db.projects
    .filter((project) => project.ownerId === db.meId && seconds(project) > 0)
    .sort((a, b) => seconds(b) - seconds(a))
}

/** The demo's shared reports, held to what the API's routes answer. */
describe('shared reports in the demo', () => {
  beforeAll(() => server.listen())
  afterAll(() => server.close())

  it('shares a span, lists it, opens its link with no session and ends it', async () => {
    const projectIds = tracked()
      .slice(0, 2)
      .map((project) => project.id)
    const shared = await share({ projectIds, title: '  Sprint 12  ' })

    expect(shared.status).toBe(200)
    expect(shared.body).toMatchObject({
      title: 'Sprint 12',
      ...span(),
      projectIds,
      userIds: [],
      showAmounts: false,
      invoiceId: null,
      canInvoice: false,
    })
    expect(shared.body.token).toMatch(/^[\w-]{43}$/)
    expect(shared.body.id).toMatch(/^[\da-f-]{36}$/)

    const listed = await call('get', '/report')

    expect(listed.body[0]).toEqual(shared.body)

    const report = await open(shared.body.token)

    expect(report.status).toBe(200)
    expect(Object.keys(report.body).sort()).toEqual([
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
    ])
    expect(report.body).toMatchObject({
      title: 'Sprint 12',
      ...span(),
      createdAt: shared.body.createdAt,
    })
    expect(report.body.sharedBy).toBeTruthy()
    expect(
      report.body.projects.map((project: { id: string }) => project.id).sort(),
    ).toEqual([...projectIds].sort())

    // The same time the dashboard counts for the visitor, by person.
    const query = { ...span(), projectIds }
    const overview = await call('post', '/statistics/overview', query)
    const daily = report.body.daily as {
      userId?: string
      trackedSeconds: number
    }[]

    expect(daily.length).toBeGreaterThan(0)
    expect(daily.every((row) => typeof row.userId === 'string')).toBe(true)
    expect(sum(daily, (row) => row.trackedSeconds)).toBe(
      sum(
        overview.body.totals as { trackedSeconds: number }[],
        (row) => row.trackedSeconds,
      ),
    )
    // Everyone a row names is named once, and nobody else is.
    const people = report.body.people as { id: string; name: string }[]
    const agentsDaily = report.body.agentsDaily as {
      userId: string
      agentId: string
      workedSeconds: number
    }[]

    expect(people.map((person) => person.id).sort()).toEqual(
      [
        ...new Set([
          ...daily.map((row) => row.userId),
          ...agentsDaily.map((row) => row.userId),
        ]),
      ].sort(),
    )
    expect(people.every((person) => person.name.length > 0)).toBe(true)
    expect(
      (report.body.agents as { id: string }[]).map((agent) => agent.id).sort(),
    ).toEqual([...new Set(agentsDaily.map((row) => row.agentId))].sort())

    // Agents' work is what the agent report splits into assisted and
    // autonomous, to within a second's rounding a row.
    const agents = await call('post', '/statistics/agents/daily', query)
    const worked = sum(
      agents.body.daily as {
        assistedSeconds: number
        autonomousSeconds: number
      }[],
      (row) => row.assistedSeconds + row.autonomousSeconds,
    )

    expect(agentsDaily.length).toBeGreaterThan(0)
    expect(
      Math.abs(sum(agentsDaily, (row) => row.workedSeconds) - worked),
    ).toBeLessThanOrEqual(agentsDaily.length + agents.body.daily.length)

    // No detail, and no money that was not switched on.
    const text = JSON.stringify(report.body)

    for (const detail of ['prompt', 'note', 'screenshot', 'rateHour', 'apps']) {
      expect(text).not.toContain(`"${detail}"`)
    }
    expect(report.body).not.toHaveProperty('amounts')

    // Deleting it ends the link.
    expect((await call('delete', `/report/${shared.body.id}`)).status).toBe(204)
    expect((await open(shared.body.token)).status).toBe(404)
    expect(
      (await call('get', '/report')).body.map((row: { id: string }) => row.id),
    ).not.toContain(shared.body.id)
    expect((await call('delete', `/report/${shared.body.id}`)).status).toBe(404)
  })

  it('shows amounts at today’s rates only when the sharer switched them on', async () => {
    const [project] = tracked()
    const shared = await share({ projectIds: [project.id], showAmounts: true })
    const earned = async () =>
      (
        await call('post', '/statistics/overview', {
          ...span(),
          projectIds: [project.id],
        })
      ).body.totals[0].earnedCents as number
    const { body } = await open(shared.body.token)

    expect(body.amounts.peopleCents).toBe(await earned())
    expect(body.amounts.agentsCents).toBeGreaterThanOrEqual(0)

    // The project's rate doubles: the link follows, with nothing stored.
    const rateHour = project.rateHour

    project.rateHour = String(Number(rateHour) * 2)
    const doubled = (await open(shared.body.token)).body.amounts.peopleCents

    expect(doubled).toBe(await earned())
    expect(doubled).toBeGreaterThan(body.amounts.peopleCents)
    project.rateHour = rateHour
  })

  it('reads the link in the sharer’s scope as it is now', async () => {
    const db = demoDb()
    const [first, second] = tracked()
    const shared = await share({
      projectIds: [first.id, second.id],
      showAmounts: true,
    })
    const other = db.users.find((user) => user.id !== db.meId)!
    const { ownerId, viewerIds } = second

    // The visitor now only views the second project: its people fold into
    // the project's total, and money is shown on neither.
    second.ownerId = other.id
    second.viewerIds = [db.meId]
    const viewed = (await open(shared.body.token)).body
    const of = (id: string) =>
      (viewed.daily as { projectId: string }[]).filter(
        (row) => row.projectId === id,
      )

    expect(of(second.id).length).toBeGreaterThan(0)
    expect(of(second.id).every((row) => !('userId' in row))).toBe(true)
    expect(of(first.id).every((row) => 'userId' in row)).toBe(true)
    expect(
      (viewed.agentsDaily as { projectId: string }[]).every(
        (row) => row.projectId === first.id,
      ),
    ).toBe(true)
    expect(viewed).not.toHaveProperty('amounts')

    // Off the second project altogether, it drops out; off both, no link.
    second.viewerIds = []
    const left = (await open(shared.body.token)).body

    expect(left.projects).toEqual([{ id: first.id, title: first.title }])
    expect(left.amounts.peopleCents).toBeGreaterThan(0)
    first.ownerId = other.id
    expect((await open(shared.body.token)).status).toBe(404)
    // Still the sharer's to list and to delete.
    expect((await call('delete', `/report/${shared.body.id}`)).status).toBe(204)

    first.ownerId = ownerId
    second.ownerId = ownerId
    second.viewerIds = viewerIds
  })

  it('is gone on the free plan once its span reaches past 14 days', async () => {
    const db = demoDb()
    const me = db.users.find((user) => user.id === db.meId)!
    const [project] = tracked()
    const long = await share({ projectIds: [project.id], ...span(30) })
    const short = await share({ projectIds: [project.id], ...span(7) })

    expect((await open(long.body.token)).status).toBe(200)

    me.premium = false
    const gone = await open(long.body.token)

    expect(gone.status).toBe(410)
    expect(gone.body).toMatchObject({ reason: 'retention' })
    expect((await open(short.body.token)).status).toBe(200)

    // Upgrading brings it back.
    me.premium = true
    expect((await open(long.body.token)).status).toBe(200)
  })

  it('invoices a report of the visitor’s own time once, and remembers which invoice', async () => {
    const db = demoDb()
    const loose = (project: MockProject) =>
      db.times.filter(
        (time) =>
          time.projectId === project.id &&
          time.userId === db.meId &&
          !time.invoiceId &&
          !time.isPaid &&
          Date.parse(time.fromAt) >= Date.parse(`${day(-13)}T00:00:00Z`),
      )
    const project = tracked().find((candidate) => loose(candidate).length > 0)!
    const billed = loose(project).map((time) => time.id)

    // Everyone's time is not the owner's own; two projects are not one.
    expect((await share({ projectIds: [project.id] })).body.canInvoice).toBe(
      false,
    )
    expect(
      (
        await share({
          projectIds: tracked()
            .slice(0, 2)
            .map((candidate) => candidate.id),
          userIds: [db.meId],
        })
      ).body.canInvoice,
    ).toBe(false)

    const mine = await share({ projectIds: [project.id], userIds: [db.meId] })

    expect(mine.body.canInvoice).toBe(true)

    const made = await call('post', `/report/${mine.body.id}/invoice`, {})

    expect(made.status).toBe(200)
    expect(Object.keys(made.body)).toEqual(['id'])
    expect(
      db.invoices
        .find((invoice) => invoice.id === made.body.id)
        ?.timeIds.sort(),
    ).toEqual(billed.sort())
    expect(
      (await call('post', `/report/${mine.body.id}/invoice`, {})).body,
    ).toEqual(made.body)

    const listed = async () =>
      (await call('get', '/report')).body.find(
        (report: { id: string }) => report.id === mine.body.id,
      )

    expect(await listed()).toMatchObject({
      invoiceId: made.body.id,
      canInvoice: false,
    })

    // A day's invoices are drawn again at midnight: a report that outlives
    // its invoice reads as not invoiced.
    db.invoices = db.invoices.filter((invoice) => invoice.id !== made.body.id)
    expect(await listed()).toMatchObject({ invoiceId: null })
  })

  it('refuses what the API refuses', async () => {
    const db = demoDb()
    const [project] = tracked()
    const other = db.users.find((user) => user.id !== db.meId)!
    const status = async (fields: Record<string, unknown>) =>
      (await share({ projectIds: [project.id], ...fields })).status

    // No project named is every project, as the API has it.
    expect(await status({ projectIds: [] })).toBe(200)
    expect(await status({ projectIds: 'all' })).toBe(400)
    expect(
      await status({
        projectIds: Array.from({ length: 101 }, () => project.id),
      }),
    ).toBe(400)
    expect(await status({ title: 'x'.repeat(121) })).toBe(400)
    expect(await status({ title: '<b>March</b>' })).toBe(400)
    expect(await status({ title: 'Mar\u0007ch' })).toBe(400)
    expect(await status({ showAmounts: 'yes' })).toBe(400)
    expect(await status({ token: 'chosen-by-the-caller' })).toBe(400)
    expect(await status({ from: day(-400) })).toBe(400)
    expect(await status({ from: 'yesterday' })).toBe(400)
    expect(await status({ timeZone: 'Mars/Olympus' })).toBe(400)
    expect(await status({ projectIds: ['not-a-project'] })).toBe(403)
    expect(await status({ title: 'x'.repeat(120), userIds: [] })).toBe(200)

    // A viewer shares time; amounts they asked for are left off, not refused.
    const { ownerId, viewerIds } = project

    project.ownerId = other.id
    project.viewerIds = [db.meId]
    expect(await status({})).toBe(200)
    const viewed = await share({ projectIds: [project.id], showAmounts: true })
    expect(viewed.status).toBe(200)
    expect((viewed.body as { showAmounts: boolean }).showAmounts).toBe(false)
    expect(await status({ userIds: [other.id] })).toBe(403)
    project.ownerId = ownerId
    project.viewerIds = viewerIds

    // Only the link is open to someone with no session.
    const signedOut = { session: false }

    expect((await call('get', '/report', undefined, signedOut)).status).toBe(
      401,
    )
    expect(
      (await call('post', '/report', { ...span() }, signedOut)).status,
    ).toBe(401)
    expect((await open('not-a-link')).status).toBe(404)
    expect((await call('delete', '/report/not-a-report')).status).toBe(404)
    expect(
      (await call('post', '/report/not-a-report/invoice', {})).status,
    ).toBe(404)
  })
})
