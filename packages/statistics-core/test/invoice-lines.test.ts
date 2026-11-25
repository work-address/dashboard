import { describe, expect, it } from 'vitest'

import {
  agentLines,
  humanLine,
  invoiceAmount,
  runBillable,
  runFinished,
  type BilledEntry,
  type BilledRun,
  type RunAttachment,
} from '../src/index'

const START = Date.parse('2026-10-01T08:00:00Z')
const at = (minutes: number) => new Date(START + minutes * 60_000).toISOString()

const entry = (
  minutes: number,
  fields: Partial<BilledEntry> = {},
): BilledEntry => ({
  fromAt: at(0),
  toAt: at(minutes),
  source: 'desktop',
  ...fields,
})

describe('humanLine', () => {
  it('rounds once, at the end', () => {
    // Three cent-fractions per entry would round to 3 cents apart from the total.
    expect(humanLine([entry(1), entry(1), entry(1)], 10.1).amountCents).toBe(51)
  })

  it('counts a backwards entry as nothing', () => {
    const line = humanLine([entry(-10), entry(10)], 60)

    expect(line.minutes).toBe(10)
    expect(line.amountCents).toBe(1000)
  })

  it('never counts more active minutes than the entry spans', () => {
    expect(
      humanLine([entry(10, { minutesActive: 25 })], 60).activeMinutes,
    ).toBe(10)
  })

  it('counts manual minutes as those added by hand or the web timer', () => {
    const line = humanLine(
      [entry(10), entry(5, { source: 'manual' }), entry(3, { source: 'web' })],
      60,
    )

    expect(line.minutes).toBe(18)
    expect(line.manualMinutes).toBe(8)
    expect(line).not.toHaveProperty('mobileMinutes')
  })

  it('bills phone time as tracked time, in a part of its own', () => {
    const line = humanLine(
      [
        entry(10, { minutesActive: 4 }),
        entry(10, { source: 'mobile', minutesActive: 10 }),
        entry(5, { source: 'manual' }),
      ],
      60,
    )

    expect(line.minutes).toBe(25)
    expect(line.amountCents).toBe(2500)
    expect(line.mobileMinutes).toBe(10)
    expect(line.manualMinutes).toBe(5)
    // Active minutes are minutes with input: the phone's never are.
    expect(line.activeMinutes).toBe(4)
  })

  it('charges nothing with no rate', () => {
    const line = humanLine([entry(10)], 0)

    expect(line.rateHourCents).toBe(0)
    expect(line.amountCents).toBe(0)
  })

  it('uses each entry’s own span across tracker intervals', () => {
    expect(humanLine([entry(10), entry(1)], 60).minutes).toBe(11)
  })
})

const NOW = START + 24 * 3_600_000

const run = (fields: Partial<BilledRun> = {}): BilledRun => ({
  agentId: 'agent',
  authorId: 'worker',
  product: 'claude-code',
  fromAt: at(0),
  segments: [{ state: 'running', fromAt: at(0), toAt: at(30) }],
  status: 'completed',
  receivedAt: at(30),
  invoiceId: null,
  isPaid: false,
  ...fields,
})

const attachment: RunAttachment = {
  agentId: 'agent',
  workerId: 'worker',
  rateHourCents: 1200,
  rateChanges: [],
}

describe('runFinished', () => {
  it('finishes a terminal run once it has been unchanged a minute', () => {
    const received = START

    expect(runFinished(run({ receivedAt: received }), received + 59_000)).toBe(
      false,
    )
    expect(runFinished(run({ receivedAt: received }), received + 60_000)).toBe(
      true,
    )
  })

  it('finishes a continuously observed run once it goes silent, terminal or not', () => {
    const silent = run({ status: 'running', liveness: true, receivedAt: START })

    expect(runFinished(silent, START + 89_000)).toBe(false)
    expect(runFinished(silent, START + 90_000)).toBe(true)
    expect(runFinished({ ...silent, liveness: false }, NOW)).toBe(false)
  })
})

