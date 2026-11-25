import { describe, expect, it } from 'vitest'

import {
  invoiceAccess,
  projectAccess,
  readerAccess,
  type ProjectAccess,
  type ReaderRole,
} from './access'

// The plan reaches the client as `canTrack`: the API's `Plan.mayTrack` on an
// active project. "limited" is a worker past the owner's Free seats, or a
// closed project.
type PlanCase = 'allows' | 'limited'

const o = true
const _ = false

// role × plan → amounts, detail, agents, everyone, invoice, manage, track
const TABLE: [ReaderRole | undefined, PlanCase, ProjectAccess][] = [
  ['owner', 'allows', row(o, o, o, o, o, o, o)],
  ['owner', 'limited', row(o, o, o, o, o, o, _)],
  ['worker', 'allows', row(o, o, o, _, o, _, o)],
  ['worker', 'limited', row(o, o, o, _, o, _, _)],
  ['viewer', 'allows', row(_, _, _, _, _, _, _)],
  ['viewer', 'limited', row(_, _, _, _, _, _, _)],
  [undefined, 'allows', row(_, _, _, _, _, _, _)],
  [undefined, 'limited', row(_, _, _, _, _, _, _)],
]

function row(
  amounts: boolean,
  detail: boolean,
  agents: boolean,
  everyone: boolean,
  invoice: boolean,
  manage: boolean,
  track: boolean,
): ProjectAccess {
  return { amounts, detail, agents, everyone, invoice, manage, track }
}

describe('Access to a project: role × plan × action', () => {
  it.each(TABLE)('%s, plan %s', (role, plan, expected) => {
    expect(projectAccess({ role, canTrack: plan === 'allows' })).toEqual(
      expected,
    )
  })

  it('grants nothing without a project', () => {
    expect(projectAccess(null)).toEqual(row(_, _, _, _, _, _, _))
  })
})

describe('Access across the reader’s projects', () => {
  it.each([
    [[], { works: _, owns: _, amounts: _, viewsOnly: _ }],
    [['viewer'], { works: _, owns: _, amounts: _, viewsOnly: o }],
    [['viewer', 'worker'], { works: o, owns: _, amounts: o, viewsOnly: _ }],
    [['viewer', 'owner'], { works: o, owns: o, amounts: o, viewsOnly: _ }],
    [[undefined], { works: _, owns: _, amounts: _, viewsOnly: _ }],
  ] as const)('%j', (roles, expected) => {
    expect(readerAccess(roles)).toEqual(expected)
  })
})

describe('Access to an invoice', () => {
  const invoice = (state: string) => ({
    state,
    user: { id: 'worker' },
    project: { user: { id: 'owner' } },
  })

  it.each([
    // state, reader, settle, reject
    ['Requested', 'worker', o, _],
    ['Requested', 'owner', _, o],
    ['Requested', 'viewer', _, _],
    ['PAID', 'worker', o, _],
    ['PAID', 'owner', _, _],
    ['REJECTED', 'worker', _, _],
    ['REJECTED', 'owner', _, _],
  ] as const)('%s, read by %s', (state, reader, settle, reject) => {
    expect(invoiceAccess(invoice(state), { id: reader })).toEqual({
      settle,
      reject,
    })
  })

  it('grants nothing to a reader not signed in', () => {
    expect(invoiceAccess(invoice('Requested'), null)).toEqual({
      settle: _,
      reject: _,
    })
  })
})
