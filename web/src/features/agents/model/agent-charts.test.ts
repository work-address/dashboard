import { describe, expect, it } from 'vitest'

import {
  agentChartsKey,
  agentChartsQuery,
  getAgentChartsRange,
  getAgentHours,
  getAgentRunEndings,
  getAgentStates,
} from './agent-charts'

const row = (
  day: string,
  agentId: string,
  assistedSeconds: number,
  autonomousSeconds: number,
  waitSeconds = 0,
) => ({
  day,
  userId: 'worker',
  agentId,
  product: 'codex',
  assistedSeconds,
  autonomousSeconds,
  waitSeconds,
})

describe('agent charts query', () => {
  const filters = { from: '2026-11-10', to: '2026-11-16' }

  it('follows the days, project, person and agent', () => {
    expect(
      agentChartsQuery(
        { ...filters, projectId: 'p', userId: 'u', agentId: 'a' },
        'Europe/Madrid',
      ),
    ).toEqual({
      from: '2026-11-10',
      to: '2026-11-17',
      timeZone: 'Europe/Madrid',
      projectIds: ['p'],
      userIds: ['u'],
      agentIds: ['a'],
    })
  })

  it('leaves mode, status and session to the list of runs', () => {
    const narrowed = {
      ...filters,
      mode: 'fixed' as const,
      status: 'failed',
      sessionId: 's',
    }

    expect(agentChartsQuery(narrowed, 'UTC')).toEqual(
      agentChartsQuery(filters, 'UTC'),
    )
    expect(agentChartsKey(narrowed)).toBe(agentChartsKey(filters))
  })

  it('asks by the hour for a day or two', () => {
    expect(
      agentChartsQuery({ from: '2026-11-16', to: '2026-11-16' }, 'UTC').bucket,
    ).toBe('hour')
  })

  it('keeps the latest year of a longer stretch', () => {
    expect(
      getAgentChartsRange({ from: '2024-01-01', to: '2026-11-16' }),
    ).toEqual({ from: '2025-11-16', to: '2026-11-16' })
  })
})

describe('agent hours', () => {
  it('sums working hours per agent and leaves waiting out', () => {
    const { bars, totals } = getAgentHours(
      [
        row('2026-11-10', 'one', 1800, 1800, 3600),
        row('2026-11-10', 'two', 0, 7200),
        row('2026-11-11', 'one', 3600, 0),
        row('2026-11-11', 'idle', 0, 0, 600),
      ],
      'day',
      1,
    )

    expect(bars.get('2026-11-10')).toEqual({ one: 1, two: 2 })
    expect(bars.get('2026-11-11')).toEqual({ one: 1 })
    expect([...totals]).toEqual([
      ['one', 2],
      ['two', 2],
    ])
  })

  it('gathers days into the week they fall in', () => {
    const { bars } = getAgentHours(
      [row('2026-11-10', 'one', 3600, 0), row('2026-11-12', 'one', 3600, 0)],
      'week',
      1,
    )

    expect(bars.get('2026-11-09')).toEqual({ one: 2 })
  })
})

describe('agent states', () => {
  it('keeps assisted, autonomous and waiting apart', () => {
    expect(
      getAgentStates(
        [
          row('2026-11-10', 'one', 1800, 3600, 900),
          row('2026-11-10', 'two', 1800, 0, 900),
        ],
        'day',
        1,
      ).get('2026-11-10'),
    ).toEqual({ assisted: 1, autonomous: 1, waiting: 0.5 })
  })
})

describe('run endings', () => {
  it('counts runs on the day they started, by how they ended', () => {
    const bars = getAgentRunEndings(
      [
        { day: '2026-11-10', status: 'completed', count: 4 },
        { day: '2026-11-10', status: 'failed', count: 1 },
        { day: '2026-11-11', status: 'cancelled', count: 2 },
      ],
      'day',
      1,
    )

    expect(bars.get('2026-11-10')).toEqual({
      completed: 4,
      failed: 1,
      cancelled: 0,
      running: 0,
    })
    expect(bars.get('2026-11-11')?.cancelled).toBe(2)
  })

  it('reads a status it has no name for as a run still open', () => {
    expect(
      getAgentRunEndings(
        [
          { day: '2026-11-10', status: 'running', count: 1 },
          { day: '2026-11-10', status: 'unknown', count: 2 },
        ],
        'day',
        1,
      ).get('2026-11-10')?.running,
    ).toBe(3)
  })
})
