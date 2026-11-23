import { describe, expect, it } from 'vitest'

import {
  getReportDays,
  getReportProjectsLabel,
  getReportUrl,
  toReportDraft,
} from './share-report'

const query = {
  from: '2026-11-16',
  to: '2026-11-23',
  timeZone: 'Europe/Madrid',
}

describe('report draft', () => {
  it('shares the page’s query, naming no project for "every project"', () => {
    expect(toReportDraft(query)).toEqual(query)
    expect(toReportDraft({ ...query, projectIds: [], userIds: [] })).toEqual(
      query,
    )
  })

  it('keeps the page filters when they are set', () => {
    expect(
      toReportDraft({ ...query, projectIds: ['b'], userIds: ['me'] }),
    ).toEqual({ ...query, projectIds: ['b'], userIds: ['me'] })
  })

  it('leaves out what only a chart’s request carries', () => {
    expect(
      toReportDraft({ ...query, bucket: 'hour', agentIds: ['a'] }),
    ).toEqual(query)
  })

  it('has nothing to share before the page has a query', () => {
    expect(toReportDraft(null)).toBeNull()
  })
})

describe('report link and days', () => {
  it('builds a link that does not depend on the page it was made on', () => {
    expect(getReportUrl('https://app.address.work/time?from=1', 'abc')).toBe(
      'https://app.address.work/report/abc',
    )
  })

  it('reads the stored exclusive end as the last day', () => {
    expect(getReportDays({ from: '2026-11-16', to: '2026-11-23' })).toEqual({
      from: '2026-11-16',
      to: '2026-11-22',
    })
  })
})

describe('report projects label', () => {
  const titles = new Map([
    ['a', 'Acme'],
    ['b', 'Bolt'],
    ['c', 'Core'],
  ])
  const more = (count: number) => `and ${count} more`

  it('names one project, or the first and how many more', () => {
    expect(getReportProjectsLabel(['a'], titles, more, 'Report')).toBe('Acme')
    expect(
      getReportProjectsLabel(['a', 'b', 'c'], titles, more, 'Report'),
    ).toBe('Acme and 2 more')
  })

  it('falls back when no project is known any more', () => {
    expect(getReportProjectsLabel(['gone'], titles, more, 'Report')).toBe(
      'Report',
    )
  })
})
