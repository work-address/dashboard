import { createEvent, sample } from 'effector'

import { agentChartsQuery } from './agent-charts'

import type { AgentRunFilters } from './agent-runs'

import { statisticsAgentRunsQuery } from '@/entities/statistics'

/** The page asks for its charts: on arrival and when a filter they follow moves. */
export const agentChartsRequested = createEvent<AgentRunFilters>()

sample({
  clock: agentChartsRequested,
  // Days are the reader's days, wherever the server is.
  fn: (filters) =>
    agentChartsQuery(filters, Intl.DateTimeFormat().resolvedOptions().timeZone),
  target: statisticsAgentRunsQuery.start,
})