describe('runBillable', () => {
  it('bills the issuer’s own finished run of an attached agent', () => {
    expect(runBillable(run(), 'worker', [attachment], { now: NOW })).toBe(true)
  })

  it('bills nobody else’s run, nothing already billed or paid, nothing unfinished', () => {
    expect(runBillable(run(), 'owner', [attachment], { now: NOW })).toBe(false)
    expect(
      runBillable(run({ invoiceId: 'i' }), 'worker', [attachment], {
        now: NOW,
      }),
    ).toBe(false)
    expect(
      runBillable(run({ isPaid: true }), 'worker', [attachment], { now: NOW }),
    ).toBe(false)
    expect(
      runBillable(run({ status: 'running' }), 'worker', [attachment], {
        now: NOW,
      }),
    ).toBe(false)
  })

  it('bills nothing of an agent that was never attached', () => {
    expect(runBillable(run(), 'worker', [], { now: NOW })).toBe(false)
  })

  it('with a period, bills a run that starts inside it', () => {
    const options = (from: number, to: number) => ({
      now: NOW,
      period: { from: at(from), to: at(to) },
    })

    expect(runBillable(run(), 'worker', [attachment], options(0, 5))).toBe(true)
    expect(runBillable(run(), 'worker', [attachment], options(-5, 0))).toBe(
      false,
    )
  })
})

describe('agentLines', () => {
  it('bills one line per agent, overlapping runs once', () => {
    const lines = agentLines(
      [
        run(),
        run({ segments: [{ state: 'running', fromAt: at(20), toAt: at(40) }] }),
      ],
      [{ id: 'agent', name: 'My Claude' }],
      [attachment],
      'worker',
      [],
      NOW,
    )

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      kind: 'agent',
      agentId: 'agent',
      name: 'My Claude',
      basis: 'active',
      minutes: 40,
      rateHourCents: 1200,
      amountCents: 800,
    })
  })

  it('names an agent nobody named by its product', () => {
    const [line] = agentLines([run()], [], [attachment], 'worker', [], NOW)

    expect(line.name).toBe('claude-code')
  })

  it('bills waits and unknown stretches, never untracked ones, and says which is which', () => {
    const [line] = agentLines(
      [
        run({
          segments: [
            { state: 'running', fromAt: at(0), toAt: at(10) },
            { state: 'human_wait', fromAt: at(10), toAt: at(15) },
            { state: 'unknown', fromAt: at(15), toAt: at(18) },
            { state: 'untracked', fromAt: at(18), toAt: at(60) },
          ],
        }),
      ],
      [],
      [attachment],
      'worker',
      [],
      NOW,
    )

    expect(line.minutes).toBe(18)
    expect(line.waitMinutes).toBe(5)
    expect(line.unclassifiedMinutes).toBe(3)
  })

  it('counts as assisted what overlaps the worker’s own entries', () => {
    const [line] = agentLines(
      [run()],
      [],
      [attachment],
      'worker',
      [{ fromAt: at(20), toAt: at(50) }],
      NOW,
    )

    expect(line.assistedMinutes).toBe(10)
  })

  it('lists rate changes since the earliest run, with the minutes before each', () => {
    const [line] = agentLines(
      [run()],
      [],
      [
        {
          ...attachment,
          rateChanges: [
            { at: at(-60), fromCents: 600, toCents: 900 },
            { at: at(10), fromCents: 900, toCents: 1200 },
          ],
        },
      ],
      'worker',
      [],
      NOW,
    )

    expect(line.rateChanges).toEqual([
      { at: at(10), fromCents: 900, toCents: 1200, minutesBefore: 10 },
    ])
  })

  it('refuses a run whose agent was never attached', () => {
    expect(() => agentLines([run()], [], [], 'worker', [], NOW)).toThrow(
      'AGENT_NOT_ATTACHED',
    )
  })
})

describe('invoiceAmount', () => {
  it('charges the sum of the lines', () => {
    const lines = [
      humanLine([entry(30)], 60),
      ...agentLines([run()], [], [attachment], 'worker', [], NOW),
    ]

    expect(invoiceAmount(lines)).toBe(3000 + 600)
  })
})
