import { subDays } from 'date-fns'

import type { AgentRunFilters } from './agent-runs'
import type {
  StatisticsAgentDailyRow,
  StatisticsAgentRunDay,
  StatisticsQuery,
} from '@/entities/statistics'

import {
  bucketKeyOf,
  bucketSizeFor,
  fromDay,
  MAX_RANGE_DAYS,
  toApiDateRange,
  toDay,
  type BucketSize,
} from '@/shared'

/** 0 is Sunday, as date-fns counts. */
type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Reader's days, both ends included. */
export type AgentChartsRange = { from: string; to: string }

/**
 * The days the charts draw: the page's, or the latest stretch of them when
 * they are more than the statistics API answers for.
 */
export const getAgentChartsRange = (
  filters: Pick<AgentRunFilters, 'from' | 'to'>,
): AgentChartsRange => {
  const earliest = toDay(subDays(fromDay(filters.to), MAX_RANGE_DAYS - 1))

  return {
    from: filters.from < earliest ? earliest : filters.from,
    to: filters.to,
  }
}

/**
 * What the charts ask for. They follow the days, the project, the person and
 * the agent; where a run ran, how it ended and its session narrow the list
 * of runs only - a chart of one status or one session says little.
 */
export const agentChartsQuery = (
  filters: AgentRunFilters,
  timeZone: string,
): StatisticsQuery => {
  const range = getAgentChartsRange(filters)

  return {
    ...toApiDateRange(range),
    timeZone,
    ...(filters.projectId ? { projectIds: [filters.projectId] } : {}),
    ...(filters.userId ? { userIds: [filters.userId] } : {}),
    ...(filters.agentId ? { agentIds: [filters.agentId] } : {}),
    // A day or two is drawn by the hour, and the rows have to arrive that way.
    ...(bucketSizeFor(range) === 'hour' ? { bucket: 'hour' as const } : {}),
  }
}

/** The filters the charts read, as one string: the same string, the same charts. */
export const agentChartsKey = (filters: AgentRunFilters): string =>
  [
    filters.from,
    filters.to,
    filters.projectId,
    filters.userId,
    filters.agentId,
  ].join('|')

/**
 * Each agent's working hours per bar, and over the whole period. Working is
 * assisted plus autonomous: waiting on a person is not the agent's work.
 */
export const getAgentHours = (
  daily: StatisticsAgentDailyRow[],
  size: BucketSize,
  weekStartsOn: WeekStart,
): {
  bars: Map<string, Record<string, number>>
  totals: Map<string, number>
} => {
  const bars = new Map<string, Record<string, number>>()
  const totals = new Map<string, number>()

  for (const row of daily) {
    const hours = (row.assistedSeconds + row.autonomousSeconds) / 3600

    if (hours <= 0) {
      continue
    }

    const key = bucketKeyOf(row.day, size, weekStartsOn)
    const bar = bars.get(key) ?? {}

    bar[row.agentId] = (bar[row.agentId] ?? 0) + hours
    bars.set(key, bar)
    totals.set(row.agentId, (totals.get(row.agentId) ?? 0) + hours)
  }

  return { bars, totals }
}

export type AgentStateHours = {
  assisted: number
  autonomous: number
  waiting: number
}

/** Hours beside a person, alone, and waiting on a person, per bar. */
export const getAgentStates = (
  daily: StatisticsAgentDailyRow[],
  size: BucketSize,
  weekStartsOn: WeekStart,
): Map<string, AgentStateHours> => {
  const bars = new Map<string, AgentStateHours>()

  for (const row of daily) {
    const key = bucketKeyOf(row.day, size, weekStartsOn)
    const bar = bars.get(key) ?? { assisted: 0, autonomous: 0, waiting: 0 }

    bar.assisted += row.assistedSeconds / 3600
    bar.autonomous += row.autonomousSeconds / 3600
    bar.waiting += row.waitSeconds / 3600
    bars.set(key, bar)
  }

  return bars
}

/** How a run ended, in the order the chart stacks them; anything else is open. */
export const AGENT_RUN_ENDINGS = [
  'completed',
  'failed',
  'cancelled',
  'running',
] as const

export type AgentRunEnding = (typeof AGENT_RUN_ENDINGS)[number]

const isEnding = (status: string): status is AgentRunEnding =>
  (AGENT_RUN_ENDINGS as readonly string[]).includes(status)

/**
 * Runs per bar by how they ended, counted on the day they started. A status
 * the chart has no name for is a run still open, as the list reads it.
 */
export const getAgentRunEndings = (
  runs: StatisticsAgentRunDay[],
  size: BucketSize,
  weekStartsOn: WeekStart,
): Map<string, Record<AgentRunEnding, number>> => {
  const bars = new Map<string, Record<AgentRunEnding, number>>()

  for (const row of runs) {
    // Runs arrive by day even when the period is drawn by the hour.
    const key =
      size === 'hour' ? row.day : bucketKeyOf(row.day, size, weekStartsOn)
    const bar = bars.get(key) ?? {
      completed: 0,
      failed: 0,
      cancelled: 0,
      running: 0,
    }

    bar[isEnding(row.status) ? row.status : 'running'] += row.count
    bars.set(key, bar)
  }

  return bars
}
