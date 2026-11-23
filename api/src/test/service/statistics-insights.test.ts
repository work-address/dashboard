import { expect } from 'chai'
import { hiddenHistory } from '@work-address/statistics-core'
import {
  AgentRunInput,
  InsightEntry,
  StatisticsInsights,
} from '@/service/statistics-insights'
import { Span } from '@/service/time-spans'
import { AgentSegment } from '@/model/agent'

const MIN = 60000
// Monday, 19 October 2026, 09:00 UTC.
const nine = Date.UTC(2026, 9, 19, 9)

/** Back-to-back ten-minute slots starting `offset` minutes after nine. */
const slots = (offset: number, count: number): Span[] =>
  Array.from(
    { length: count },
    (_, i): Span => [
      nine + (offset + i * 10) * MIN,
      nine + (offset + i * 10 + 10) * MIN,
    ],
  )

const entry = (span: Span, active: number | null = 420): InsightEntry => ({
  fromAt: new Date(span[0]),
  toAt: new Date(span[1]),
  activeSeconds: active,
  keyboardKeys: active === null ? null : 100,
  mouseKeys: active === null ? null : 20,
})

const segment = (
  state: AgentSegment['state'],
  from: number,
  to: number,
): AgentSegment => ({
  state,
  fromAt: new Date(nine + from * MIN).toISOString(),
  toAt: new Date(nine + to * MIN).toISOString(),
  evidence: 'fixture',
})

/** A run of `agentId`, run by `userId`, working from `from` to `to`. */
const run = (
  userId: string,
  agentId: string,
  from: number,
  to: number,
  fields: Partial<AgentRunInput> = {},
): AgentRunInput => ({
  userId,
  projectId: 'p',
  agentId,
  product: 'claude-code',
  status: 'completed',
  segments: [segment('running', from, to)],
  ...fields,
})

