import { addDays, subDays } from 'date-fns'

import type { TimeAgentRun } from '@/entities/time'

import { routes, type AgentRunMode, type AgentsAddress } from '@/routes'
import { fromDay, toDay } from '@/shared'

/** A run as the Agents page reads it: everything the search returns. */
export type AgentRun = TimeAgentRun & {
  agentId: string
  /** The worker's name for the agent; null when it has been removed. */
  agentName?: string | null
  /** The agent's rate on the project now, in cents an hour. */
  agentRateHourCents?: number | null
  sourceInstanceId?: string
  sourceSessionId?: string
  sourceRunId?: string
  sourceAgentId?: string
  measurement?: {
    /** `fixed` for a server's runs, `timer` for a computer's. */
    mode?: 'timer' | 'fixed'
    liveness?: boolean
    provisional?: boolean
    adapterVersion?: string
    runtimeVersion?: string
    schemaVersion?: number
  }
  manual?: boolean
}

/** What the page shows, as its address says it: every field is optional there. */
export type AgentRunFilters = {
  /** Calendar days in the reader's timezone, both ends included. */
  from: string
  to: string
  projectId?: string
  userId?: string
  agentId?: string
  mode?: AgentRunMode
  status?: string
  sessionId?: string
}

/** The search's page size, which the API fixes. */
export const AGENT_RUNS_PAGE = 100

/** The last seven days, today included. */
export const defaultAgentRunDays = (now = new Date()) => ({
  from: toDay(subDays(now, 6)),
  to: toDay(now),
})

/** The page's filters from its address; missing or malformed days fall back to the last week. */
export const fromAgentsAddress = (
  address: AgentsAddress,
  now = new Date(),
): AgentRunFilters => {
  const { from, to } = address
  const days =
    from && to && from <= to ? { from, to } : defaultAgentRunDays(now)

  return {
    ...days,
    projectId: address.projectId,
    userId: address.userId,
    agentId: address.agentId,
    mode: address.mode,
    status: address.status,
    sessionId: address.sessionId,
  }
}

export const readAgentRunFilters = (
  params: URLSearchParams,
  now = new Date(),
) => fromAgentsAddress(routes.agents.read(params), now)

/** The search's body for the filters: the days as instants, from local midnights. */
export const agentRunsBody = (filters: AgentRunFilters) => ({
  fromAt: fromDay(filters.from).toISOString(),
  toAt: addDays(fromDay(filters.to), 1).toISOString(),
  projectId: filters.projectId,
  userId: filters.userId,
  agentId: filters.agentId,
  mode: filters.mode,
  status: filters.status,
  sessionId: filters.sessionId,
})

/** Where a run ran, as its badge says it; an older run without a mode is a computer's. */
export const agentRunMode = (run: AgentRun): AgentRunMode =>
  run.measurement?.mode === 'fixed' ? 'fixed' : 'timer'

export { type AgentRunMode } from '@/routes'
