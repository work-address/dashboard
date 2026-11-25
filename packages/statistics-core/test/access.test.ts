import { describe, expect, it } from 'vitest'

import {
  accessOf,
  FREE_PLAN_WORKERS,
  listsRow,
  roleOf,
  trackingWorkers,
} from '../src/index'

const lists = { workers: ['0xWorker'], viewers: ['0xViewer', '0xWorker'] }

describe('roleOf', () => {
  it('is the owner first, whatever the lists say', () => {
    expect(roleOf(true, lists, '0xWorker')).toBe('owner')
  })

  it('is a worker before a viewer, matching addresses as accounts do', () => {
    expect(roleOf(false, lists, ' 0xworker ')).toBe('worker')
    expect(roleOf(false, lists, '0xVIEWER')).toBe('viewer')
  })

  it('is nothing for someone on no list, or with no lists at all', () => {
    expect(roleOf(false, lists, '0xStranger')).toBeNull()
    expect(roleOf(false, { workers: null }, '0xWorker')).toBeNull()
  })
})

describe('accessOf', () => {
  it('lets an owner do everything, whatever their plan', () => {
    expect(accessOf('owner', false)).toEqual({
      role: 'owner',
      reads: true,
      works: true,
      tracks: true,
      seesMoney: true,
      lists: 'everyone',
    })
  })

  it('keeps a worker the plan does not take on the record, without recording', () => {
    expect(accessOf('worker', false)).toEqual({
      role: 'worker',
      reads: true,
      works: true,
      tracks: false,
      seesMoney: true,
      lists: 'own',
    })
    expect(accessOf('worker', true).tracks).toBe(true)
  })

  it('gives a viewer time alone and no rows', () => {
    expect(accessOf('viewer', true)).toEqual({
      role: 'viewer',
      reads: true,
      works: false,
      tracks: false,
      seesMoney: false,
      lists: 'none',
    })
  })

  it('gives someone with no role nothing', () => {
    expect(accessOf(null, true)).toMatchObject({
      reads: false,
      works: false,
      tracks: false,
      lists: 'none',
    })
  })
})

describe('listsRow', () => {
  it('lists everyone’s rows to an owner, their own to a worker, none to a viewer', () => {
    expect(listsRow('owner', 'someone', 'me')).toBe(true)
    expect(listsRow('worker', 'me', 'me')).toBe(true)
    expect(listsRow('worker', 'someone', 'me')).toBe(false)
    expect(listsRow('viewer', 'me', 'me')).toBe(false)
    expect(listsRow(null, 'me', 'me')).toBe(false)
  })
})

describe('trackingWorkers', () => {
  const listed = ['0xa', '0xb', '0xc']

  it('takes everyone on Premium', () => {
    expect(trackingWorkers(listed, { premium: true })).toEqual(new Set(listed))
  })

  it('takes everyone on Free while they fit the plan', () => {
    expect(
      trackingWorkers(listed.slice(0, FREE_PLAN_WORKERS), { premium: false }),
    ).toEqual(new Set(['0xa', '0xb']))
  })

  it('past the plan, takes the owner’s choice topped up from the first listed', () => {
    expect(trackingWorkers(listed, { premium: false, kept: ['0xC'] })).toEqual(
      new Set(['0xc', '0xa']),
    )
    expect(trackingWorkers(listed, { premium: false })).toEqual(
      new Set(['0xa', '0xb']),
    )
  })

  it('ignores a kept address that is no longer listed', () => {
    expect(
      trackingWorkers(listed, { premium: false, kept: ['0xgone'] }),
    ).toEqual(new Set(['0xa', '0xb']))
  })
})
