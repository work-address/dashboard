/** What a reader is on a project: the API's ProjectAccess.role, or the mock's. */
export type ReaderRole = 'owner' | 'worker' | 'viewer' | null

export type RoleOf<T> = (project: T) => ReaderRole

const works = (role: ReaderRole) => role === 'owner' || role === 'worker'

/**
 * "All projects", narrowed to the ones the people filter can apply to, so an
 * owner who also works on someone else's project can still filter by their
 * workers instead of being refused.
 */
export function projectsForPeople<T>(
  projects: T[],
  roleOf: RoleOf<T>,
  meId: string,
  userIds?: string[],
): T[] {
  if (!userIds?.length) return projects
  const onlySelf = userIds.every((id) => id === meId)
  return projects.filter(
    (project) =>
      roleOf(project) === 'owner' || (onlySelf && works(roleOf(project))),
  )
}

/** Whether these projects may not be read with this query's filters. */
export function refusesQuery<T>(
  projects: T[],
  roleOf: RoleOf<T>,
  meId: string,
  query: { userIds?: string[]; invoiceId?: string },
): boolean {
  const notOwned = projects.some((project) => roleOf(project) !== 'owner')
  const someViewed = projects.some((project) => !works(roleOf(project)))

  return Boolean(
    (query.userIds?.length &&
      notOwned &&
      (someViewed || query.userIds.some((id) => id !== meId))) ||
    (query.invoiceId && someViewed),
  )
}

/** Whether a report may not be read with these roles across its projects. */
export function refusesReport(kind: string, roles: ReaderRole[]): boolean {
  if (kind === 'workers') return roles.some((role) => role !== 'owner')
  if (kind === 'titles') return roles.some((role) => !works(role))
  return false
}

/** How far back one project in a reader's scope keeps its history. */
export interface HistoryLimit {
  /**
   * From when the owner's plan keeps the project's entries and runs, in epoch
   * milliseconds; null when it keeps everything.
   */
  keptFrom: number | null
  /** Whether the reader owns the project, so is the one who can upgrade. */
  owned: boolean
}

/** What a period reaches for and an owner's plan hides; empty when nothing. */
export interface HiddenHistory {
  /** An ISO instant: history before it is hidden on at least one project. */
  hiddenBefore?: string
  /** Present with `hiddenBefore`: the reader owns a project that hides it. */
  canUpgrade?: boolean
}

/**
 * Whether a period starting at `from` asks for history a plan hides. Only the
 * projects whose limit falls inside the period count; the latest of their
 * limits is the one reported, since before it something is always missing.
 */
export function hiddenHistory(
  limits: HistoryLimit[],
  from: number,
): HiddenHistory {
  const hiding = limits.filter(
    (limit): limit is HistoryLimit & { keptFrom: number } =>
      limit.keptFrom !== null && from < limit.keptFrom,
  )
  if (!hiding.length) return {}
  return {
    hiddenBefore: new Date(
      Math.max(...hiding.map((limit) => limit.keptFrom)),
    ).toISOString(),
    canUpgrade: hiding.some((limit) => limit.owned),
  }
}
