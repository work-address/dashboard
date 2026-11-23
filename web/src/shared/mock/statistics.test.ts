import { StatisticsInsights } from '@work-address/statistics-core'
import { describe, expect, it } from 'vitest'

import { buildDb, type Db } from './db'
import {
  DEFAULT_DEMO_SETTINGS,
  type DemoRole,
  type DemoSettings,
} from './settings'
import { agentIdOf, shapeRun, shapeTime } from './shape'
import {
  agentsDaily,
  DemoHttpError,
  insightsMe,
  overview,
  statisticsScope,
  team,
  timeDaily,
  type StatisticsQuery,
} from './statistics'

const NOW = new Date(2026, 9, 21, 15, 30).getTime()

const db = (
  role: DemoRole,
  world: 'typical' | 'busy' = 'typical',
  plan: DemoSettings['plan'] = 'premium',
) => buildDb({ ...DEFAULT_DEMO_SETTINGS, role, world, plan }, NOW)

const QUERY: StatisticsQuery = {
  from: '2026-09-01',
  to: '2026-10-22',
  timeZone: 'UTC',
}

const refused = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return error instanceof DemoHttpError ? error.status : 'other'
  }
  return null
}

const totalsOf = (data: Db) =>
  overview(statisticsScope(data, data.meId, QUERY, NOW)).totals

describe('demo statistics per role', () => {
  it('gives an owner everything, with what is paid', () => {
    const totals = totalsOf(db('owner'))

    expect(totals.length).toBeGreaterThan(0)
    expect(totals.every((row) => 'paidSeconds' in row)).toBe(true)
  })

  it('never gives a viewer activity or money', () => {
    const totals = totalsOf(db('viewer'))

    expect(totals.length).toBeGreaterThan(0)
    for (const row of totals) {
      expect(row).not.toHaveProperty('paidSeconds')
      expect(row).not.toHaveProperty('activeSeconds')
    }
  })

  it('counts only a worker’s own time on projects they do not own', () => {
    const data = db('worker')
    const tracked = totalsOf(data).reduce(
      (sum, row) => sum + Number(row.trackedSeconds),
      0,
    )
    const from = new Date(`${QUERY.from}T00:00:00`).getTime()
    const to = new Date(`${QUERY.to}T00:00:00`).getTime()
    const own = data.times
      .filter((t) => t.userId === data.meId)
      .filter((t) => Date.parse(t.fromAt) >= from && Date.parse(t.fromAt) < to)
      .reduce(
        (sum, t) => sum + (Date.parse(t.toAt) - Date.parse(t.fromAt)) / 1000,
        0,
      )

    expect(tracked).toBe(own)
  })

  it('keeps the team list to owners', () => {
    const owner = db('owner')
    const worker = db('worker')

    expect(
      team(statisticsScope(owner, owner.meId, QUERY, NOW)).rows.length,
    ).toBeGreaterThan(0)
    expect(
      refused(() => team(statisticsScope(worker, worker.meId, QUERY, NOW))),
    ).toBe(403)
  })

  it('describes the reader in insights whoever the people filter selects', () => {
    const data = db('owner')
    const other = data.users.find((u) => u.id !== data.meId)!.id

    expect(
      insightsMe(data, data.meId, { ...QUERY, userIds: [other] }, NOW),
    ).toEqual(insightsMe(data, data.meId, QUERY, NOW))
  })

  it('takes every project of a busy account without naming them', () => {
    const data = db('owner', 'busy')
    const scope = statisticsScope(data, data.meId, QUERY, NOW)

    expect(scope.projects.length).toBeGreaterThan(100)
  })

  it('refuses a project the reader cannot see', () => {
    const data = db('owner')

    expect(
      refused(() =>
        statisticsScope(
          data,
          data.meId,
          { ...QUERY, projectIds: ['nope'] },
          NOW,
        ),
      ),
    ).toBe(403)
  })
})

