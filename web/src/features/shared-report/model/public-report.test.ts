import { describe, expect, it } from 'vitest'

import { getPublicReportTotals } from './public-report'

import type { PublicReport } from '@/entities/shared-report'

const report: PublicReport = {
  title: null,
  sharedBy: 'Ada',
  from: '2026-11-16',
  to: '2026-11-23',
  timeZone: 'UTC',
  createdAt: '2026-11-23T10:00:00.000Z',
  projects: [
    { id: 'a', title: 'Acme' },
    { id: 'b', title: 'Bolt' },
    { id: 'idle', title: 'Idle' },
  ],
  people: [
    { id: 'ada', name: 'Ada' },
    { id: 'bo', name: 'Bo' },
  ],
  agents: [{ id: 'one', name: 'Builder', userId: 'ada' }],
  daily: [
    { day: '2026-11-16', projectId: 'a', userId: 'ada', trackedSeconds: 3600 },
    { day: '2026-11-17', projectId: 'a', userId: 'bo', trackedSeconds: 1800 },
    { day: '2026-11-17', projectId: 'b', userId: 'ada', trackedSeconds: 7200 },
  ],
  agentsDaily: [
    {
      day: '2026-11-16',
      projectId: 'a',
      userId: 'ada',
      agentId: 'one',
      workedSeconds: 5400,
    },
  ],
}

const labels = {
  agent: 'Agent',
  person: (number: number | null) =>
    number === null ? 'Contributor' : `Contributor ${number}`,
}

describe('public report totals', () => {
  const totals = getPublicReportTotals(report, labels)

  it('keeps people and agents apart', () => {
    expect(totals.peopleSeconds).toBe(12_600)
    expect(totals.agentSeconds).toBe(5400)
  })

  it('ranks projects and people by time and leaves idle ones out', () => {
    expect(totals.projects.map((row) => [row.name, row.seconds])).toEqual([
      ['Bolt', 7200],
      ['Acme', 5400],
    ])
    expect(totals.people.map((row) => row.name)).toEqual(['Ada', 'Bo'])
  })

  it('names whose agent each one is', () => {
    expect(totals.agents).toEqual([
      { id: 'one', name: 'Builder', seconds: 5400, owner: 'Ada' },
    ])
  })

  it('has no split by person when the sharer may not see one', () => {
    const viewed = getPublicReportTotals(
      {
        ...report,
        people: [],
        agents: [],
        agentsDaily: [],
        daily: report.daily.map(({ userId: _userId, ...row }) => row),
      },
      labels,
    )

    expect(viewed.people).toEqual([])
    expect(viewed.peopleSeconds).toBe(12_600)
  })
})

describe('people with no name', () => {
  const nameless = (ids: string[]): PublicReport => ({
    ...report,
    people: [
      ...ids.map((id) => ({ id, name: '' })),
      { id: 'ada', name: 'Ada' },
    ],
    agents: [{ id: 'one', name: 'Builder', userId: ids[0] }],
    daily: [
      ...ids.map((id) => ({
        day: '2026-11-16',
        projectId: 'a',
        userId: id,
        trackedSeconds: 600,
      })),
      { day: '2026-11-16', projectId: 'a', userId: 'ada', trackedSeconds: 60 },
    ],
    agentsDaily: [
      {
        day: '2026-11-16',
        projectId: 'a',
        userId: ids[0],
        agentId: 'one',
        workedSeconds: 60,
      },
    ],
  })

  it('reads one of them as a contributor, never as an address', () => {
    const totals = getPublicReportTotals(nameless(['x']), labels)

    expect(totals.people.map((row) => row.name)).toEqual(['Contributor', 'Ada'])
    expect(totals.agents[0].owner).toBe('Contributor')
  })

  it('counts several of them off, the same way each time', () => {
    const totals = getPublicReportTotals(nameless(['y', 'x']), labels)

    expect(
      Object.fromEntries(totals.people.map((row) => [row.id, row.name])),
    ).toEqual({ x: 'Contributor 1', y: 'Contributor 2', ada: 'Ada' })
  })
})
