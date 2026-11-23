import { ownerPremium } from './shape'

import type { Db, MockRun, MockTime } from './db'

/** How long a free owner's projects keep entries and runs. */
export const FREE_RETENTION_MS = 14 * 86_400_000

/**
 * Hides what the demo's projects no longer keep, on the API's terms
 * (`KeptHistory.settle`): entries and runs that started before a free owner's
 * limit leave the lists every route reads, except what an invoice covers.
 * They are set aside, not dropped, so a visitor who switches the demo to
 * Premium gets them back, as an upgrade does. Called before every request.
 */
export function settleHistory(db: Db, now = Date.now()): void {
  const limited = new Set(
    db.projects
      .filter((project) => !ownerPremium(db, project))
      .map((project) => project.id),
  )
  const keptFrom = now - FREE_RETENTION_MS
  const past = (row: Pick<MockTime | MockRun, 'projectId' | 'fromAt'>) =>
    limited.has(row.projectId) && Date.parse(row.fromAt) < keptFrom
  const settle = <Row extends MockTime | MockRun>(
    shown: Row[],
    hidden: Row[],
  ): [Row[], Row[]] => {
    const all = [...shown, ...hidden]
    const hides = (row: Row) => past(row) && !row.invoiceId

    return [all.filter((row) => !hides(row)), all.filter(hides)]
  }

  ;[db.times, db.hidden.times] = settle(db.times, db.hidden.times)
  ;[db.runs, db.hidden.runs] = settle(db.runs, db.hidden.runs)
}
