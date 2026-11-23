import type {
  StatisticsAgentDailyRow,
  StatisticsDailyRow,
} from '@/entities/statistics'

import { periodBars, type BarPeriod, type Grain } from '@/shared'

export type AgentSplit = {
  assisted: number
  autonomous: number
  waiting: number
}

/** Everything known about one bar of a chart, in minutes. */
export type BucketBreakdown = {
  peopleMinutes: number
  /** Tracked minutes per project, most first. */
  projects: { projectId: string; minutes: number }[]
  agents: AgentSplit
  /** Agent minutes per product, most first; waiting kept apart. */
  products: ({ product: string } & AgentSplit)[]
}

const EMPTY: BucketBreakdown = {
  peopleMinutes: 0,
  projects: [],
  agents: { assisted: 0, autonomous: 0, waiting: 0 },
  products: [],
}

/** Joins a product to one of its three states in a series key. */
const SPLIT = '\u0000'

/**
 * Human time by project and agent time by product, per bar, so either chart
 * can say everything about the bar under the pointer - not only the series
 * it draws. The bars are the same ones the charts draw: the same period,
 * language and grain give the same keys.
 */
export function bucketBreakdowns(
  period: BarPeriod,
  language: string,
  /** The grain both kinds of row were asked in. */
  grain: Grain,
  daily: StatisticsDailyRow[],
  agents: StatisticsAgentDailyRow[],
): Map<string, BucketBreakdown> {
  const people = periodBars({
    period,
    language,
    sources: [
      {
        rows: daily,
        grain,
        values: (row) => ({ [row.projectId]: row.trackedSeconds / 60 }),
      },
    ],
    series: [],
  })
  const work = periodBars({
    period,
    language,
    sources: [
      {
        rows: agents,
        grain,
        values: (row) => ({
          [`${row.product}${SPLIT}assisted`]: row.assistedSeconds / 60,
          [`${row.product}${SPLIT}autonomous`]: row.autonomousSeconds / 60,
          [`${row.product}${SPLIT}waiting`]: row.waitSeconds / 60,
        }),
      },
    ],
    series: [],
  })
  const byProject = new Map(
    people.buckets.map((bucket) => [bucket.key, bucket.values]),
  )
  const byProduct = new Map(
    work.buckets.map((bucket) => [bucket.key, bucket.values]),
  )
  const out = new Map<string, BucketBreakdown>()

  for (const key of new Set([...byProject.keys(), ...byProduct.keys()])) {
    const projectValues = Object.entries(byProject.get(key) ?? {})
    const productValues = Object.entries(byProduct.get(key) ?? {})

    if (projectValues.length === 0 && productValues.length === 0) {
      continue
    }

    const splits = new Map<string, AgentSplit>()

    for (const [seriesKey, minutes] of productValues) {
      const [product, state] = seriesKey.split(SPLIT) as [
        string,
        keyof AgentSplit,
      ]
      const split = splits.get(product) ?? { ...EMPTY.agents }

      split[state] += minutes
      splits.set(product, split)
    }

    const projectRows = projectValues
      .map(([projectId, minutes]) => ({ projectId, minutes }))
      .sort((a, b) => b.minutes - a.minutes)
    const productRows = [...splits]
      .map(([product, split]) => ({ product, ...split }))
      .sort(
        (a, b) =>
          b.assisted + b.autonomous - (a.assisted + a.autonomous) ||
          a.product.localeCompare(b.product),
      )

    out.set(key, {
      peopleMinutes: projectRows.reduce((sum, p) => sum + p.minutes, 0),
      projects: projectRows,
      agents: productRows.reduce(
        (sum, p) => ({
          assisted: sum.assisted + p.assisted,
          autonomous: sum.autonomous + p.autonomous,
          waiting: sum.waiting + p.waiting,
        }),
        { ...EMPTY.agents },
      ),
      products: productRows,
    })
  }

  return out
}

export const emptyBreakdown = (): BucketBreakdown => ({
  ...EMPTY,
  agents: { ...EMPTY.agents },
})
