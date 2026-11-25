// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import {
  parseDashboardSearch,
  toDashboardSearch,
  type DashboardFilters,
} from './dashboard-filters'

const A = '0b6c6f6e-6b1a-4c3e-9a51-2f0b7c1d9e01'
const U = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a'

describe('dashboard address', () => {
  it('reads back the filters it writes', () => {
    const filters: DashboardFilters = {
      range: { preset: 'custom', from: '2026-11-03', to: '2026-11-09' },
      projectIds: [A],
      userIds: [U],
    }
    const search = toDashboardSearch(filters)

    expect(search.toString()).toBe(
      `from=2026-11-03&to=2026-11-09&projects=${A}&people=${U}`,
    )
    expect(parseDashboardSearch(search, new Date(2026, 10, 25))).toEqual(
      filters,
    )
  })
})