describe('demo invoiced time', () => {
  const spanSeconds = (times: { fromAt: string; toAt: string }[]) =>
    times.reduce(
      (sum, time) =>
        sum + (Date.parse(time.toAt) - Date.parse(time.fromAt)) / 1000,
      0,
    )

  it('counts what an invoice covers, and what of it is not marked paid', () => {
    const data = db('owner')
    const scope = statisticsScope(data, data.meId, QUERY, NOW)
    const rows = overview(scope).totals
    const inPeriod = data.times.filter(
      (time) =>
        Date.parse(time.fromAt) >= scope.from &&
        Date.parse(time.fromAt) < scope.to,
    )
    const invoiced = inPeriod.filter((time) => time.invoiceId)
    const sum = (key: string) =>
      rows.reduce((all, row) => all + Number(row[key]), 0)

    expect(invoiced.length).toBeGreaterThan(0)
    expect(invoiced.some((time) => time.isPaid)).toBe(true)
    expect(invoiced.some((time) => !time.isPaid)).toBe(true)
    expect(sum('invoicedSeconds')).toBe(spanSeconds(invoiced))
    expect(sum('invoicedUnpaidSeconds')).toBe(
      spanSeconds(invoiced.filter((time) => !time.isPaid)),
    )
  })

  it('never gives a viewer invoiced time', () => {
    for (const row of totalsOf(db('viewer'))) {
      expect(row).not.toHaveProperty('invoicedSeconds')
      expect(row).not.toHaveProperty('invoicedUnpaidSeconds')
    }
  })
})

describe('demo hidden history', () => {
  const INSIDE: StatisticsQuery = { ...QUERY, from: '2026-10-10' }
  const answers = (data: Db, query: StatisticsQuery) => {
    const scope = statisticsScope(data, data.meId, query, NOW)

    return [overview(scope), agentsDaily(scope)]
  }

  it('says from when the free plan hides history, to the owner who can upgrade', () => {
    for (const answer of answers(db('owner', 'typical', 'free'), QUERY)) {
      expect(answer).toMatchObject({
        hiddenBefore: new Date(NOW - 14 * 86_400_000).toISOString(),
        canUpgrade: true,
      })
    }
  })

  it('says nothing for a period inside the free plan’s window', () => {
    for (const answer of answers(db('owner', 'typical', 'free'), INSIDE)) {
      expect(answer).not.toHaveProperty('hiddenBefore')
      expect(answer).not.toHaveProperty('canUpgrade')
    }
  })

  it('says nothing on Premium', () => {
    for (const answer of answers(db('owner'), QUERY)) {
      expect(answer).not.toHaveProperty('hiddenBefore')
      expect(answer).not.toHaveProperty('canUpgrade')
    }
  })

  it('follows the project owner’s plan, not the reader’s', () => {
    // The demo's other people are on Premium, so nothing a free worker reads
    // on their projects is hidden.
    for (const answer of answers(db('worker', 'typical', 'free'), QUERY)) {
      expect(answer).not.toHaveProperty('hiddenBefore')
    }
  })
})

