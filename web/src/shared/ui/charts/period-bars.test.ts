import { describe, expect, it } from 'vitest'

import { askGrain, periodBars, ranked } from './period-bars'

type Row = { day: string; project: string; seconds: number }

const row = (day: string, project: string, hours: number): Row => ({
  day,
  project,
  seconds: hours * 3600,
})

const byProject = (rows: Row[], grain: 'day' | 'hour' = 'day') => ({
  rows,
  grain,
  values: (item: Row) => ({ [item.project]: item.seconds / 3600 }),
})

const one = [{ key: 'a', label: 'A', color: 'red' }]
const keys = (bars: { buckets: { key: string }[] }) =>
  bars.buckets.map((bucket) => bucket.key)

describe('how finely a period is drawn', () => {
  it('lists every day of a week, empty ones included', () => {
    const bars = periodBars({
      period: { from: '2026-10-19', to: '2026-10-25' },
      language: 'ru',
      sources: [byProject([row('2026-10-21', 'a', 2)])],
      series: one,
    })

    expect(keys(bars)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ])
    expect(bars.buckets[2].values).toEqual({ a: 2 })
    expect(bars.buckets[0].values).toEqual({})
  })

  it('gathers a quarter into weeks that start on the reader’s first day', () => {
    const period = { from: '2026-08-01', to: '2026-10-31' }
    const rows = [row('2026-10-21', 'a', 1), row('2026-10-23', 'a', 2)]
    const monday = periodBars({
      period,
      language: 'ru',
      sources: [byProject(rows)],
      series: one,
    })
    const sunday = periodBars({
      period,
      language: 'en',
      sources: [byProject(rows)],
      series: one,
    })

    expect(keys(monday)[0]).toBe('2026-07-27')
    expect(
      monday.buckets.find((bucket) => bucket.key === '2026-10-19')?.values,
    ).toEqual({ a: 3 })
    expect(
      sunday.buckets.find((bucket) => bucket.key === '2026-10-18')?.values,
    ).toEqual({ a: 3 })
  })

  it('gathers most of a year into months', () => {
    const bars = periodBars({
      period: { from: '2026-01-01', to: '2026-10-24' },
      language: 'ru',
      sources: [byProject([row('2026-10-24', 'a', 4)])],
      series: one,
    })

    expect(bars.buckets).toHaveLength(10)
    expect(bars.buckets[9]).toMatchObject({
      key: '2026-10-01',
      values: { a: 4 },
    })
  })

  it('draws a day or two by the hour, trimmed to the working day', () => {
    const bars = periodBars({
      period: { from: '2026-10-25', to: '2026-10-25' },
      language: 'ru',
      sources: [byProject([row('2026-10-25T09', 'a', 0.5)], 'hour')],
      series: one,
    })

    expect(keys(bars)[0]).toBe('2026-10-25T08')
    expect(keys(bars).at(-1)).toBe('2026-10-25T18')
    expect(bars.buckets[1]).toMatchObject({
      key: '2026-10-25T09',
      values: { a: 0.5 },
    })
  })

  it('widens the working day to any hour with something in it', () => {
    const bars = periodBars({
      period: { from: '2026-10-25', to: '2026-10-25' },
      language: 'ru',
      sources: [
        byProject(
          [row('2026-10-25T06', 'a', 1), row('2026-10-25T21', 'a', 1)],
          'hour',
        ),
      ],
      series: one,
    })

    expect(bars.buckets).toHaveLength(16)
  })
})

describe('the grain of the rows', () => {
  const day = { from: '2026-10-25', to: '2026-10-25' }

  it('asks by the hour for a day or two, by the day beyond', () => {
    expect(askGrain(day)).toBe('hour')
    expect(askGrain({ from: '2026-10-24', to: '2026-10-25' })).toBe('hour')
    expect(askGrain({ from: '2026-10-23', to: '2026-10-25' })).toBe('day')
  })

  it('never draws rows that come by day on hours', () => {
    const bars = periodBars({
      period: { from: '2026-10-24', to: '2026-10-25' },
      language: 'ru',
      sources: [
        byProject([row('2026-10-24', 'a', 3), row('2026-10-25', 'a', 5)]),
      ],
      series: one,
    })

    expect(bars.buckets.map((bucket) => [bucket.key, bucket.values])).toEqual([
      ['2026-10-24', { a: 3 }],
      ['2026-10-25', { a: 5 }],
    ])
  })

  it('draws a chart that mixes grains by its coarsest source', () => {
    const bars = periodBars({
      period: day,
      language: 'ru',
      sources: [
        byProject([row('2026-10-25T09', 'a', 1)], 'hour'),
        {
          rows: [{ day: '2026-10-25', count: 4 }],
          grain: 'day' as const,
          values: (item: { day: string; count: number }) => ({
            runs: item.count,
          }),
        },
      ],
      series: one,
    })

    expect(bars.buckets).toHaveLength(1)
    expect(bars.buckets[0].values).toEqual({ a: 1, runs: 4 })
  })

  it('leaves out a row for a day outside the period', () => {
    const bars = periodBars({
      period: { from: '2026-10-19', to: '2026-10-25' },
      language: 'ru',
      sources: [
        byProject([row('2026-10-18', 'a', 9), row('2026-10-19', 'a', 1)]),
      ],
      series: one,
    })

    expect(bars.buckets[0].values).toEqual({ a: 1 })
    expect(bars.shares).toEqual([
      { key: 'a', title: 'A', color: 'red', value: 1, share: 1 },
    ])
  })

  it('reads rows that are still loading as none', () => {
    const bars = periodBars({
      period: { from: '2026-10-19', to: '2026-10-25' },
      language: 'ru',
      sources: [{ ...byProject([]), rows: null }],
      series: one,
    })

    expect(bars.buckets).toHaveLength(7)
    expect(bars.shares).toEqual([])
  })
})

