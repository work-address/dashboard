import { TimeSpans, type Span } from './time-spans.js'
import { nextMidnight, zonedParts } from './zoned.js'

/** The part of an agent run's timeline the statistics read. */
export interface AgentSegment {
  fromAt: string
  toAt: string
  state: 'running' | 'human_wait' | 'unknown' | 'untracked'
}

/** Gaps a focus session tolerates: one tracker slot. */
export const FOCUS_GAP_MS = 10 * 60000
/** Tracked time a stretch needs before it counts as focus. */
export const FOCUS_MIN_MS = 45 * 60000

export interface InsightEntry {
  fromAt: Date
  toAt: Date
  /** Null where activity was not measured: manual and web time. */
  activeSeconds: number | null
  keyboardKeys: number | null
  mouseKeys: number | null
  /** For the hour's breakdown; left out where a caller has no use for it. */
  projectId?: string
  apps?: { name: string; seconds: number }[]
}

export interface HourlyRow {
  /** ISO weekday: 1 is Monday. */
  weekday: number
  hour: number
  activeSeconds: number
  /** All time started in the hour, manual included. */
  trackedSeconds: number
  keyboardKeys: number
  mouseKeys: number
  /** How many different days had time in this weekday's hour. */
  days: number
  /** The hour's busiest projects and apps, most time first. */
  projects: { projectId: string; seconds: number }[]
  apps: { name: string; seconds: number }[]
}

/** How many projects and apps an hour's breakdown names. */
export const HOURLY_TOP = 3

const top = <K extends string>(totals: Map<string, number>, key: K) =>
  [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, HOURLY_TOP)
    .map(
      ([id, seconds]) =>
        ({ [key]: id, seconds: Math.round(seconds) }) as Record<K, string> & {
          seconds: number
        },
    )

export interface AgentRunInput {
  userId: string
  projectId: string
  agentId: string
  product: string
  status: string
  segments: AgentSegment[]
}

/** How finely time is cut: by the reader's day, or by their hour. */
export type StatisticsBucket = 'day' | 'hour'

/** One agent's time in one of the reader's days, or hours. */
export interface AgentDailyRow {
  /** `YYYY-MM-DD`, or `YYYY-MM-DDTHH` when cut by hour. */
  day: string
  /** The worker who runs the agent. */
  userId: string
  agentId: string
  product: string
  assistedSeconds: number
  autonomousSeconds: number
  waitSeconds: number
}

/** How many runs started on one of the reader's days and ended one way. */
export interface AgentRunsDailyRow {
  /** `YYYY-MM-DD`, whatever the bucket. */
  day: string
  status: string
  count: number
}

/** Tracked time on one project on one of the reader's days. */
export interface PersonDailyRow {
  /** `YYYY-MM-DD` */
  day: string
  projectId: string
  /** Whose time it is; absent where the reader may not see that split. */
  userId?: string
  trackedSeconds: number
}

/** One agent's working time on one project on one of the reader's days. */
export interface AgentWorkedRow {
  /** `YYYY-MM-DD` */
  day: string
  projectId: string
  /** The worker who runs the agent. */
  userId: string
  agentId: string
  /** Assisted and autonomous together; waiting on a person is not work. */
  workedSeconds: number
}

/**
 * Pure figures behind the dashboard's insights. Kept apart from the queries
 * so the rules - what counts as focus, what counts as assisted - are tested
 * on their own.
 */
export class StatisticsInsights {
  /**
   * Stretches of tracked time where no gap is longer than one slot, at least
   * 45 tracked minutes long. Gaps are tolerated but never counted.
   */
  public static focusSessions(
    entries: Span[],
    gapMs = FOCUS_GAP_MS,
    minMs = FOCUS_MIN_MS,
  ) {
    const spans = TimeSpans.union(entries)
    const sessions: number[] = []
    let tracked = 0
    let lastEnd: number | null = null
    for (const [start, end] of spans) {
      if (lastEnd !== null && start - lastEnd > gapMs) {
        sessions.push(tracked)
        tracked = 0
      }
      tracked += end - start
      lastEnd = end
    }
    if (lastEnd !== null) sessions.push(tracked)
    const focus = sessions.filter((ms) => ms >= minMs)
    return {
      count: focus.length,
      minutes: Math.round(focus.reduce((a, b) => a + b, 0) / 60000),
      longestMinutes: Math.round(Math.max(0, ...focus) / 60000),
    }
  }

