/** What every statistics route takes; `to` is exclusive. */
export type StatisticsQuery = {
  /** Omitted: every project the caller can see. */
  projectIds?: string[]
  userIds?: string[]
  from: string
  to: string
  timeZone: string
  /** How `time/daily` and `agents/daily` cut the period. */
  bucket?: 'day' | 'hour'
  /** Only these agents' runs; `agents/daily` alone reads it. */
  agentIds?: string[]
}

/**
 * History the period reaches for but the plan of a project's owner hides:
 * everything before `before`. Only the owner can lift it by upgrading.
 */
export type StatisticsHidden = {
  /** An ISO instant. */
  before: string
  canUpgrade: boolean
}

/**
 * One project's time in the period, as much of it as the reader may see. All
 * but `projectId` and `trackedSeconds` are missing for a project the caller only
 * views - the API leaves them out rather than sending zeros. Money is priced by
 * the API; `paidCents` holds an estimate for time marked paid by hand.
 */
export type StatisticsTotalsRow = {
  projectId: string
  trackedSeconds: number
  activeSeconds?: number
  idleSeconds?: number
  manualSeconds?: number
  paidSeconds?: number
  unpaidSeconds?: number
  /** Time covered by an invoice that has not been rejected, paid or not. */
  invoicedSeconds?: number
  /** The part of it still waiting to be paid. */
  invoicedUnpaidSeconds?: number
  earnedCents?: number
  paidCents?: number
  unpaidCents?: number
}

/** Seconds spent in one app on one project. */
export type StatisticsProjectAppRow = {
  projectId: string
  app: string
  seconds: number
}

/** Tracked seconds on one project on one of the reader's days. */
export type StatisticsDailyRow = {
  day: string
  projectId: string
  trackedSeconds: number
}

/** The reader's time in one weekday-and-hour cell, over the whole stretch. */
export type StatisticsHourlyRow = {
  /** ISO weekday: 1 is Monday. */
  weekday: number
  hour: number
  activeSeconds: number
  /** All time started in the hour, manual included. */
  trackedSeconds: number
  keyboardKeys: number
  mouseKeys: number
  /** How many different days had time at this weekday and hour. */
  days: number
  /** The hour's busiest projects and apps, most time first. */
  projects: { projectId: string; seconds: number }[]
  apps: { name: string; seconds: number }[]
}

/** Figures about the reader alone, whoever the people filter selects. */
export type StatisticsInsights = {
  focus: { count: number; minutes: number; longestMinutes: number }
  /** Hours of the day, best first. */
  productiveHours: number[]
  /** Active share of measured time, 0-1; null with nothing measured. */
  activeRatio: number | null
  keysPerActiveHour: number | null
  clicksPerActiveHour: number | null
}

/** A period's totals, with what the plan hides of it. */
export type StatisticsOverview = {
  totals: StatisticsTotalsRow[]
  hidden: StatisticsHidden | null
}

/** One agent's time on one of the reader's days. */
export type StatisticsAgentDailyRow = {
  day: string
  /** Whose agent it is. */
  userId: string
  agentId: string
  product: string
  assistedSeconds: number
  autonomousSeconds: number
  waitSeconds: number
}

export type StatisticsAgentRunCount = {
  product: string
  status: string
  count: number
}

/**
 * An agent's work in a row: beside a person and alone. Waiting on a person is
 * shown apart and never counts as the agent's work.
 */
export const agentWorkedSeconds = (
  row: Pick<StatisticsAgentDailyRow, 'assistedSeconds' | 'autonomousSeconds'>,
): number => row.assistedSeconds + row.autonomousSeconds

/** Runs that started on one of the reader's days, by how they ended. */
export type StatisticsAgentRunDay = {
  day: string
  status: string
  count: number
}

/**
 * An agent in the rows, as its worker named it. The name is empty only when
 * the worker's list no longer holds the agent; one that was detached or
 * removed keeps its name.
 */
export type StatisticsAgentName = { id: string; name: string; userId: string }

/** Someone who runs an agent in the rows. */
export type StatisticsPersonName = { id: string; name: string }

export type StatisticsAgents = {
  daily: StatisticsAgentDailyRow[]
  runs: StatisticsAgentRunCount[]
  runsDaily: StatisticsAgentRunDay[]
  /** A name for every agent in `daily`, and for the people who run them. */
  agents: StatisticsAgentName[]
  people: StatisticsPersonName[]
  hidden: StatisticsHidden | null
}

/** One person's time on the reader's own projects. */
export type StatisticsTeamRow = {
  userId: string
  name: string
  trackedSeconds: number
  activeSeconds: number
  unpaidSeconds: number
  agentSeconds: number
}