describe('series', () => {
  const period = { from: '2026-10-19', to: '2026-10-25' }

  it('lets one row add to several series', () => {
    const bars = periodBars({
      period,
      language: 'ru',
      sources: [
        {
          rows: [{ day: '2026-10-20', assisted: 1, autonomous: 2 }],
          grain: 'day' as const,
          values: (item: {
            day: string
            assisted: number
            autonomous: number
          }) => ({
            assisted: item.assisted,
            autonomous: item.autonomous,
          }),
        },
      ],
      series: [
        { key: 'assisted', label: 'Assisted', color: 'red' },
        { key: 'autonomous', label: 'Autonomous', color: 'blue' },
      ],
    })

    expect(bars.buckets[1].values).toEqual({ assisted: 1, autonomous: 2 })
    expect(bars.shares.map((share) => [share.key, share.share])).toEqual([
      ['autonomous', 2 / 3],
      ['assisted', 1 / 3],
    ])
  })

  it('names the busiest in the order given, whichever is busiest', () => {
    const bars = periodBars({
      period,
      language: 'ru',
      sources: [
        byProject([row('2026-10-20', 'b', 5), row('2026-10-20', 'a', 1)]),
      ],
      series: ranked(
        [
          { id: 'a', title: 'Acme' },
          { id: 'b', title: 'Bolt' },
          { id: 'idle', title: 'Idle' },
        ],
        'Other',
      ),
    })

    expect(bars.series.map((item) => item.label)).toEqual(['Acme', 'Bolt'])
    expect(bars.series[0].color).not.toBe(bars.series[1].color)
    expect(bars.shares.map((share) => share.title)).toEqual(['Bolt', 'Acme'])
  })

  it('folds what is past the palette into Other, in bars and shares alike', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const bars = periodBars({
      period,
      language: 'ru',
      // 'a' is the busiest and 'i' the least busy.
      sources: [
        byProject(ids.map((id, index) => row('2026-10-20', id, 9 - index))),
      ],
      series: ranked(
        ids.map((id) => ({ id, title: id.toUpperCase() })),
        'Other',
      ),
    })

    expect(bars.series.map((item) => item.label)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'Other',
    ])
    // 'h' and 'i' share one segment.
    const other = bars.series.at(-1)?.key ?? ''

    expect(bars.buckets[1].values[other]).toBe(3)
    expect(bars.shares.at(-1)).toMatchObject({ title: 'Other', value: 3 })
    expect(
      bars.shares.reduce((sum, share) => sum + share.share, 0),
    ).toBeCloseTo(1)
  })

  it('gives eight their own colour each, with no Other', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const bars = periodBars({
      period,
      language: 'ru',
      sources: [byProject(ids.map((id) => row('2026-10-20', id, 1)))],
      series: ranked(
        ids.map((id) => ({ id, title: id })),
        'Other',
      ),
    })

    expect(bars.series).toHaveLength(8)
    expect(new Set(bars.series.map((item) => item.color)).size).toBe(8)
  })

  it('draws a key it was given no name for under Other', () => {
    const bars = periodBars({
      period,
      language: 'ru',
      sources: [
        byProject([row('2026-10-20', 'a', 2), row('2026-10-20', 'gone', 1)]),
      ],
      series: ranked([{ id: 'a', title: 'Acme' }], 'Other'),
    })

    expect(bars.series.map((item) => item.label)).toEqual(['Acme', 'Other'])
    expect(bars.shares.map((share) => share.value)).toEqual([2, 1])
  })
})
