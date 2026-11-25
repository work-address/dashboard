import { readDay, readIds, writeShared } from './address'

/**
 * What the dashboard's address says: a period, and the projects and people
 * it covers. Empty lists, or none, mean everything the reader can see.
 */
export type DashboardAddress = {
  /** Calendar days, `yyyy-MM-dd`, both ends included. */
  from?: string
  to?: string
  projectIds?: string[]
  userIds?: string[]
}

export const readDashboardAddress = (
  search: URLSearchParams,
): DashboardAddress => ({
  from: readDay(search, 'from'),
  to: readDay(search, 'to'),
  projectIds: readIds(search, 'projects'),
  userIds: readIds(search, 'people'),
})

export const writeDashboardAddress = (address: DashboardAddress = {}) =>
  writeShared(new URLSearchParams(), address)
