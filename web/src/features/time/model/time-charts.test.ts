import { describe, expect, it } from 'vitest'

import { getTimeBilling, getTimeChartsRange } from './time-charts'

import { fromDay } from '@/shared'

const week = {
  from: '2026-11-16',
  to: '2026-11-22',
  days: [],
}

const at = (day: string) => fromDay(day).getTime()

describe('time charts range', () => {
  it('follows the date filter when it names both ends', () => {
    expect(
      getTimeChartsRange(
        { fromAt: at('2026-10-01'), toAt: at('2026-10-31') },
        week,
      ),
    ).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })

  it('shows the week of the strip when the filter is open at either end', () => {
    expect(getTimeChartsRange({ fromAt: null, toAt: null }, week)).toEqual({
      from: '2026-11-16',
      to: '2026-11-22',
    })
    expect(
      getTimeChartsRange({ fromAt: at('2026-11-18'), toAt: null }, week),
    ).toEqual({ from: '2026-11-16', to: '2026-11-22' })
  })

  it('keeps the latest year of a longer filter', () => {
    expect(
      getTimeChartsRange(
        { fromAt: at('2024-01-01'), toAt: at('2026-11-22') },
        week,
      ),
    ).toEqual({ from: '2025-11-22', to: '2026-11-22' })
  })
})

describe('billing', () => {
  it('splits tracked time into paid, awaiting payment and open', () => {
    expect(
      getTimeBilling([
        {
          projectId: 'a',
          trackedSeconds: 10_000,
          paidSeconds: 4000,
          invoicedSeconds: 7000,
          invoicedUnpaidSeconds: 3000,
        },
        {
          projectId: 'b',
          trackedSeconds: 2000,
          paidSeconds: 0,
          invoicedSeconds: 0,
          invoicedUnpaidSeconds: 0,
        },
      ]),
    ).toEqual({
      trackedSeconds: 12_000,
      invoicedSeconds: 7000,
      paidSeconds: 4000,
      parts: { paid: 4000, awaiting: 3000, open: 5000 },
    })
  })

  it('counts only the projects whose money the reader may see', () => {
    expect(
      getTimeBilling([
        { projectId: 'viewed', trackedSeconds: 5000 },
        {
          projectId: 'own',
          trackedSeconds: 1000,
          paidSeconds: 1000,
          invoicedSeconds: 1000,
          invoicedUnpaidSeconds: 0,
        },
      ])?.trackedSeconds,
    ).toBe(1000)
  })

  it('is missing for a reader who sees no money at all', () => {
    expect(
      getTimeBilling([{ projectId: 'a', trackedSeconds: 5000 }]),
    ).toBeNull()
  })
})
