import { describe, expect, it } from 'vitest'

import {
  getReportDays,
  getReportProjectsLabel,
  getReportUrl,
  toReportDraft,
} from './share-report'

const source = {
  range: { from: '2026-11-16', to: '2026-11-22' },
  projectIds: [],
  visibleProjectIds: ['a', 'b'],
  timeZone: 'Europe/Madrid',
}

describe('report draft', () => {
  it('fixes "every project" to the projects there are today', () => {
    expect(toReportDraft(source)).toEqual({
      from: '2026-11-16',
      to: '2026-11-23',
      timeZone: 'Europe/Madrid',
      projectIds: ['a', 'b'],
    })
  })

  it('keeps the page filters when they are set', () => {
    expect(
      toReportDraft({ ...source, projectIds: ['b'], userIds: ['me'] }),
    ).toMatchObject({ projectIds: ['b'], userIds: ['me'] })
  })

  it('has nothing to share without a project', () => {
    expect(toReportDraft({ ...source, visibleProjectIds: [] })).toBeNull()
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
