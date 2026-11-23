import {
  addDays,
  addHours,
  addMonths,
  addWeeks,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

import {
  fromDay,
  rangeLengthDays,
  toDay,
  weekStartsOnFor,
} from '../../lib/date-range'

import { seriesColor } from './chart-palette'

import type { Bucket, BucketSeries } from './bucket-bar-chart'

/** How finely rows arrive: one per day, or one per hour of a day. */
export type Grain = 'day' | 'hour'

/** Reader's days, both ends included. */
export type BarPeriod = { from: string; to: string }

/**
 * Rows to draw, and how to read one. `grain` is the finest the rows arrive
 * in: a chart is never drawn finer than its coarsest source, so rows that
 * only come by day are never laid on hours.
 */
export type BarSource<Row extends { day: string }> = {
  rows: readonly Row[] | null | undefined
  grain: Grain
  /** What one row adds, by series key. A row may add to several series. */
  values: (row: Row) => Record<string, number>
}

/** Something a series can be named after, such as a project or an agent. */
export type NamedSeries = { id: string; title: string }

/**
 * Series ranked from the rows: the busiest of `named` get a colour each, in
 * the order given, and everything else shares "Other".
 */
export type RankedSeries = {
  ranked: readonly NamedSeries[]
  otherLabel: string
}

/** One series' part of everything drawn, most first. */
export type ShareRow = {
  key: string
  title: string
  color: string
  value: number
  /** 0-1 of the whole. */
  share: number
}

export type PeriodBars = {
  buckets: Bucket[]
  series: BucketSeries[]
  shares: ShareRow[]
}

type Size = 'hour' | 'day' | 'week' | 'month'
type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6
type Frame = { key: string; start: Date; size: Size }

const OTHER_KEY = '__other'

/** One slot is kept back for "Other", so it always has its own colour. */
const NAMED_SLOTS = 7

const WORKDAY_START = 8
const WORKDAY_END = 19

/**
 * How finely a period is drawn: hours for a day or two, days up to about six
 * weeks, then weeks up to half a year, then months - so a chart is never a
 * single bar, and a bar is never thinner than it can be read.
 */
const sizeFor = (period: BarPeriod): Size => {
  const days = rangeLengthDays(period)

  if (days <= 2) {
    return 'hour'
  }

  if (days <= 45) {
    return 'day'
  }

  return days <= 186 ? 'week' : 'month'
}

/**
 * Whether to ask the server for a period's rows by the hour or by the day:
 * the same rule the bars are drawn by, so what is asked is what is drawn.
 */
export const askGrain = (period: BarPeriod): Grain =>
  sizeFor(period) === 'hour' ? 'hour' : 'day'

/** Series named after the rows' busiest, with the rest under one label. */
export const ranked = (
  named: readonly NamedSeries[],
  otherLabel: string,
): RankedSeries => ({ ranked: named, otherLabel })

const startOf = (date: Date, size: Size, weekStartsOn: WeekStart) =>
  size === 'week'
    ? startOfWeek(date, { weekStartsOn })
    : size === 'month'
      ? startOfMonth(date)
      : date

const hourKey = (date: Date) =>
  `${toDay(date)}T${String(date.getHours()).padStart(2, '0')}`

/** The bar a row's day falls in; `null` when the row cannot be placed. */
const keyOf = (day: string, size: Size, weekStartsOn: WeekStart) => {
  if (size === 'hour') {
    // Only a row that says its hour belongs to one.
    return day.length > 10 ? day : null
  }

  return toDay(startOf(fromDay(day.slice(0, 10)), size, weekStartsOn))
}

/** Every bar of the period, in order, empty ones included. */
const framesOf = (
  period: BarPeriod,
  size: Size,
  weekStartsOn: WeekStart,
): Frame[] => {
  const frames: Frame[] = []

  if (size === 'hour') {
    const end = addDays(fromDay(period.to), 1)

    for (let at = fromDay(period.from); at < end; at = addHours(at, 1)) {
      frames.push({ key: hourKey(at), start: at, size })
    }

    return frames
  }

  const last = fromDay(period.to)
  const step = size === 'day' ? addDays : size === 'week' ? addWeeks : addMonths

  for (
    let at = startOf(fromDay(period.from), size, weekStartsOn);
    at <= last;
    at = step(at, 1)
  ) {
    frames.push({ key: toDay(at), start: at, size })
  }

  return frames
}

/**
 * Hours trimmed to the working day - 8:00 to 19:00 - widened to any hour
 * with something in it, so a day is not mostly empty night.
 */
const visible = (frames: Frame[], withData: Set<string>): Frame[] => {
  if (frames[0]?.size !== 'hour') {
    return frames
  }

  const keep = frames.map((frame) => {
    const hour = frame.start.getHours()

    return (
      withData.has(frame.key) || (hour >= WORKDAY_START && hour < WORKDAY_END)
    )
  })
  const first = keep.indexOf(true)
  const last = keep.lastIndexOf(true)

  return first === -1 ? frames : frames.slice(first, last + 1)
}

/** A short axis label and a full tooltip title for a bar. */
const labelsOf = (frame: Frame, language: string) => {
  const short = new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
  })

  if (frame.size === 'hour') {
    const hour = new Intl.DateTimeFormat(language, { hour: 'numeric' })

    return {
      label: hour.format(frame.start),
      title: `${new Intl.DateTimeFormat(language, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(frame.start)}, ${hour.format(frame.start)}`,
    }
  }

  if (frame.size === 'month') {
    return {
      label: new Intl.DateTimeFormat(language, { month: 'short' }).format(
        frame.start,
      ),
      title: new Intl.DateTimeFormat(language, {
        month: 'long',
        year: 'numeric',
      }).format(frame.start),
    }
  }

  if (frame.size === 'week') {
    return {
      label: short.format(frame.start),
      title: `${short.format(frame.start)} – ${short.format(addDays(frame.start, 6))}`,
    }
  }

  return {
    label: short.format(frame.start),
    title: new Intl.DateTimeFormat(language, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(frame.start),
  }
}

