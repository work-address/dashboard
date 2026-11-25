import { describe, expect, it } from 'vitest'

import type { AgentsAddress, DashboardAddress, TimeAddress } from './index'

import { routes } from './index'

const A = '0b6c6f6e-6b1a-4c3e-9a51-2f0b7c1d9e01'
const B = '5f2d1c3b-8e4a-4b7f-a0c9-6d1e2f3a4b5c'
const U = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a'

/** The search of a built link, as the page it opens would see it. */
const searchOf = (link: string) =>
  new URL(link, 'https://app.test').searchParams

describe('page addresses round-trip', () => {
  it('dashboard: reads back what it writes', () => {
    const address: DashboardAddress = {
      from: '2026-11-01',
      to: '2026-11-30',
      projectIds: [A, B],
      userIds: [U],
    }

    expect(routes.dashboard.read(routes.dashboard.write(address))).toEqual(
      address,
    )
  })

  it('time: reads back what it writes', () => {
    const address: TimeAddress = {
      from: '2026-11-01',
      to: '2026-11-02',
      projectId: A,
      note: 'review',
      activeMin: 5,
      activeMax: 10,
      keysMin: 0,
      keysMax: 900,
      clicksMin: 1,
      clicksMax: 50,
      distanceMin: 0,
      distanceMax: 4000,
      sort: 'minutesActive',
      order: 'asc',
    }

    expect(routes.time.read(routes.time.write(address))).toEqual(address)
  })

  it('agents: reads back what it writes', () => {
    const address: AgentsAddress = {
      from: '2026-11-01',
      to: '2026-11-07',
      projectId: A,
      userId: U,
      agentId: 'agent-1',
      mode: 'fixed',
      status: 'failed',
      sessionId: 'session-1',
      period: 'lastWeek',
      run: 'run-1',
    }

    expect(routes.agents.read(routes.agents.write(address))).toEqual(address)
  })

  it('leaves an empty address bare', () => {
    expect(routes.dashboard.build()).toBe('/')
    expect(routes.time.build()).toBe('/time')
    expect(routes.agents.build({})).toBe('/agents')
  })
})

describe('the shared names', () => {
  it('spell projects and people the same on every page', () => {
    const dashboard = searchOf(
      routes.dashboard.build({ projectIds: [A], userIds: [U] }),
    )
    const time = searchOf(routes.time.build({ projectId: A }))
    const agents = searchOf(routes.agents.build({ projectId: A, userId: U }))

    expect(dashboard.get('projects')).toBe(A)
    expect(time.get('projects')).toBe(A)
    expect(agents.get('projects')).toBe(A)
    expect(dashboard.get('people')).toBe(U)
    expect(agents.get('people')).toBe(U)
  })

  it('drop ids that are not record ids, and repeats', () => {
    expect(
      routes.dashboard.read(
        new URLSearchParams(`projects=${A},nope,${A},${B}&people=1`),
      ),
    ).toMatchObject({ projectIds: [A, B], userIds: [] })
  })

  it('keep the legacy singular names readable on /agents', () => {
    expect(
      routes.agents.read(new URLSearchParams(`project=${A}&person=${U}`)),
    ).toMatchObject({ projectId: A, userId: U })
  })
})

describe('links across pages', () => {
  it('a dashboard address opens /time on its period and first project, without people', () => {
    const dashboard = routes.dashboard.read(
      routes.dashboard.write({
        from: '2026-11-01',
        to: '2026-11-30',
        projectIds: [A, B],
        userIds: [U],
      }),
    )
    const link = routes.dashboard.build(dashboard).replace(/^\//, '/time')

    expect(routes.time.read(searchOf(link))).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      projectId: A,
    })
  })

  it('a dashboard address opens /agents on its period, first project and person', () => {
    const link = routes.dashboard
      .build({
        from: '2026-11-01',
        to: '2026-11-30',
        projectIds: [A],
        userIds: [U],
      })
      .replace(/^\//, '/agents')

    expect(routes.agents.read(searchOf(link))).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      projectId: A,
      userId: U,
    })
  })

  it('a /time address opens the dashboard on its period and project', () => {
    const link = routes.time
      .build({ from: '2026-11-03', to: '2026-11-03', projectId: A, note: 'x' })
      .replace(/^\/time/, '/')

    expect(routes.dashboard.read(searchOf(link))).toEqual({
      from: '2026-11-03',
      to: '2026-11-03',
      projectIds: [A],
      userIds: [],
    })
  })

  it("a run's link from /time or the dashboard opens that run on /agents", () => {
    const link = routes.agents.build({
      from: '2026-11-03',
      to: '2026-11-03',
      projectId: A,
      run: 'run-1',
    })

    expect(link).toBe(
      `/agents?from=2026-11-03&to=2026-11-03&projects=${A}&run=run-1`,
    )
    expect(routes.agents.read(searchOf(link))).toEqual({
      from: '2026-11-03',
      to: '2026-11-03',
      projectId: A,
      run: 'run-1',
    })
  })

  it("a server's link on /team opens its agent's runs", () => {
    const link = routes.agents.build({ mode: 'fixed', agentId: 'agent-1' })

    expect(routes.agents.read(searchOf(link))).toEqual({
      mode: 'fixed',
      agentId: 'agent-1',
    })
  })
})
