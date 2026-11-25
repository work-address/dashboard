/**
 * What an Invoice charges, written once for the API and the demo's mock: one
 * line for the issuer's own entries and one per agent for its runs, frozen
 * when the invoice is raised. The amount is the sum of the lines.
 */
import { TimeSpans, type Span } from './time-spans.js'
import type { Instant } from './entry-rules.js'

const ms = (at: Instant): number =>
  typeof at === 'number' ? at : new Date(at).getTime()

/** One line of an invoice, as both store and answer it. */
export interface InvoiceLine {
  kind: 'human' | 'agent'
  agentId?: string
  name: string
  basis: 'tracked' | 'active'
  minutes: number
  activeMinutes?: number
  manualMinutes?: number
  /** Phone time: tracked, billed as the desktop's is, never manual. */
  mobileMinutes?: number
  assistedMinutes?: number
  waitMinutes?: number
  unclassifiedMinutes?: number
  rateHourCents: number | null
  amountCents: number
  rateChanges: {
    at: string
    fromCents: number
    toCents: number
    minutesBefore: number
  }[]
}

/**
 * Wall-clock minutes a set of entries covers, taken from each row's own span
 * so entries recorded under different tracker intervals total correctly
 * together. A backwards entry counts as nothing.
 */
export const spanMinutes = (
  entries: readonly { fromAt: Instant; toAt: Instant }[],
): number =>
  entries.reduce(
    (total, entry) =>
      total + Math.max(0, (ms(entry.toAt) - ms(entry.fromAt)) / 60_000),
    0,
  )

/** What the human line reads of an entry. */
export interface BilledEntry {
  fromAt: Instant
  toAt: Instant
  source: 'desktop' | 'mobile' | 'manual' | 'web' | string | null | undefined
  minutesActive?: number | null
}

/** The line for the issuer's own entries, at the project's rate per hour. */
export function humanLine(
  entries: readonly BilledEntry[],
  rateHour: number,
): InvoiceLine {
  const minutes = spanMinutes(entries)
  const rateHourCents = Math.round(rateHour * 100)
  const from = (...sources: string[]) =>
    entries.filter((entry) => sources.includes(entry.source ?? ''))
  const mobileMinutes = spanMinutes(from('mobile'))

  return {
    kind: 'human',
    name: 'Human time',
    basis: 'tracked',
    minutes,
    // Minutes with input, so the desktop's alone: a phone captures none.
    activeMinutes: from('desktop').reduce(
      (sum, entry) =>
        sum + Math.min(spanMinutes([entry]), entry.minutesActive || 0),
      0,
    ),
    manualMinutes: spanMinutes(from('manual', 'web')),
    // Tracked time, billed as the desktop's is, and never manual.
    ...(mobileMinutes ? { mobileMinutes } : {}),
    rateHourCents,
    // Rounded once, at the end: rounding per entry accumulates a cent of
    // drift for every row on a long invoice.
    amountCents: Math.round((minutes * rateHourCents) / 60),
    rateChanges: [],
  }
}

/** A stretch of an agent run, as its collector classified it. */
export interface RunSegment {
  fromAt: string
  toAt: string
  state: 'running' | 'human_wait' | 'unknown' | 'untracked'
}

/** What billing reads of an agent run. */
export interface BilledRun {
  agentId: string
  /** The issuer. */
  authorId: string
  product: string
  fromAt: Instant
  segments: readonly RunSegment[]
  status: string
  /** When the last of its events arrived: the API's `updatedAt`. */
  receivedAt: Instant
  /** Whether its adapter observes it continuously, so silence ends it. */
  liveness?: boolean | null
  invoiceId?: string | null
  isPaid?: boolean | null
}