  /**
   * Time by weekday and hour, in the reader's timezone: active and tracked
   * time, input, how many days it was worked, and what was worked on.
   */
  public static hourly(entries: InsightEntry[], timeZone: string): HourlyRow[] {
    type Cell = HourlyRow & {
      dayKeys: Set<string>
      projectTotals: Map<string, number>
      appTotals: Map<string, number>
    }
    const cells = new Map<string, Cell>()
    for (const entry of entries) {
      // An entry is one slot; its start places it.
      const { weekday, hour, day } = zonedParts(entry.fromAt, timeZone)
      const key = `${weekday}:${hour}`
      const cell: Cell = cells.get(key) ?? {
        weekday,
        hour,
        activeSeconds: 0,
        trackedSeconds: 0,
        keyboardKeys: 0,
        mouseKeys: 0,
        days: 0,
        projects: [],
        apps: [],
        dayKeys: new Set(),
        projectTotals: new Map(),
        appTotals: new Map(),
      }
      const seconds = Math.max(0, (+entry.toAt - +entry.fromAt) / 1000)
      cell.activeSeconds += entry.activeSeconds ?? 0
      cell.trackedSeconds += seconds
      cell.keyboardKeys += entry.keyboardKeys ?? 0
      cell.mouseKeys += entry.mouseKeys ?? 0
      cell.dayKeys.add(day)
      if (entry.projectId)
        cell.projectTotals.set(
          entry.projectId,
          (cell.projectTotals.get(entry.projectId) ?? 0) + seconds,
        )
      for (const app of entry.apps ?? [])
        cell.appTotals.set(
          app.name,
          (cell.appTotals.get(app.name) ?? 0) + app.seconds,
        )
      cells.set(key, cell)
    }
    return [...cells.values()]
      .map(({ dayKeys, projectTotals, appTotals, ...cell }) => ({
        ...cell,
        trackedSeconds: Math.round(cell.trackedSeconds),
        days: dayKeys.size,
        projects: top(projectTotals, 'projectId'),
        apps: top(appTotals, 'name'),
      }))
      .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour)
  }

  /** The hours of the day with the most active time, best first. */
  public static productiveHours(
    rows: Pick<HourlyRow, 'weekday' | 'hour' | 'activeSeconds'>[],
    limit = 3,
  ): number[] {
    const byHour = new Map<number, number>()
    for (const row of rows)
      byHour.set(row.hour, (byHour.get(row.hour) ?? 0) + row.activeSeconds)
    return [...byHour]
      .filter(([, seconds]) => seconds > 0)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, limit)
      .map(([hour]) => hour)
  }

  public static me(entries: InsightEntry[], timeZone: string) {
    const measured = entries.filter((entry) => entry.activeSeconds !== null)
    const trackedMs = TimeSpans.ms(
      measured.map((e): Span => [+e.fromAt, +e.toAt]),
    )
    const activeSeconds = measured.reduce(
      (sum, e) => sum + (e.activeSeconds ?? 0),
      0,
    )
    const activeHours = activeSeconds / 3600
    const perActiveHour = (key: 'keyboardKeys' | 'mouseKeys') =>
      activeHours > 0
        ? Math.round(
            measured.reduce((sum, e) => sum + (e[key] ?? 0), 0) / activeHours,
          )
        : null
    return {
      focus: this.focusSessions(entries.map((e): Span => [+e.fromAt, +e.toAt])),
      productiveHours: this.productiveHours(this.hourly(entries, timeZone)),
      // Only measured time: manual entries have no activity to compare.
      activeRatio: trackedMs > 0 ? activeSeconds / (trackedMs / 1000) : null,
      keysPerActiveHour: perActiveHour('keyboardKeys'),
      clicksPerActiveHour: perActiveHour('mouseKeys'),
    }
  }

  /**
   * When an agent worked, as every statistic counts it. Unclassified time is
   * worked time, as it is on the invoice: until a runtime is qualified, it is
   * the only state a recorded run has. Waiting on a person is reported apart,
   * and time with the timer off counts for nothing.
   */
  public static workedSpans(
    segments: Pick<AgentSegment, 'fromAt' | 'toAt' | 'state'>[],
  ): Span[] {
    return segments
      .filter(({ state }) => state === 'running' || state === 'unknown')
      .map((s): Span => [Date.parse(s.fromAt), Date.parse(s.toAt)])
  }

  /**
   * Agent time per day, worker and agent: one row for each, so a reader sums
   * the rows of a day to get its product or its total. Worked time is
   * assisted where the same worker's own timer ran on the same project,
   * autonomous otherwise. `human_wait` is reported apart and never counts as
   * agent time. Each agent's runs are merged first, so overlapping runs of
   * one agent count once - the same rule its invoice lines follow.
   */
  public static agentDaily(
    runs: AgentRunInput[],
    human: { userId: string; projectId: string; span: Span }[],
    range: Span,
    timeZone: string,
    bucket: StatisticsBucket = 'day',
  ): AgentDailyRow[] {
    const humanBy = new Map<string, Span[]>()
    for (const entry of human) {
      const key = `${entry.userId}:${entry.projectId}`
      humanBy.set(key, [...(humanBy.get(key) ?? []), entry.span])
    }
    const groups = new Map<string, AgentRunInput[]>()
    for (const run of runs) {
      const key = `${run.userId}:${run.projectId}:${run.agentId}:${run.product}`
      groups.set(key, [...(groups.get(key) ?? []), run])
    }
    const rows = new Map<string, AgentDailyRow>()
    const add = (
      spans: Span[],
      agent: Pick<AgentRunInput, 'userId' | 'agentId' | 'product'>,
      field: 'assistedSeconds' | 'autonomousSeconds' | 'waitSeconds',
    ) => {
      const { userId, agentId, product } = agent
      for (const span of spans)
        for (const [day, ms] of bucket === 'hour'
          ? this.splitByHour(span, timeZone)
          : this.splitByDay(span, timeZone)) {
          // An agent's time on several projects is one row a day.
          const key = JSON.stringify([day, userId, agentId, product])
          const row = rows.get(key) ?? {
            day,
            userId,
            agentId,
            product,
            assistedSeconds: 0,
            autonomousSeconds: 0,
            waitSeconds: 0,
          }
          row[field] += ms / 1000
          rows.set(key, row)
        }
    }
    for (const group of groups.values()) {
      const { userId, projectId } = group[0]
      const state = (name: AgentSegment['state']) =>
        TimeSpans.intersect(
          TimeSpans.union(
            group.flatMap((run) =>
              run.segments
                .filter((segment) => segment.state === name)
                .map((s): Span => [Date.parse(s.fromAt), Date.parse(s.toAt)]),
            ),
          ),
          [range],
        )
      const worked = TimeSpans.intersect(
        TimeSpans.union(group.flatMap((run) => this.workedSpans(run.segments))),
        [range],
      )
      const own = TimeSpans.union(humanBy.get(`${userId}:${projectId}`) ?? [])
      const assisted = TimeSpans.intersect(worked, own)
      add(assisted, group[0], 'assistedSeconds')
      add(TimeSpans.subtract(worked, assisted), group[0], 'autonomousSeconds')
      add(
        TimeSpans.subtract(state('human_wait'), worked),
        group[0],
        'waitSeconds',
      )
    }
    return [...rows.values()]
      .map((row) => ({
        ...row,
        assistedSeconds: Math.round(row.assistedSeconds),
        autonomousSeconds: Math.round(row.autonomousSeconds),
        waitSeconds: Math.round(row.waitSeconds),
      }))
      .sort(
        (a, b) =>
          a.day.localeCompare(b.day) ||
          a.product.localeCompare(b.product) ||
          a.userId.localeCompare(b.userId) ||
          a.agentId.localeCompare(b.agentId),
      )
  }

  /**
   * Runs per day and status. A run counts once, whole, on the reader's day it
   * started - the rule entries follow - so the counts add up to the runs
   * given, and a run that began before the period is counted on that earlier
   * day. Always by day: a run has one start, whatever the time is cut by.
   */
  public static runsDaily(
    runs: { fromAt: Date | string; status: string }[],
    timeZone: string,
  ): AgentRunsDailyRow[] {
    const rows = new Map<string, AgentRunsDailyRow>()
    for (const run of runs) {
      const { day } = zonedParts(new Date(run.fromAt), timeZone)
      const key = JSON.stringify([day, run.status])
      const row = rows.get(key) ?? { day, status: run.status, count: 0 }
      row.count++
      rows.set(key, row)
    }
    return [...rows.values()].sort(
      (a, b) => a.day.localeCompare(b.day) || a.status.localeCompare(b.status),
    )
  }

  /**
   * Tracked time per day, project and person, as a reader may see it: the
   * time given is what they may count, and on a project they only view the
   * people are folded into the project's total (SPEC.md, "Who can see what").
   */
  public static dailyByPerson(
    rows: {
      day: string
      projectId: string
      userId: string
      trackedSeconds: number
    }[],
    viewed: Iterable<string>,
  ): PersonDailyRow[] {
    const totalsOnly = new Set(viewed)
    const out = new Map<string, PersonDailyRow>()
    for (const { day, projectId, userId, trackedSeconds } of rows) {
      const person = totalsOnly.has(projectId) ? undefined : userId
      const key = JSON.stringify([day, projectId, person ?? null])
      const row = out.get(key) ?? {
        day,
        projectId,
        ...(person === undefined ? {} : { userId: person }),
        trackedSeconds: 0,
      }
      row.trackedSeconds += trackedSeconds
      out.set(key, row)
    }
    return [...out.values()]
      .map((row) => ({
        ...row,
        trackedSeconds: Math.round(row.trackedSeconds),
      }))
      .sort(
        (a, b) =>
          a.day.localeCompare(b.day) ||
          a.projectId.localeCompare(b.projectId) ||
          (a.userId ?? '').localeCompare(b.userId ?? ''),
      )
  }

  /**
   * Each agent's working time per day and project: what `agentDaily` calls
   * assisted and autonomous, together, cut to the range and at the reader's
   * midnights the same way, with an agent's overlapping runs on a project
   * counted once.
   */
  public static agentWorkedDaily(
    runs: AgentRunInput[],
    range: Span,
    timeZone: string,
  ): AgentWorkedRow[] {
    const byProject = new Map<string, AgentRunInput[]>()
    for (const run of runs)
      byProject.set(run.projectId, [
        ...(byProject.get(run.projectId) ?? []),
        run,
      ])
    const out = new Map<string, AgentWorkedRow>()
    for (const [projectId, projectRuns] of byProject)
      for (const row of this.agentDaily(projectRuns, [], range, timeZone)) {
        const key = JSON.stringify([
          row.day,
          projectId,
          row.userId,
          row.agentId,
        ])
        const worked = out.get(key) ?? {
          day: row.day,
          projectId,
          userId: row.userId,
          agentId: row.agentId,
          workedSeconds: 0,
        }
        worked.workedSeconds += row.assistedSeconds + row.autonomousSeconds
        out.set(key, worked)
      }
    return [...out.values()]
      .filter((row) => row.workedSeconds > 0)
      .sort(
        (a, b) =>
          a.day.localeCompare(b.day) ||
          a.projectId.localeCompare(b.projectId) ||
          a.userId.localeCompare(b.userId) ||
          a.agentId.localeCompare(b.agentId),
      )
  }

  /**
   * What agents' working time is worth at the rates given, in cents an hour:
   * each agent's time on a project priced and rounded once, like an invoice's
   * own agent line.
   */
  public static agentCents(
    rows: AgentWorkedRow[],
    rateHourCents: (
      agent: Pick<AgentWorkedRow, 'projectId' | 'userId' | 'agentId'>,
    ) => number,
  ): number {
    const worked = new Map<
      string,
      Pick<AgentWorkedRow, 'projectId' | 'userId' | 'agentId'> & {
        seconds: number
      }
    >()
    for (const { projectId, userId, agentId, workedSeconds } of rows) {
      const key = JSON.stringify([projectId, userId, agentId])
      const agent = worked.get(key) ?? {
        projectId,
        userId,
        agentId,
        seconds: 0,
      }
      agent.seconds += workedSeconds
      worked.set(key, agent)
    }
    return [...worked.values()].reduce(
      (cents, agent) =>
        cents + Math.round((agent.seconds * rateHourCents(agent)) / 3600),
      0,
    )
  }

  /** A span cut at the reader's hours, as [`YYYY-MM-DDTHH`, milliseconds] pairs. */
  public static splitByHour(span: Span, timeZone: string): [string, number][] {
    const out: [string, number][] = []
    let cursor = span[0]
    while (cursor < span[1]) {
      const { day, hour, minute, second } = zonedParts(cursor, timeZone)
      const elapsed = (minute * 60 + second) * 1000 + (cursor % 1000)
      const next = Math.min(span[1], cursor - elapsed + 3600_000)
      out.push([`${day}T${String(hour).padStart(2, '0')}`, next - cursor])
      cursor = next
    }
    return out
  }

  /** A span cut at the reader's midnights, as [day, milliseconds] pairs. */
  public static splitByDay(span: Span, timeZone: string): [string, number][] {
    const out: [string, number][] = []
    let cursor = span[0]
    while (cursor < span[1]) {
      const next = Math.min(span[1], nextMidnight(cursor, timeZone))
      out.push([zonedParts(cursor, timeZone).day, next - cursor])
      cursor = next
    }
    return out
  }
}