describe('demo agent time', () => {
  const agents = (data: Db, query: StatisticsQuery = QUERY) =>
    agentsDaily(statisticsScope(data, data.meId, query, NOW))

  it('keeps a row per day, worker and agent, by the demo’s agent id', () => {
    const data = db('owner')
    const { daily } = agents(data)

    expect(daily.length).toBeGreaterThan(0)
    expect(new Set(daily.map((row) => row.userId)).size).toBeGreaterThan(1)
    for (const row of daily) {
      expect(row.agentId).toBe(agentIdOf(row))
    }
    const keys = daily.map((row) => `${row.day}|${row.userId}|${row.agentId}`)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('counts every run once, on the day it started', () => {
    const { runs, runsDaily } = agents(db('owner'))
    const count = (rows: { count: number }[]) =>
      rows.reduce((sum, row) => sum + row.count, 0)

    expect(count(runs)).toBeGreaterThan(0)
    expect(count(runsDaily)).toBe(count(runs))
    expect(runsDaily.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.day))).toBe(
      true,
    )
  })

  it('keeps run days as days when agent time is cut by hour', () => {
    const data = db('owner')
    const hourly = agents(data, { ...QUERY, bucket: 'hour' })

    expect(
      hourly.daily.every((row) => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(row.day)),
    ).toBe(true)
    expect(hourly.runsDaily).toEqual(agents(data).runsDaily)
  })

  it('narrows agent time and runs to the agents asked for', () => {
    const data = db('owner')
    const scope = statisticsScope(data, data.meId, QUERY, NOW)
    const all = agents(data)
    const { agentId, userId, product } = all.daily[0]
    const one = agents(data, { ...QUERY, agentIds: [agentId] })
    // The agent's runs on the reader's projects that overlap the period.
    const theirs = data.runs.filter(
      (run) =>
        run.userId === userId &&
        run.product === product &&
        scope.owners.has(run.projectId) &&
        Date.parse(run.toAt) > scope.from &&
        Date.parse(run.fromAt) < scope.to,
    ).length
    const count = (rows: { count: number }[]) =>
      rows.reduce((sum, row) => sum + row.count, 0)

    expect(one.daily).toEqual(
      all.daily.filter((row) => row.agentId === agentId),
    )
    expect(theirs).toBeGreaterThan(0)
    expect(theirs).toBeLessThan(count(all.runs))
    expect(one.runs.every((row) => row.product === product)).toBe(true)
    expect(count(one.runs)).toBe(theirs)
    expect(count(one.runsDaily)).toBe(theirs)
    expect(agents(data, { ...QUERY, agentIds: [] })).toEqual(all)
    expect(agents(data, { ...QUERY, agentIds: ['nobody:none'] })).toEqual({
      daily: [],
      runs: [],
      runsDaily: [],
    })
  })

  it('leaves the team report as it is, whatever agents are asked for', () => {
    const data = db('owner')
    const { agentId } = agents(data).daily[0]

    expect(
      team(
        statisticsScope(
          data,
          data.meId,
          { ...QUERY, agentIds: [agentId] },
          NOW,
        ),
      ),
    ).toEqual(team(statisticsScope(data, data.meId, QUERY, NOW)))
  })
})

describe('demo hourly buckets', () => {
  it('keys time by the reader hour when asked', () => {
    const data = db('owner')
    const rows = timeDaily(
      statisticsScope(data, data.meId, { ...QUERY, bucket: 'hour' }, NOW),
    )

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(row.day))).toBe(
      true,
    )
  })
})

describe('demo visibility of detail', () => {
  it('shows a worker their colleague’s time but not its detail', () => {
    const data = db('worker')
    const colleague = data.times.find((t) => t.userId !== data.meId && t.note)

    expect(colleague).toBeDefined()
    const shaped = shapeTime(data, colleague!, data.meId, NOW)

    expect(shaped.note).toBeNull()
    expect(shaped.minutesActive).toBeNull()
  })

  it('holds a worker’s fresh detail from the owner, and says so', () => {
    const data = db('owner')
    const fresh = data.times
      .filter((t) => t.userId !== data.meId)
      .sort((a, b) => b.toAt.localeCompare(a.toAt))[0]
    const shaped = shapeTime(
      data,
      fresh,
      data.meId,
      Date.parse(fresh.toAt) + 60_000,
    )

    expect(shaped).toMatchObject({
      screenshot: undefined,
      detailPendingReview: true,
    })
    expect(
      shapeTime(
        data,
        fresh,
        data.meId,
        Date.parse(fresh.toAt) + 25 * 3_600_000,
      ),
    ).not.toHaveProperty('detailPendingReview')
  })

  it('holds another worker’s prompt until review', () => {
    const data = db('owner')
    const run = data.runs.find((r) => r.userId !== data.meId && r.prompt)!
    const soon = Date.parse(run.toAt) + 60_000

    expect(shapeRun(data, run, data.meId, soon)).toMatchObject({
      prompt: null,
      promptPendingReview: true,
    })
    expect(
      shapeRun(data, { ...run, released: true }, data.meId, soon).prompt,
    ).toBe(run.prompt)
  })
})

describe('shared statistics rules', () => {
  it('are the API’s own, imported from the shared package', () => {
    // 30 min, a 10-minute gap, 20 min: one focus session of 50 minutes.
    const at = Date.UTC(2026, 9, 19, 9)
    const span = (from: number, to: number): [number, number] => [
      at + from * 60_000,
      at + to * 60_000,
    ]

    expect(
      StatisticsInsights.focusSessions([span(0, 30), span(40, 60)]),
    ).toEqual({
      count: 1,
      minutes: 50,
      longestMinutes: 50,
    })
  })
})
