import { readDay, readId, writeShared } from './address'

import { DATE_RANGE_PRESETS, type DateRangePreset } from '@/shared/lib'

export type AgentRunMode = 'timer' | 'fixed'

/** A named period the page's date picker offers; a custom one is just its days. */
export type AgentsPeriod = Exclude<DateRangePreset, 'custom'>

/**
 * What the /agents address says.
 *
 * The run search takes one project and one person, so a link naming several
 * opens narrowed to the first of each. The names are the shared plural ones;
 * the singular `project` and `person` of older links are still read.
 */
export type AgentsAddress = {
  /** Calendar days, `yyyy-MM-dd`, both ends included. */
  from?: string
  to?: string
  projectId?: string
  userId?: string
  agentId?: string
  mode?: AgentRunMode
  status?: string
  sessionId?: string
  /** The preset the days came from, so the picker shows it. */
  period?: AgentsPeriod
  /** The run to open. */
  run?: string
}

const OWN_PARAMS = {
  agentId: 'agent',
  mode: 'mode',
  status: 'status',
  sessionId: 'session',
  period: 'period',
  run: 'run',
} as const satisfies Partial<Record<keyof AgentsAddress, string>>

const isPeriod = (value: string | null): value is AgentsPeriod =>
  value !== 'custom' &&
  (DATE_RANGE_PRESETS as readonly (string | null)[]).includes(value)

const text = (value: string | null) => value?.trim() || undefined

export const readAgentsAddress = (search: URLSearchParams): AgentsAddress => {
  const mode = search.get(OWN_PARAMS.mode)
  const period = search.get(OWN_PARAMS.period)
  const address: AgentsAddress = {
    from: readDay(search, 'from'),
    to: readDay(search, 'to'),
    projectId: readId(search, 'projects'),
    userId: readId(search, 'people'),
    agentId: text(search.get(OWN_PARAMS.agentId)),
    mode: mode === 'timer' || mode === 'fixed' ? mode : undefined,
    status: text(search.get(OWN_PARAMS.status)),
    sessionId: text(search.get(OWN_PARAMS.sessionId)),
    period: isPeriod(period) ? period : undefined,
    run: text(search.get(OWN_PARAMS.run)),
  }

  return Object.fromEntries(
    Object.entries(address).filter(([, value]) => value !== undefined),
  ) as AgentsAddress
}

export const writeAgentsAddress = (address: AgentsAddress = {}) => {
  const search = writeShared(new URLSearchParams(), {
    from: address.from,
    to: address.to,
    projectIds: address.projectId ? [address.projectId] : undefined,
    userIds: address.userId ? [address.userId] : undefined,
  })

  for (const [key, name] of Object.entries(OWN_PARAMS)) {
    const value = address[key as keyof typeof OWN_PARAMS]

    if (value) {
      search.set(name, value)
    }
  }

  return search
}