/**
 * Which of `named` get a series of their own, and what every key is drawn
 * under. The busiest get a colour each, in the order `named` gives - so the
 * legend and the colours do not move with which is busiest - and the rest,
 * with any key `named` does not know, share "Other".
 */
const rank = (
  { ranked: named, otherLabel }: RankedSeries,
  totals: Map<string, number>,
) => {
  const known = new Set(named.map((item) => item.id))
  const busiest = [...totals]
    .filter(([key, total]) => total > 0 && known.has(key))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const stray = [...totals].some(([key, total]) => total > 0 && !known.has(key))
  const fits = !stray && busiest.length <= NAMED_SLOTS + 1
  const chosen = new Set(
    busiest.slice(0, fits ? busiest.length : NAMED_SLOTS).map(([key]) => key),
  )
  const series: BucketSeries[] = named
    .filter((item) => chosen.has(item.id))
    .map((item, index) => ({
      key: item.id,
      label: item.title,
      color: seriesColor(index),
    }))
  const hasOther = [...totals].some(
    ([key, total]) => total > 0 && !chosen.has(key),
  )

  return {
    seriesKeyOf: (key: string) => (chosen.has(key) ? key : OTHER_KEY),
    series: hasOther
      ? [
          ...series,
          { key: OTHER_KEY, label: otherLabel, color: seriesColor(-1) },
        ]
      : series,
  }
}

const isRanked = (
  series: readonly BucketSeries[] | RankedSeries,
): series is RankedSeries => !Array.isArray(series)

/**
 * A period's rows as the bars of a chart, with the series that name them and
 * each series' share of the whole.
 *
 * The period decides how finely it is drawn, never finer than the coarsest
 * source. A row for a day outside the period is left out: a bar never shows
 * another day's work.
 */
export function periodBars<Rows extends readonly { day: string }[] | []>({
  period,
  language,
  sources,
  series,
}: {
  period: BarPeriod
  /** For the labels and the week's first day. */
  language: string
  sources: { [Index in keyof Rows]: BarSource<Rows[Index]> }
  series: readonly BucketSeries[] | RankedSeries
}): PeriodBars {
  const weekStartsOn = weekStartsOnFor(language)
  const byDay = (sources as BarSource<{ day: string }>[]).some(
    (source) => source.grain === 'day',
  )
  const wanted = sizeFor(period)
  const size: Size = wanted === 'hour' && byDay ? 'day' : wanted
  const frames = framesOf(period, size, weekStartsOn)
  const inPeriod = new Set(frames.map((frame) => frame.key))
  const bars = new Map<string, Record<string, number>>()
  const totals = new Map<string, number>()

  for (const source of sources as BarSource<{ day: string }>[]) {
    for (const row of source.rows ?? []) {
      const key = keyOf(row.day, size, weekStartsOn)

      if (key === null || !inPeriod.has(key)) {
        continue
      }

      const bar = bars.get(key) ?? {}

      for (const [seriesKey, value] of Object.entries(source.values(row))) {
        bar[seriesKey] = (bar[seriesKey] ?? 0) + value
        totals.set(seriesKey, (totals.get(seriesKey) ?? 0) + value)
      }

      bars.set(key, bar)
    }
  }

  const ranking = isRanked(series) ? rank(series, totals) : null
  const drawn: BucketSeries[] = isRanked(series)
    ? (ranking?.series ?? [])
    : [...series]
  const drawnKeyOf = ranking ? ranking.seriesKeyOf : (key: string) => key
  const merge = (values: Record<string, number>) => {
    const merged: Record<string, number> = {}

    for (const [key, value] of Object.entries(values)) {
      merged[drawnKeyOf(key)] = (merged[drawnKeyOf(key)] ?? 0) + value
    }

    return merged
  }

  const buckets: Bucket[] = visible(frames, new Set(bars.keys())).map(
    (frame) => ({
      key: frame.key,
      ...labelsOf(frame, language),
      values: merge(bars.get(frame.key) ?? {}),
    }),
  )

  const drawnTotals = merge(Object.fromEntries(totals))
  const whole = drawn.reduce(
    (sum, item) => sum + Math.max(0, drawnTotals[item.key] ?? 0),
    0,
  )
  const shares: ShareRow[] = drawn
    .map((item) => ({
      key: item.key,
      title: item.label,
      color: item.color,
      value: drawnTotals[item.key] ?? 0,
      share: whole > 0 ? (drawnTotals[item.key] ?? 0) / whole : 0,
    }))
    .filter((row) => row.value > 0)
    .sort(
      (a, b) =>
        Number(a.key === OTHER_KEY) - Number(b.key === OTHER_KEY) ||
        b.value - a.value ||
        a.title.localeCompare(b.title),
    )

  return { buckets, series: drawn, shares }
}
