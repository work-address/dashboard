/**
 * Invoices through the demo's routes: issuing one over what `billFor` finds,
 * and what paying or rejecting it does to the entries and runs behind it, as
 * `InvoiceManager` and `InvoiceRepository` do on the API.
 */
import { billFor, type BillingAsk } from './bill'
import { DemoHttpError } from './statistics'
import { saveRow } from './store'

import type { Db, MockInvoice, MockProject } from './db'

const fail = (status: number, message: string): never => {
  throw new DemoHttpError(status, message)
}

/**
 * Issues an invoice for the caller's unpaid, uninvoiced time and runs on a
 * project: the entries chosen, those inside a period with the runs starting
 * in it, or everything outstanding - where, with nothing left to bill, the
 * latest invoice stands.
 */
export function issueInvoice(
  db: Db,
  meId: string,
  project: MockProject,
  body: { timeIds?: string[]; fromUnix?: number; toUnix?: number },
): MockInvoice | null {
  const ids = [...new Set(body.timeIds ?? [])]
  const ask: BillingAsk =
    ids.length > 0
      ? { timeIds: ids }
      : body.fromUnix !== undefined && body.toUnix !== undefined
        ? { from: body.fromUnix, to: body.toUnix }
        : 'all'
  if (typeof ask === 'object' && 'from' in ask && ask.from >= ask.to) {
    fail(400, 'The invoice period ends before it starts')
  }
  const bill = billFor(db, project, meId, ask)
  // A selection is billed whole or not at all.
  if (
    typeof ask === 'object' &&
    'timeIds' in ask &&
    bill?.entries.length !== ids.length
  ) {
    fail(
      400,
      'Some of the selected entries are not yours, already paid, or already on an invoice',
    )
  }
  if (!bill) {
    if (ask !== 'all') {
      fail(400, 'There is no unpaid tracked time in that period')
    }
    // Everything outstanding is billed already: the latest stands.
    return (
      db.invoices
        .filter((i) => i.projectId === project.id && i.userId === meId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    )
  }
  const now = new Date().toISOString()
  const invoice = saveRow('invoices', {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    projectId: project.id,
    userId: meId,
    fromAt: bill.fromAt,
    toAt: bill.toAt,
    amountCents: bill.amountCents,
    lines: bill.lines,
    state: 'Requested',
    rejectionReason: null,
    rejectedAt: null,
    paidAt: null,
    timeIds: bill.entries.map((t) => t.id),
  } satisfies MockInvoice)
  // Billing publishes an entry's detail, and freezes a run.
  for (const time of bill.entries) {
    saveRow('times', { ...time, invoiceId: invoice.id, publishedAt: now })
  }
  for (const run of bill.runs) {
    saveRow('runs', { ...run, invoiceId: invoice.id })
  }
  return invoice
}

/**
 * Pays, un-pays or rejects an invoice. Its entries and runs follow: paid with
 * it, and released by a rejection, which keeps the lines it charged.
 */
export function setInvoiceState(
  db: Db,
  invoice: MockInvoice,
  state: MockInvoice['state'],
  reason?: string,
) {
  const now = new Date().toISOString()
  const rejected = state === 'REJECTED'
  const next: MockInvoice = {
    ...invoice,
    state,
    updatedAt: now,
    paidAt: state === 'PAID' ? (invoice.paidAt ?? now) : null,
    rejectedAt: rejected ? now : null,
    rejectionReason: rejected ? reason?.trim() || null : null,
    timeIds: rejected ? [] : invoice.timeIds,
  }
  for (const time of db.times.filter((t) => invoice.timeIds.includes(t.id))) {
    saveRow('times', {
      ...time,
      isPaid: state === 'PAID',
      invoiceId: rejected ? null : invoice.id,
    })
  }
  for (const run of db.runs.filter((r) => r.invoiceId === invoice.id)) {
    saveRow('runs', {
      ...run,
      isPaid: state === 'PAID',
      invoiceId: rejected ? null : invoice.id,
    })
  }
  return saveRow('invoices', next)
}
