import { subDays } from 'date-fns'

import type { TimeWeek } from './time-week'
import type {
  StatisticsAgentDailyRow,
  StatisticsDailyRow,
  StatisticsTotalsRow,
} from '@/entities/statistics'
import type { TimeFilters } from '@/entities/time'

import { bucketKeyOf, MAX_RANGE_DAYS, toDay, type BucketSize } from '@/shared'

/** 0 is Sunday, as date-fns counts. */
type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Reader's days, both ends included. */
export type TimeChartsRange = { from: string; to: string }

/** How the daily chart splits a bar. */
export type TimeChartsMode = 'projects' | 'people'

/**
 * The period the charts draw: the date filter when it names both ends, else
 * the week the strip above shows. A filter longer than the statistics API
 * answers for keeps its latest stretch.
 */
export const getTimeChartsRange = (
  filters: Pick<TimeFilters, 'fromAt' | 'toAt'>,
  week: TimeWeek,
): TimeChartsRange => {
  if (filters.fromAt == null || filters.toAt == null) {
    return { from: week.from, to: week.to }
  }

  const first = new Date(Math.min(filters.fromAt, filters.toAt))
  const last = new Date(Math.max(filters.fromAt, filters.toAt))
  const earliest = subDays(last, MAX_RANGE_DAYS - 1)

  return {
    from: toDay(first < earliest ? earliest : first),
    to: toDay(last),
  }
}

export type TimeProjectShare = {
  projectId: string
  seconds: number
  /** 0-1 of the period's tracked time. */
  share: number
}

/** Each project's part of the period, most time first; idle projects left out. */
export const getTimeProjectShares = (
  totals: Pick<StatisticsTotalsRow, 'projectId' | 'trackedSeconds'>[],
): TimeProjectShare[] => {
  const worked = totals.filter((row) => row.trackedSeconds > 0)
  const all = worked.reduce((sum, row) => sum + row.trackedSeconds, 0)

  return worked
    .map((row) => ({
      projectId: row.projectId,
      seconds: row.trackedSeconds,
      share: row.trackedSeconds / all,
    }))
    .sort(
      (a, b) => b.seconds - a.seconds || a.projectId.localeCompare(b.projectId),
    )
}

export type TimeBilling = {
  trackedSeconds: number
  /** Covered by an invoice, paid or not. */
  invoicedSeconds: number
  paidSeconds: number
  /** The three parts tracked time falls into; they add up to it. */
  parts: {
    paid: number
    /** Invoiced and waiting to be paid. */
    awaiting: number
    /** Neither invoiced nor marked paid. */
    open: number
  }
}

/**
 * How much of the period's time has been invoiced and paid, over the
 * projects whose money the reader may see. `null` when that is none of them,
 * as for a viewer: the API leaves those figures out rather than sending zeros.
 */
export const getTimeBilling = (
  totals: StatisticsTotalsRow[],
): TimeBilling | null => {
  const seen = totals.filter(
    (row) => row.paidSeconds != null && row.invoicedSeconds != null,
  )

  if (seen.length === 0) {
    return null
  }

  const sum = (pick: (row: StatisticsTotalsRow) => number | undefined) =>
    seen.reduce((total, row) => total + (pick(row) ?? 0), 0)
  const trackedSeconds = sum((row) => row.trackedSeconds)
  const paid = Math.min(
    trackedSeconds,
    sum((row) => row.paidSeconds),
  )
  const awaiting = Math.min(
    trackedSeconds - paid,
    sum((row) => row.invoicedUnpaidSeconds),
  )

  return {
    trackedSeconds,
    invoicedSeconds: sum((row) => row.invoicedSeconds),
    paidSeconds: paid,
    parts: { paid, awaiting, open: trackedSeconds - paid - awaiting },
  }
}

export type TimePeopleAgents = { people: number; agents: number }

/**
 * People's tracked hours and agents' working hours per bar. They are kept
 * apart, never added: an agent often runs while its person is tracking, so
 * a sum would count that hour twice. Waiting on a person is not agent work.
 */
export const getTimePeopleAgents = (
  daily: StatisticsDailyRow[],
  agents: StatisticsAgentDailyRow[],
  size: BucketSize,
  weekStartsOn: WeekStart,
): Map<string, TimePeopleAgents> => {
  const bars = new Map<string, TimePeopleAgents>()
  const add = (day: string, key: keyof TimePeopleAgents, hours: number) => {
    const barKey = bucketKeyOf(day, size, weekStartsOn)
    const bar = bars.get(barKey) ?? { people: 0, agents: 0 }

    bar[key] += hours
    bars.set(barKey, bar)
  }

  for (const row of daily) {
    add(row.day, 'people', row.trackedSeconds / 3600)
  }

  for (const row of agents) {
    add(row.day, 'agents', (row.assistedSeconds + row.autonomousSeconds) / 3600)
  }

  return bars
}
