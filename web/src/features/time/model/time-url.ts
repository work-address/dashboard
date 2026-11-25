import { format, isValid, parse } from 'date-fns'

import {
  DEFAULT_TIME_SORT_FIELD,
  DEFAULT_TIME_SORT_ORDER,
  TIME_SORT_FIELDS,
  getTimeSortField,
  getTimeSortOrder,
  toTimeSort,
  type TimeSortField,
} from './time-sort'

import type { TimeFilters, TimeSort } from '@/entities/time'

import { routes, type TimeAddress, type TimeRangeParam } from '@/routes'

const DAY_FORMAT = 'yyyy-MM-dd'

/** The address's name for each numeric filter. */
const RANGE_PARAMS = {
  timeActiveMin: 'activeMin',
  timeActiveMax: 'activeMax',
  keyboardKeysMin: 'keysMin',
  keyboardKeysMax: 'keysMax',
  mouseKeysMin: 'clicksMin',
  mouseKeysMax: 'clicksMax',
  mouseDistanceMin: 'distanceMin',
  mouseDistanceMax: 'distanceMax',
} as const satisfies Partial<Record<keyof TimeFilters, TimeRangeParam>>

type RangeFilter = keyof typeof RANGE_PARAMS

const readDay = (value?: string) => {
  if (!value) {
    return
  }

  // Parsed in the reader's timezone: a day in the URL is the day they picked,
  // the same midnight the date picker produces.
  const date = parse(value, DAY_FORMAT, new Date())

  return isValid(date) ? date.getTime() : undefined
}

const isSortField = (value?: string): value is TimeSortField =>
  TIME_SORT_FIELDS.some((entry) => entry.field === value)

/**
 * The worklog filters and sort an address describes. Anything unknown or
 * malformed is dropped rather than failing the page.
 */
export const fromTimeAddress = (
  address: TimeAddress,
): { filters: Partial<TimeFilters>; sort: TimeSort } => {
  const filters: Partial<TimeFilters> = {}

  const fromAt = readDay(address.from)
  const toAt = readDay(address.to)

  if (fromAt != null) {
    filters.fromAt = fromAt
  }
  if (toAt != null) {
    filters.toAt = toAt
  }
  if (address.projectId) {
    filters.activityId = address.projectId
  }
  if (address.note) {
    filters.note = address.note
  }

  for (const key of Object.keys(RANGE_PARAMS) as RangeFilter[]) {
    const value = address[RANGE_PARAMS[key]]

    if (value != null) {
      filters[key] = value
    }
  }

  const order = address.order?.toUpperCase()
  const sort = toTimeSort(
    isSortField(address.sort) ? address.sort : DEFAULT_TIME_SORT_FIELD,
    order === 'ASC' || order === 'DESC' ? order : DEFAULT_TIME_SORT_ORDER,
  )

  return { filters, sort }
}

/** The address for a set of filters and a sort; defaults are left out. */
export const toTimeAddress = (
  filters: Partial<TimeFilters>,
  sort: TimeSort,
): TimeAddress => {
  const address: TimeAddress = {}

  if (filters.fromAt != null) {
    address.from = format(filters.fromAt, DAY_FORMAT)
  }
  if (filters.toAt != null) {
    address.to = format(filters.toAt, DAY_FORMAT)
  }
  if (filters.activityId) {
    address.projectId = filters.activityId
  }
  if (filters.note) {
    address.note = filters.note
  }

  for (const key of Object.keys(RANGE_PARAMS) as RangeFilter[]) {
    const value = filters[key]

    // A field typed into still holds a string until it is applied.
    if (value != null && String(value) !== '') {
      const parsed = Number(value)

      if (Number.isFinite(parsed)) {
        address[RANGE_PARAMS[key]] = parsed
      }
    }
  }

  const field = getTimeSortField(sort)
  const order = getTimeSortOrder(sort)

  if (field !== DEFAULT_TIME_SORT_FIELD || order !== DEFAULT_TIME_SORT_ORDER) {
    address.sort = field
    address.order = order === 'ASC' ? 'asc' : 'desc'
  }

  return address
}

export const parseTimeSearch = (search: URLSearchParams) =>
  fromTimeAddress(routes.time.read(search))

export const toTimeSearch = (
  filters: Partial<TimeFilters>,
  sort: TimeSort,
): URLSearchParams => routes.time.write(toTimeAddress(filters, sort))
