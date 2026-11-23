import {
  attach,
  combine,
  createEffect,
  createEvent,
  createStore,
  sample,
} from 'effector'

import { getReportUrl, type ReportDraft } from './share-report'
import { invoiceReportRequested } from './shared-reports.events'

import {
  deleteSharedReportMutation,
  invoiceSharedReportMutation,
  shareReportMutation,
  sharedReportsQuery,
  type SharedReport,
} from '@/entities/shared-report'
import { routes } from '@/routes'
import {
  confirmFx,
  copyToClipboard,
  getErrorMessage,
  navigateFx,
  showToastFx,
  translate,
} from '@/shared'

/** A page opens the dialog with what its filters describe. */
export const shareReportOpened = createEvent<ReportDraft>()
export const shareReportClosed = createEvent()
export const shareReportSubmitted = createEvent<{
  title: string
  showAmounts: boolean
}>()
export const reportLinkCopyRequested = createEvent<string>()
export const sharedReportsRequested = createEvent()
export const sharedReportDeleteRequested = createEvent<SharedReport>()

export const $shareReportDraft = createStore<ReportDraft | null>(null)
  .on(shareReportOpened, (_, draft) => draft)
  .reset(shareReportClosed)

/** The report just shared, while the dialog still shows its link. */
export const $sharedReport = createStore<SharedReport | null>(null)
  .on(shareReportMutation.finished.success, (_, { result }) => result)
  .reset(shareReportOpened, shareReportClosed)

export const $shareReportPending = shareReportMutation.$pending

/**
 * Amounts were asked for and the server left them off: the sharer only views
 * one of the report's projects, and a viewer never shares money.
 */
const $amountsAsked = createStore(false)
  .on(shareReportSubmitted, (_, { showAmounts }) => showAmounts)
  .reset(shareReportOpened, shareReportClosed)

export const $shareAmountsDropped = combine(
  $sharedReport,
  $amountsAsked,
  (report, asked) => report !== null && asked && !report.showAmounts,
)

/** Why the last attempt shared nothing, in the server's words. */
export const $shareReportError = createStore<string | null>(null)
  .on(shareReportMutation.finished.failure, (_, { error }) =>
    getErrorMessage(error, translate('reports.share.failed')),
  )
  .reset(shareReportOpened, shareReportClosed, shareReportSubmitted)

sample({
  clock: shareReportSubmitted,
  source: $shareReportDraft,
  filter: (draft): draft is ReportDraft => draft !== null,
  fn: (draft, { title, showAmounts }) => ({
    ...(draft as ReportDraft),
    ...(title.trim() ? { title: title.trim() } : {}),
    showAmounts,
  }),
  target: shareReportMutation.start,
})

const copyReportLinkFx = createEffect((token: string) =>
  copyToClipboard(getReportUrl(window.location.origin, token)),
)

sample({ clock: reportLinkCopyRequested, target: copyReportLinkFx })

sample({
  clock: copyReportLinkFx.done,
  fn: () => ({ type: 'info' as const, messageKey: 'reports.linkCopied' }),
  target: showToastFx,
})

sample({
  clock: copyReportLinkFx.fail,
  fn: () => ({ type: 'error' as const, messageKey: 'reports.linkCopyFailed' }),
  target: showToastFx,
})

sample({ clock: sharedReportsRequested, target: sharedReportsQuery.start })

// A new report belongs in the list the next time it is read.
sample({
  clock: [
    shareReportMutation.finished.success,
    deleteSharedReportMutation.finished.success,
    invoiceSharedReportMutation.finished.success,
  ],
  target: sharedReportsQuery.refresh,
})

const confirmDeleteFx = attach({
  effect: confirmFx,
  // The report rides along as the effect's params, for what follows it.
  mapParams: (_report: SharedReport) => ({
    title: translate('reports.delete.title'),
    description: translate('reports.delete.description'),
    confirmLabel: translate('reports.delete.confirm'),
    cancelLabel: translate('common.cancel'),
  }),
})

sample({ clock: sharedReportDeleteRequested, target: confirmDeleteFx })

sample({
  clock: confirmDeleteFx.done,
  fn: ({ params }) => params.id,
  target: deleteSharedReportMutation.start,
})

sample({
  clock: deleteSharedReportMutation.finished.success,
  fn: () => ({ type: 'info' as const, messageKey: 'reports.delete.done' }),
  target: showToastFx,
})

// Issuing an invoice locks the hours it bills, so one click only asks.
const confirmInvoiceFx = attach({
  effect: confirmFx,
  mapParams: ({ summary }: { report: SharedReport; summary: string }) => ({
    title: translate('reports.invoiceConfirm.title'),
    description: summary,
    confirmLabel: translate('reports.createInvoice'),
    cancelLabel: translate('common.cancel'),
    tone: 'primary' as const,
  }),
})

sample({ clock: invoiceReportRequested, target: confirmInvoiceFx })

sample({
  clock: confirmInvoiceFx.done,
  fn: ({ params }) => params.report.id,
  target: invoiceSharedReportMutation.start,
})

// The new invoice opens, as it does from every other way of making one.
sample({
  clock: invoiceSharedReportMutation.finished.success,
  fn: ({ result }) => ({ to: routes.invoice.build({ id: result.id }) }),
  target: navigateFx,
})
