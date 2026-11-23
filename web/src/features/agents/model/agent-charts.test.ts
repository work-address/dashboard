import { describe, expect, it } from 'vitest'

import {
  agentChartsKey,
  agentChartsQuery,
  agentHoursOf,
  agentRunEndingsOf,
  agentStateHoursOf,
  getAgentChartsRange,
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

describe('what a row adds', () => {
  it('counts an agent’s work and leaves waiting out', () => {
    expect(agentHoursOf(row('2026-11-10', 'one', 1800, 1800, 3600))).toEqual({
      one: 1,
    })
  })

  it('gives an agent that only waited no series', () => {
    expect(agentHoursOf(row('2026-11-11', 'idle', 0, 0, 600))).toEqual({})
  })

  it('keeps assisted, autonomous and waiting apart', () => {
    expect(
      agentStateHoursOf(row('2026-11-10', 'one', 1800, 3600, 900)),
    ).toEqual({ assisted: 0.5, autonomous: 1, waiting: 0.25 })
  })
})

describe('run endings', () => {
  it('counts a day’s runs under how they ended', () => {
    expect(
      agentRunEndingsOf({ day: '2026-11-10', status: 'failed', count: 2 }),
    ).toEqual({ failed: 2 })
  })

  it('reads a status it has no name for as a run still open', () => {
    expect(
      agentRunEndingsOf({ day: '2026-11-10', status: 'unknown', count: 3 }),
    ).toEqual({ running: 3 })
  })
})
