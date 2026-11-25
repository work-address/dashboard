/**
 * What an invoice bills, over the demo's rows and nothing else, so the seed
 * bills by it as the routes do. Which rows are billable and what each line
 * charges are the shared core's, as `InvoiceRepository` calls them on the API.
 */
import {
  agentLines,
  humanLine,
  invoiceAmount,
  invoiceable,
  runBillable,
  type BilledRun,
  type InvoiceLine,
} from '@work-address/statistics-core'

import { agentIdOf } from './shape'
import { attachmentsOn } from './team'

import type { Db, MockProject, MockRun, MockTime } from './db'

/** What an invoice is asked to bill. */
export type BillingAsk =
  /** These entries, and no runs: `InvoiceManager.createFromTimeIds`. */
  | { timeIds: string[] }
  /** The entries inside a period and the runs starting in it: `create`. */
  | { from: number; to: number }
  /** Everything outstanding: `ensureForProject`. */
  | 'all'

/** What an invoice bills, before anything is saved. */
export interface Bill {
  entries: MockTime[]
  runs: MockRun[]
  lines: InvoiceLine[]
  amountCents: number
  fromAt: string
  toAt: string
}

type Rows = Pick<Db, 'times' | 'runs' | 'agents'>

/** A demo run as the core bills it. The demo receives a run as it ends. */
const billedRun = (run: MockRun): BilledRun => ({
  ...run,
  agentId: agentIdOf(run),
  authorId: run.userId,
  receivedAt: run.toAt,
})

const iso = (ms: number) => new Date(ms).toISOString()

/**
 * What the issuer's invoice on a project would bill, or null when nothing is
 * left to bill. Pure over the rows, so the seed bills by it too.
 */
export function billFor(
  rows: Rows,
  project: MockProject,
  issuerId: string,
  ask: BillingAsk,
  now = Date.now(),
): Bill | null {
  const period =
    typeof ask === 'object' && 'from' in ask
      ? { from: ask.from, to: ask.to }
      : undefined
  const chosen =
    typeof ask === 'object' && 'timeIds' in ask ? new Set(ask.timeIds) : null
  const entries = rows.times
    .filter(
      (time) =>
        time.projectId === project.id &&
        (!chosen || chosen.has(time.id)) &&
        invoiceable({ ...time, authorId: time.userId }, issuerId, period),
    )
    .sort((a, b) => a.fromAt.localeCompare(b.fromAt))
  const attachments = attachmentsOn(rows, project)
  const runs = chosen
    ? []
    : rows.runs
        .filter(
          (run) =>
            run.projectId === project.id &&
            runBillable(billedRun(run), issuerId, attachments, { period, now }),
        )
        .sort((a, b) => a.fromAt.localeCompare(b.fromAt))
  if (entries.length === 0 && runs.length === 0) {
    return null
  }
  const lines: InvoiceLine[] = []
  if (entries.length > 0) {
    lines.push(humanLine(entries, Number(project.rateHour || 0)))
  }
  if (runs.length > 0) {
    const from = Math.min(...runs.map((run) => Date.parse(run.fromAt)))
    const to = Math.max(...runs.map((run) => Date.parse(run.toAt)))
    // Assisted time overlaps any of the worker's own entries on the project,
    // invoiced or not.
    const own = rows.times.filter(
      (time) =>
        time.projectId === project.id &&
        time.userId === issuerId &&
        Date.parse(time.toAt) > from &&
        Date.parse(time.fromAt) < to,
    )
    lines.push(
      ...agentLines(
        runs.map(billedRun),
        attachments.map((a) => ({ id: a.agentId, name: a.name })),
        attachments,
        issuerId,
        own,
        now,
      ),
    )
  }
  // A selection spans what it bills, a period is the one asked for, and
  // everything outstanding spans the entries and runs it bills.
  const spans = [...entries, ...runs]
  return {
    entries,
    runs,
    lines,
    amountCents: invoiceAmount(lines),
    fromAt: period
      ? iso(period.from)
      : iso(Math.min(...spans.map((s) => Date.parse(s.fromAt)))),
    toAt: period
      ? iso(period.to)
      : iso(Math.max(...spans.map((s) => Date.parse(s.toAt)))),
  }
}