/** A worker's agent on a project, with its rate. */
export interface RunAttachment {
  agentId: string
  workerId: string
  rateHourCents: number
  rateChanges: readonly { at: string; fromCents: number; toCents: number }[]
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

/** How long a terminal run must stay unchanged before it is finished. */
export const RUN_SETTLE_MS = 60_000
/** How long a continuously observed run may go silent before it is finished. */
export const RUN_STALE_MS = 90_000

/**
 * Finished: terminal and unchanged for the grace, or stale, meaning a run the
 * adapter observes continuously has had no evidence for a while. Both are
 * measured from receipt, not source time: a backlog can arrive hours late.
 */
export function runFinished(
  run: Pick<BilledRun, 'status' | 'receivedAt' | 'liveness'>,
  now: number = Date.now(),
): boolean {
  const received = ms(run.receivedAt)

  return (
    (TERMINAL.has(run.status) && received <= now - RUN_SETTLE_MS) ||
    (Boolean(run.liveness) && received <= now - RUN_STALE_MS)
  )
}

/** The attachment a run bills by, if its agent was ever attached. */
export const attachmentOf = <A extends RunAttachment>(
  attachments: readonly A[],
  workerId: string,
  agentId: string,
): A | undefined =>
  attachments.find(
    (attachment) =>
      attachment.agentId === agentId && attachment.workerId === workerId,
  )

/**
 * Whether an issuer may bill this run now: their own, finished, on no invoice,
 * not paid, and its agent attached to the project, now or before. A detached
 * agent's past runs stay billable at its last rate; what was never attached
 * bills nothing. With a period, only a run starting inside it.
 */
export function runBillable(
  run: BilledRun,
  issuerId: string,
  attachments: readonly RunAttachment[],
  options: { period?: { from: Instant; to: Instant }; now?: number } = {},
): boolean {
  const { period, now = Date.now() } = options

  return (
    run.authorId === issuerId &&
    !run.invoiceId &&
    !run.isPaid &&
    runFinished(run, now) &&
    attachmentOf(attachments, issuerId, run.agentId) !== undefined &&
    (!period ||
      (ms(run.fromAt) >= ms(period.from) && ms(run.fromAt) < ms(period.to)))
  )
}

/**
 * One line per agent: the union of its billable segments across runs, so
 * overlapping runs of one agent bill once. `untracked` (timer off) counts
 * toward nothing. Priced once per line at the attachment's current rate.
 * Assisted time is what overlaps the worker's own entries, `human`.
 */
export function agentLines(
  runs: readonly Omit<BilledRun, 'status' | 'receivedAt' | 'authorId'>[],
  agents: readonly { id: string; name: string }[],
  attachments: readonly RunAttachment[],
  workerId: string,
  human: readonly { fromAt: Instant; toAt: Instant }[],
  createdAt: Instant,
): InvoiceLine[] {
  const own = TimeSpans.union(
    human.map((t): Span => [ms(t.fromAt), ms(t.toAt)]),
  )
  const byAgent = new Map<string, (typeof runs)[number][]>()
  for (const run of runs)
    byAgent.set(run.agentId, [...(byAgent.get(run.agentId) ?? []), run])

  return [...byAgent].map(([agentId, agentRuns]): InvoiceLine => {
    const attachment = attachmentOf(attachments, workerId, agentId)
    if (!attachment) throw new Error('AGENT_NOT_ATTACHED')
    const state = (name: RunSegment['state']) =>
      TimeSpans.union(
        agentRuns.flatMap((run) =>
          run.segments
            .filter((segment) => segment.state === name)
            .map((s): Span => [ms(s.fromAt), ms(s.toAt)]),
        ),
      )
    const running = state('running')
    const wait = state('human_wait')
    const unknown = state('unknown')
    const billed = TimeSpans.union([...running, ...wait, ...unknown])
    const minutes = TimeSpans.minutes(billed)
    const earliest = Math.min(...agentRuns.map((run) => ms(run.fromAt)))
    const rateHourCents = attachment.rateHourCents

    return {
      kind: 'agent',
      agentId,
      name:
        agents.find((agent) => agent.id === agentId)?.name ??
        agentRuns[0].product,
      basis: 'active',
      minutes,
      assistedMinutes: TimeSpans.minutes(TimeSpans.intersect(billed, own)),
      waitMinutes: TimeSpans.minutes(
        TimeSpans.subtract(wait, TimeSpans.union([...running, ...unknown])),
      ),
      unclassifiedMinutes: TimeSpans.minutes(
        TimeSpans.subtract(unknown, TimeSpans.union([...running, ...wait])),
      ),
      rateHourCents,
      amountCents: Math.round((minutes * rateHourCents) / 60),
      rateChanges: attachment.rateChanges
        .filter(
          (change) =>
            Date.parse(change.at) >= earliest &&
            Date.parse(change.at) <= ms(createdAt),
        )
        .map((change) => ({
          at: change.at,
          fromCents: change.fromCents,
          toCents: change.toCents,
          minutesBefore: TimeSpans.minutes(
            TimeSpans.intersect(billed, [[0, Date.parse(change.at)]]),
          ),
        })),
    }
  })
}

/** What an invoice charges: the sum of its lines. */
export const invoiceAmount = (lines: readonly InvoiceLine[]): number =>
  lines.reduce((sum, line) => sum + line.amountCents, 0)
