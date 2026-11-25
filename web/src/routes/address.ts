import { isRecordId } from '@/shared/lib'

/**
 * The parameter names every filtered page shares: a period, and the projects
 * and people it covers. A link carries them from one page to another, so the
 * pages must agree on them; this is the only place they are spelled.
 */
export const SHARED_PARAMS = {
  from: 'from',
  to: 'to',
  projects: 'projects',
  people: 'people',
} as const

/** Names older links used, still read so they keep opening. */
const LEGACY_PARAMS = {
  projects: 'project',
  people: 'person',
} as const

/** The most ids a link may carry for one filter. */
const MAX_IDS = 100

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A calendar day as written, `yyyy-MM-dd`; anything else is left out. */
export const readDay = (search: URLSearchParams, name: 'from' | 'to') => {
  const value = search.get(SHARED_PARAMS[name])?.trim()

  return value && DAY.test(value) ? value : undefined
}

/**
 * The ids a list parameter names, as the page's filter takes them: comma
 * separated, record ids only, each once. The legacy singular name is read
 * when the list is missing. A malformed id is dropped rather than failing
 * the page: the API refuses one, which would turn a mistyped link into an
 * error instead of the unfiltered page.
 */
export const readIds = (
  search: URLSearchParams,
  name: 'projects' | 'people',
): string[] => {
  const value =
    search.get(SHARED_PARAMS[name]) ?? search.get(LEGACY_PARAMS[name]) ?? ''

  return [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => isRecordId(id)),
    ),
  ].slice(0, MAX_IDS)
}

/** The first id of a list parameter, for a page that filters by one. */
export const readId = (
  search: URLSearchParams,
  name: 'projects' | 'people',
): string | undefined => readIds(search, name)[0]

/** The period and the projects and people, under their shared names. */
export const writeShared = (
  search: URLSearchParams,
  {
    from,
    to,
    projectIds,
    userIds,
  }: {
    from?: string
    to?: string
    projectIds?: readonly string[]
    userIds?: readonly string[]
  },
) => {
  if (from) {
    search.set(SHARED_PARAMS.from, from)
  }
  if (to) {
    search.set(SHARED_PARAMS.to, to)
  }
  if (projectIds && projectIds.length > 0) {
    search.set(SHARED_PARAMS.projects, projectIds.join(','))
  }
  if (userIds && userIds.length > 0) {
    search.set(SHARED_PARAMS.people, userIds.join(','))
  }

  return search
}

/** A path with its search, without a dangling `?` when there is none. */
export const withSearch = (path: string, search: URLSearchParams) => {
  const query = search.toString()

  return query ? `${path}?${query}` : path
}