describe('StatisticsInsights', () => {
  it('counts a focus session across a one-slot gap but not the gap', () => {
    // 30 min, a 10 min gap, 20 min: one session of 50 tracked minutes.
    const focus = StatisticsInsights.focusSessions([
      ...slots(0, 3),
      ...slots(40, 2),
    ])
    expect(focus).to.deep.equal({ count: 1, minutes: 50, longestMinutes: 50 })
  })

  it('splits sessions at a longer gap and drops short stretches', () => {
    // 50 min, then 11 min apart, then 40 min: only the first is focus.
    const first = slots(0, 5)
    const second = slots(61, 4)
    const focus = StatisticsInsights.focusSessions([...first, ...second])
    expect(focus).to.deep.equal({ count: 1, minutes: 50, longestMinutes: 50 })
  })

  it('places active time by weekday and hour in the reader timezone', () => {
    const rows = StatisticsInsights.hourly(
      [entry(slots(0, 1)[0]), entry(slots(10, 1)[0], null)],
      'Asia/Tokyo',
    )
    // 09:00 UTC Monday is 18:00 Monday in Tokyo; unmeasured time is tracked
    // but never active.
    expect(rows).to.have.length(1)
    expect(rows[0]).to.include({
      weekday: 1,
      hour: 18,
      activeSeconds: 420,
      trackedSeconds: 1200,
      keyboardKeys: 100,
      days: 1,
    })
  })

  it('breaks an hour down by project and app, busiest first', () => {
    const [first, second, third] = slots(0, 3)
    const rows = StatisticsInsights.hourly(
      [
        {
          ...entry(first),
          projectId: 'a',
          apps: [{ name: 'Code', seconds: 300 }],
        },
        {
          ...entry(second),
          projectId: 'b',
          apps: [{ name: 'Slack', seconds: 60 }],
        },
        {
          ...entry(third),
          projectId: 'b',
          apps: [{ name: 'Code', seconds: 200 }],
        },
      ],
      'UTC',
    )
    expect(rows[0].projects).to.deep.equal([
      { projectId: 'b', seconds: 1200 },
      { projectId: 'a', seconds: 600 },
    ])
    expect(rows[0].apps).to.deep.equal([
      { name: 'Code', seconds: 500 },
      { name: 'Slack', seconds: 60 },
    ])
  })

  it('ranks productive hours across weekdays', () => {
    expect(
      StatisticsInsights.productiveHours([
        { weekday: 1, hour: 9, activeSeconds: 600 },
        { weekday: 2, hour: 9, activeSeconds: 600 },
        { weekday: 1, hour: 14, activeSeconds: 900 },
        { weekday: 3, hour: 7, activeSeconds: 0 },
      ]),
    ).to.deep.equal([9, 14])
  })

  it('compares activity and input with measured time only', () => {
    const me = StatisticsInsights.me(
      [entry(slots(0, 1)[0], 300), entry(slots(10, 1)[0], null)],
      'UTC',
    )
    expect(me.activeRatio).to.equal(0.5)
    // 100 keys and 20 clicks over 5 active minutes.
    expect(me.keysPerActiveHour).to.equal(1200)
    expect(me.clicksPerActiveHour).to.equal(240)
  })

  it('has no ratios for a period with nothing measured', () => {
    const me = StatisticsInsights.me([], 'UTC')
    expect(me.activeRatio).to.equal(null)
    expect(me.keysPerActiveHour).to.equal(null)
    expect(me.focus.count).to.equal(0)
  })

  it('splits running time into assisted and autonomous, wait apart', () => {
    const rows = StatisticsInsights.agentDaily(
      [
        {
          userId: 'u',
          projectId: 'p',
          agentId: 'a',
          product: 'claude-code',
          status: 'completed',
          segments: [
            segment('running', 0, 30),
            segment('human_wait', 30, 40),
            segment('running', 40, 60),
          ],
        },
        // The same agent overlapping itself counts once.
        {
          userId: 'u',
          projectId: 'p',
          agentId: 'a',
          product: 'claude-code',
          status: 'completed',
          segments: [segment('running', 50, 60)],
        },
      ],
      // The worker's own timer ran for the first 20 minutes, and on another
      // project later, which does not assist this one.
      [
        { userId: 'u', projectId: 'p', span: [nine, nine + 20 * MIN] },
        { userId: 'u', projectId: 'q', span: [nine, nine + 60 * MIN] },
      ],
      [nine - 60 * MIN, nine + 120 * MIN],
      'UTC',
    )
    expect(rows).to.deep.equal([
      {
        day: '2026-10-19',
        userId: 'u',
        agentId: 'a',
        product: 'claude-code',
        assistedSeconds: 20 * 60,
        autonomousSeconds: 30 * 60,
        waitSeconds: 10 * 60,
      },
    ])
  })

  it('keeps a row for each worker and agent, even of one product on one day', () => {
    const rows = StatisticsInsights.agentDaily(
      [
        run('u', 'a', 0, 30),
        // The same worker's second agent of the same product, at the same time.
        run('u', 'b', 0, 20),
        // Another worker's agent, and the first agent again on another project.
        run('v', 'c', 0, 10),
        run('u', 'a', 40, 50, { projectId: 'q' }),
      ],
      [],
      [nine - 60 * MIN, nine + 120 * MIN],
      'UTC',
    )
    expect(
      rows.map((row) => [row.userId, row.agentId, row.autonomousSeconds]),
    ).to.deep.equal([
      // One row for an agent's day, whatever projects it worked on.
      ['u', 'a', 40 * 60],
      ['u', 'b', 20 * 60],
      ['v', 'c', 10 * 60],
    ])
    expect(rows.every((row) => row.product === 'claude-code')).to.equal(true)
    // A reader who wants the product's day sums its rows.
    expect(rows.reduce((sum, row) => sum + row.autonomousSeconds, 0)).to.equal(
      70 * 60,
    )
  })

  it('counts each run once, on the reader day it started, by status', () => {
    const at = (minutes: number) => new Date(nine + minutes * MIN)
    const rows = StatisticsInsights.runsDaily(
      [
        { fromAt: at(0), status: 'completed' },
        { fromAt: at(30), status: 'completed' },
        { fromAt: at(60), status: 'failed' },
        // 16:30 UTC on the 19th is 01:30 on the 20th in Tokyo; ISO text too.
        { fromAt: at(450).toISOString(), status: 'completed' },
      ],
      'Asia/Tokyo',
    )
    expect(rows).to.deep.equal([
      { day: '2026-10-19', status: 'completed', count: 2 },
      { day: '2026-10-19', status: 'failed', count: 1 },
      { day: '2026-10-20', status: 'completed', count: 1 },
    ])
    expect(StatisticsInsights.runsDaily([], 'UTC')).to.deep.equal([])
  })

  it('says history is hidden only where a limit falls inside the period', () => {
    const cutOff = Date.UTC(2026, 9, 5)
    const earlier = cutOff - 86400000
    const later = cutOff + 86400000

    // Nothing limited, or a period that starts at or after the limit.
    expect(
      hiddenHistory([{ keptFrom: null, owned: true }], earlier),
    ).to.deep.equal({})
    expect(
      hiddenHistory([{ keptFrom: cutOff, owned: true }], cutOff),
    ).to.deep.equal({})
    expect(
      hiddenHistory([{ keptFrom: cutOff, owned: true }], later),
    ).to.deep.equal({})

    // Someone else's limit: the reader cannot lift it.
    expect(
      hiddenHistory(
        [
          { keptFrom: cutOff, owned: false },
          { keptFrom: null, owned: true },
        ],
        earlier,
      ),
    ).to.deep.equal({
      hiddenBefore: new Date(cutOff).toISOString(),
      canUpgrade: false,
    })

    // The latest limit the period reaches is the one reported, and owning
    // any project that hides history is enough to upgrade.
    expect(
      hiddenHistory(
        [
          { keptFrom: cutOff, owned: true },
          { keptFrom: later, owned: false },
        ],
        earlier,
      ),
    ).to.deep.equal({
      hiddenBefore: new Date(later).toISOString(),
      canUpgrade: true,
    })
    // A limit the period does not reach is not one of them.
    expect(
      hiddenHistory(
        [
          { keptFrom: earlier, owned: true },
          { keptFrom: later, owned: false },
        ],
        cutOff,
      ),
    ).to.deep.equal({
      hiddenBefore: new Date(later).toISOString(),
      canUpgrade: false,
    })
  })

  it('folds people into the project total where the reader only views', () => {
    const rows = StatisticsInsights.dailyByPerson(
      [
        {
          day: '2026-10-19',
          projectId: 'own',
          userId: 'u',
          trackedSeconds: 600,
        },
        {
          day: '2026-10-19',
          projectId: 'own',
          userId: 'v',
          trackedSeconds: 300,
        },
        // The same person twice in a day is one row.
        {
          day: '2026-10-19',
          projectId: 'own',
          userId: 'u',
          trackedSeconds: 0.4,
        },
        {
          day: '2026-10-19',
          projectId: 'seen',
          userId: 'u',
          trackedSeconds: 60,
        },
        {
          day: '2026-10-19',
          projectId: 'seen',
          userId: 'v',
          trackedSeconds: 30,
        },
        {
          day: '2026-10-20',
          projectId: 'seen',
          userId: 'v',
          trackedSeconds: 90,
        },
      ],
      ['seen'],
    )
    expect(rows).to.deep.equal([
      { day: '2026-10-19', projectId: 'own', userId: 'u', trackedSeconds: 600 },
      { day: '2026-10-19', projectId: 'own', userId: 'v', trackedSeconds: 300 },
      // No `userId` key at all: absent, not null.
      { day: '2026-10-19', projectId: 'seen', trackedSeconds: 90 },
      { day: '2026-10-20', projectId: 'seen', trackedSeconds: 90 },
    ])
    expect(StatisticsInsights.dailyByPerson([], [])).to.deep.equal([])
  })

  it("counts an agent's work per day and project, assisted or not, waits apart", () => {
    const rows = StatisticsInsights.agentWorkedDaily(
      [
        {
          ...run('u', 'a', 0, 30),
          segments: [
            segment('running', 0, 30),
            segment('human_wait', 30, 40),
            segment('unknown', 40, 50),
          ],
        },
        // The same agent overlapping itself on the project counts once...
        run('u', 'a', 20, 30),
        // ...and its work on another project is that project's.
        run('u', 'a', 0, 10, { projectId: 'q' }),
        run('v', 'b', 0, 5),
        // Waiting alone is no work, so no row.
        {
          ...run('w', 'c', 0, 10),
          segments: [segment('human_wait', 0, 10)],
        },
      ],
      [nine - 60 * MIN, nine + 120 * MIN],
      'UTC',
    )
    expect(rows).to.deep.equal([
      {
        day: '2026-10-19',
        projectId: 'p',
        userId: 'u',
        agentId: 'a',
        workedSeconds: 40 * 60,
      },
      {
        day: '2026-10-19',
        projectId: 'p',
        userId: 'v',
        agentId: 'b',
        workedSeconds: 5 * 60,
      },
      {
        day: '2026-10-19',
        projectId: 'q',
        userId: 'u',
        agentId: 'a',
        workedSeconds: 10 * 60,
      },
    ])
    // Cut to the range and at the reader's midnight, as the agent report is.
    const cut = StatisticsInsights.agentWorkedDaily(
      [run('u', 'a', 750, 810)],
      [nine - 600 * MIN, nine + 795 * MIN],
      'Etc/GMT-2',
    )
    expect(cut.map((row) => [row.day, row.workedSeconds])).to.deep.equal([
      ['2026-10-19', 30 * 60],
      ['2026-10-20', 15 * 60],
    ])
    // The same seconds the agent report splits into assisted and autonomous.
    const split = StatisticsInsights.agentDaily(
      [run('u', 'a', 0, 30)],
      [{ userId: 'u', projectId: 'p', span: [nine, nine + 20 * MIN] }],
      [nine - 60 * MIN, nine + 120 * MIN],
      'UTC',
    )
    expect(split[0].assistedSeconds + split[0].autonomousSeconds).to.equal(
      StatisticsInsights.agentWorkedDaily(
        [run('u', 'a', 0, 30)],
        [nine - 60 * MIN, nine + 120 * MIN],
        'UTC',
      )[0].workedSeconds,
    )
  })

  it('prices each agent on a project once, at the rate given', () => {
    const row = (
      day: string,
      projectId: string,
      agentId: string,
      workedSeconds: number,
    ) => ({ day, projectId, userId: 'u', agentId, workedSeconds })
    const cents = StatisticsInsights.agentCents(
      [
        // 20 seconds a day at $10/h is 5.6 cents a day: rounded once over the
        // three days it is 17, where rounding each day would make it 18.
        row('2026-10-19', 'p', 'a', 20),
        row('2026-10-20', 'p', 'a', 20),
        row('2026-10-21', 'p', 'a', 20),
        // The same agent on another project has that project's rate.
        row('2026-10-19', 'q', 'a', 3600),
        // An agent with no rate is worth nothing.
        row('2026-10-19', 'p', 'b', 3600),
      ],
      ({ projectId, agentId }) =>
        agentId === 'b' ? 0 : projectId === 'p' ? 1000 : 2500,
    )
    expect(cents).to.equal(17 + 2500)
    expect(StatisticsInsights.agentCents([], () => 1000)).to.equal(0)
  })

  it('counts unclassified time as worked, and never time with the timer off', () => {
    const rows = StatisticsInsights.agentDaily(
      [
        {
          userId: 'u',
          projectId: 'p',
          agentId: 'a',
          product: 'codex',
          status: 'completed',
          segments: [
            segment('unknown', 0, 30),
            segment('untracked', 30, 40),
            segment('unknown', 40, 60),
          ],
        },
      ],
      [{ userId: 'u', projectId: 'p', span: [nine, nine + 20 * MIN] }],
      [nine - 60 * MIN, nine + 120 * MIN],
      'UTC',
    )
    expect(rows).to.deep.equal([
      {
        day: '2026-10-19',
        userId: 'u',
        agentId: 'a',
        product: 'codex',
        assistedSeconds: 20 * 60,
        autonomousSeconds: 30 * 60,
        waitSeconds: 0,
      },
    ])
  })

  it('counts neither waiting nor time with the timer off as worked', () => {
    expect(
      StatisticsInsights.workedSpans([
        segment('running', 0, 10),
        segment('human_wait', 10, 20),
        segment('unknown', 20, 30),
        segment('untracked', 30, 40),
      ]),
    ).to.deep.equal([
      [nine, nine + 10 * MIN],
      [nine + 20 * MIN, nine + 30 * MIN],
    ])
  })

  it('cuts agent time at the reader midnight and the range edges', () => {
    const rows = StatisticsInsights.agentDaily(
      [
        {
          userId: 'u',
          projectId: 'p',
          agentId: 'a',
          product: 'codex',
          status: 'completed',
          // 23:30 to 00:30 in UTC+2 (21:30-22:30 UTC on the 19th).
          segments: [segment('running', 750, 810)],
        },
      ],
      [],
      // The range stops at 00:15 local, cutting the last 15 minutes.
      [nine - 600 * MIN, nine + 795 * MIN],
      'Etc/GMT-2',
    )
    expect(rows.map((row) => [row.day, row.autonomousSeconds])).to.deep.equal([
      ['2026-10-19', 30 * 60],
      ['2026-10-20', 15 * 60],
    ])
  })

  it('cuts agent time at the reader hours, half-hour zones included', () => {
    // 09:00-10:30 UTC is 14:30-16:00 in India (UTC+5:30).
    expect(
      StatisticsInsights.splitByHour([nine, nine + 90 * MIN], 'Asia/Kolkata'),
    ).to.deep.equal([
      ['2026-10-19T14', 30 * MIN],
      ['2026-10-19T15', 60 * MIN],
    ])
    const rows = StatisticsInsights.agentDaily(
      [
        {
          userId: 'u',
          projectId: 'p',
          agentId: 'a',
          product: 'codex',
          status: 'completed',
          segments: [segment('running', 30, 90)],
        },
      ],
      [],
      [nine - 600 * MIN, nine + 600 * MIN],
      'UTC',
      'hour',
    )
    expect(rows.map((row) => [row.day, row.autonomousSeconds])).to.deep.equal([
      ['2026-10-19T09', 30 * 60],
      ['2026-10-19T10', 30 * 60],
    ])
  })
})
