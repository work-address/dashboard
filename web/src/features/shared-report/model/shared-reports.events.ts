import { createEvent } from 'effector'

import type { SharedReport } from '@/entities/shared-report'

/** "Create invoice" on a report of the sharer's own time on one project. */
export const invoiceReportRequested = createEvent<SharedReport>()
