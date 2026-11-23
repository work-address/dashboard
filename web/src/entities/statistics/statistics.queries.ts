import { concurrency, createQuery } from '@farfetched/core'

import type {
  StatisticsAgents,
  StatisticsDailyRow,
  StatisticsHidden,
  StatisticsHourlyRow,
  StatisticsInsights,
  StatisticsOverview,
  StatisticsProjectAppRow,
  StatisticsQuery,
  StatisticsTeamRow,
  StatisticsTotalsRow,
} from './types'

import { baseApi, runApiData } from '@/shared'

// Raw SQL sums arrive as strings.
const toNumber = (value: unknown) =>
  value == null ? undefined : Number(value) || 0

// Each widget shows its own failure and retry.
const run = async <T>(request: () => Promise<unknown>): Promise<T> =>
  (await runApiData(request as never, 'in-place')) as T

type HiddenFields = { hiddenBefore?: string; canUpgrade?: boolean }

// The API leaves both fields out when nothing in the period is hidden.
const toHidden = ({
  hiddenBefore,
  canUpgrade,
}: HiddenFields): StatisticsHidden | null =>
  hiddenBefore
    ? { before: hiddenBefore, canUpgrade: canUpgrade === true }
    : null

const fullOverviewHandler = async (
  query: StatisticsQuery,
): Promise<StatisticsOverview> => {
  const { totals, ...rest } = await run<
    { totals: Record<string, unknown>[] } & HiddenFields
  >(() => baseApi.statisticsControllerOverview({ body: query }))

  return {
    totals: totals.map((row) => ({
      projectId: String(row.projectId),
      trackedSeconds: toNumber(row.trackedSeconds) ?? 0,
      activeSeconds: toNumber(row.activeSeconds),
      idleSeconds: toNumber(row.idleSeconds),
      manualSeconds: toNumber(row.manualSeconds),
      paidSeconds: toNumber(row.paidSeconds),
      unpaidSeconds: toNumber(row.unpaidSeconds),
      invoicedSeconds: toNumber(row.invoicedSeconds),
      invoicedUnpaidSeconds: toNumber(row.invoicedUnpaidSeconds),
      earnedCents: toNumber(row.earnedCents),
      paidCents: toNumber(row.paidCents),
      unpaidCents: toNumber(row.unpaidCents),
    })),
    hidden: toHidden(rest),
  }
}

const overviewHandler = async (
  query: StatisticsQuery,
): Promise<StatisticsTotalsRow[]> => (await fullOverviewHandler(query)).totals

export const statisticsOverviewQuery = createQuery({ handler: overviewHandler })

concurrency(statisticsOverviewQuery, { strategy: 'TAKE_LATEST' })

/** The same totals for the period before, which the KPI deltas compare with. */
export const statisticsPreviousOverviewQuery = createQuery({
  handler: overviewHandler,
})

concurrency(statisticsPreviousOverviewQuery, { strategy: 'TAKE_LATEST' })

export const statisticsProjectAppsQuery = createQuery({
  handler: async (
    query: StatisticsQuery,
  ): Promise<StatisticsProjectAppRow[]> => {
    const { rows } = await run<{ rows: Record<string, unknown>[] }>(() =>
      baseApi.statisticsControllerApps({
        path: { kind: 'projects' },
        body: query,
      }),
    )

    return rows.map((row) => ({
      projectId: String(row.projectId),
      app: String(row.app ?? ''),
      seconds: toNumber(row.seconds) ?? 0,
    }))
  },
})

concurrency(statisticsProjectAppsQuery, { strategy: 'TAKE_LATEST' })

const dailyHandler = async (
  query: StatisticsQuery,
): Promise<StatisticsDailyRow[]> => {
  const { rows } = await run<{ rows: StatisticsDailyRow[] }>(() =>
    baseApi.statisticsControllerTimeDaily({ body: query }),
  )

  return rows
}

export const statisticsDailyQuery = createQuery({ handler: dailyHandler })

concurrency(statisticsDailyQuery, { strategy: 'TAKE_LATEST' })

/**
 * The Time page's week: the same totals and days as the dashboard's, kept in
 * their own queries so neither page's period overwrites the other's.
 */
export const statisticsWeekOverviewQuery = createQuery({
  handler: overviewHandler,
})

concurrency(statisticsWeekOverviewQuery, { strategy: 'TAKE_LATEST' })

export const statisticsWeekDailyQuery = createQuery({ handler: dailyHandler })

concurrency(statisticsWeekDailyQuery, { strategy: 'TAKE_LATEST' })

export const statisticsHourlyQuery = createQuery({
  handler: async (query: StatisticsQuery): Promise<StatisticsHourlyRow[]> => {
    const { rows } = await run<{ rows: StatisticsHourlyRow[] }>(() =>
      baseApi.statisticsControllerTimeHourly({ body: query }),
    )

    return rows
  },
})

concurrency(statisticsHourlyQuery, { strategy: 'TAKE_LATEST' })

export const statisticsInsightsQuery = createQuery({
  handler: async (query: StatisticsQuery): Promise<StatisticsInsights> =>
    run<StatisticsInsights>(() =>
      baseApi.statisticsControllerInsightsMe({ body: query }),
    ),
})

concurrency(statisticsInsightsQuery, { strategy: 'TAKE_LATEST' })

const agentsHandler = async (
  query: StatisticsQuery,
): Promise<StatisticsAgents> => {
  const { daily, runs, runsDaily, agents, people, ...rest } = await run<
    Pick<StatisticsAgents, 'daily' | 'runs'> &
      Partial<Pick<StatisticsAgents, 'runsDaily' | 'agents' | 'people'>> &
      HiddenFields
  >(() => baseApi.statisticsControllerAgentsDaily({ body: query }))

  return {
    daily,
    runs,
    runsDaily: runsDaily ?? [],
    agents: agents ?? [],
    people: people ?? [],
    hidden: toHidden(rest),
  }
}

export const statisticsAgentsQuery = createQuery({ handler: agentsHandler })

concurrency(statisticsAgentsQuery, { strategy: 'TAKE_LATEST' })

/**
 * The period a page's own charts draw - the Time page's date filter, the
 * Agents page's - kept apart from the dashboard's and the week strip's for
 * the same reason the week's are.
 */
export const statisticsPeriodOverviewQuery = createQuery({
  handler: fullOverviewHandler,
})

concurrency(statisticsPeriodOverviewQuery, { strategy: 'TAKE_LATEST' })

export const statisticsPeriodDailyQuery = createQuery({ handler: dailyHandler })

concurrency(statisticsPeriodDailyQuery, { strategy: 'TAKE_LATEST' })

export const statisticsPeriodAgentsQuery = createQuery({
  handler: agentsHandler,
})

concurrency(statisticsPeriodAgentsQuery, { strategy: 'TAKE_LATEST' })

/** The Agents page's charts, which follow that page's own filters. */
export const statisticsAgentRunsQuery = createQuery({ handler: agentsHandler })

concurrency(statisticsAgentRunsQuery, { strategy: 'TAKE_LATEST' })

export const statisticsTeamQuery = createQuery({
  handler: async (query: StatisticsQuery): Promise<StatisticsTeamRow[]> => {
    const { rows } = await run<{ rows: StatisticsTeamRow[] }>(() =>
      baseApi.statisticsControllerTeam({ body: query }),
    )

    return rows
  },
})

concurrency(statisticsTeamQuery, { strategy: 'TAKE_LATEST' })
