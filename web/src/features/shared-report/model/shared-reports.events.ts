import { createEvent } from 'effector'

import type { SharedReport } from '@/entities/shared-report'

/**
 * "Create invoice" on a report of the sharer's own time on one project.
 * `summary` says what will be billed, in the reader's words, for the
 * question asked before the invoice is issued.
 */
export const invoiceReportRequested = createEvent<{
  report: SharedReport
  summary: string
}>()
