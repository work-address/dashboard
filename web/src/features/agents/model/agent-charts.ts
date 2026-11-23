import { subDays } from 'date-fns'

import type { AgentRunFilters } from './agent-runs'

import {
  agentWorkedSeconds,
  type StatisticsAgentDailyRow,
  type StatisticsAgentRunDay,
  type StatisticsQuery,
} from '@/entities/statistics'
import {
  askGrain,
  fromDay,
  MAX_RANGE_DAYS,
  toApiDateRange,
  toDay,
} from '@/shared'

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
    ...(askGrain(range) === 'hour' ? { bucket: 'hour' as const } : {}),
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
 * What a row adds to its agent's hours. An agent that only waited on a
 * person adds nothing, so it gets no series of its own.
 */
export const agentHoursOf = (
  row: StatisticsAgentDailyRow,
): Record<string, number> => {
  const seconds = agentWorkedSeconds(row)

  return seconds > 0 ? { [row.agentId]: seconds / 3600 } : {}
}

/** A row's hours beside a person, alone, and waiting on a person. */
export const agentStateHoursOf = (row: StatisticsAgentDailyRow) => ({
  assisted: row.assistedSeconds / 3600,
  autonomous: row.autonomousSeconds / 3600,
  waiting: row.waitSeconds / 3600,
})

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
 * What a day's count of runs adds, by how they ended. A status the chart has
 * no name for is a run still open, as the list reads it.
 */
export const agentRunEndingsOf = (
  row: StatisticsAgentRunDay,
): Record<string, number> => ({
  [isEnding(row.status) ? row.status : 'running']: row.count,
})
