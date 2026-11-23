import { subDays } from 'date-fns'

import type { TimeWeek } from './time-week'
import type { StatisticsTotalsRow } from '@/entities/statistics'
import type { TimeFilters } from '@/entities/time'

import { MAX_RANGE_DAYS, toDay } from '@/shared'

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
