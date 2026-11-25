import { readDay, readId, writeShared } from './address'

/** The numeric filters, by the names the address gives them. */
export const TIME_RANGE_PARAMS = [
  'activeMin',
  'activeMax',
  'keysMin',
  'keysMax',
  'clicksMin',
  'clicksMax',
  'distanceMin',
  'distanceMax',
] as const

export type TimeRangeParam = (typeof TIME_RANGE_PARAMS)[number]

/**
 * What the /time address says.
 *
 * The worklogs filter one project and nobody: a dashboard link naming several
 * projects opens narrowed to the first, and its people are dropped, since the
 * page has no people filter to show or clear them with.
 */
export type TimeAddress = {
  /** Calendar days, `yyyy-MM-dd`, both ends included. */
  from?: string
  to?: string
  projectId?: string
  note?: string
  /** The sort's field as written; the page knows which it can sort by. */
  sort?: string
  order?: 'asc' | 'desc'
} & Partial<Record<TimeRangeParam, number>>

const readNumber = (value: string | null) => {
  if (value == null || value.trim() === '') {
    return
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : undefined
}

export const readTimeAddress = (search: URLSearchParams): TimeAddress => {
  const address: TimeAddress = {}
  const from = readDay(search, 'from')
  const to = readDay(search, 'to')
  const projectId = readId(search, 'projects')
  const note = search.get('note')?.trim()
  const sort = search.get('sort')?.trim()
  const order = search.get('order')?.toLowerCase()

  if (from) {
    address.from = from
  }
  if (to) {
    address.to = to
  }
  if (projectId) {
    address.projectId = projectId
  }
  if (note) {
    address.note = note
  }
  for (const name of TIME_RANGE_PARAMS) {
    const value = readNumber(search.get(name))

    if (value != null) {
      address[name] = value
    }
  }
  if (sort) {
    address.sort = sort
  }
  if (order === 'asc' || order === 'desc') {
    address.order = order
  }

  return address
}

export const writeTimeAddress = (address: TimeAddress = {}) => {
  const search = writeShared(new URLSearchParams(), {
    from: address.from,
    to: address.to,
    projectIds: address.projectId ? [address.projectId] : undefined,
  })

  if (address.note) {
    search.set('note', address.note)
  }
  for (const name of TIME_RANGE_PARAMS) {
    const value = address[name]

    if (value != null && Number.isFinite(value)) {
      search.set(name, String(value))
    }
  }
  if (address.sort) {
    search.set('sort', address.sort)
  }
  if (address.order) {
    search.set('order', address.order)
  }

  return search
}
