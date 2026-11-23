import { concurrency, createMutation, createQuery } from '@farfetched/core'
import { AxiosError } from 'axios'

import type {
  PublicReport,
  PublicReportGone,
  SharedReport,
  SharedReportCreate,
} from './types'

import { apiClient, runApi, runApiData } from '@/shared'

const json = { 'Content-Type': 'application/json' }
const bearer = [{ scheme: 'bearer' as const, type: 'http' as const }]

/** The reader's own shared reports, newest first. */
export const sharedReportsQuery = createQuery({
  handler: async (): Promise<SharedReport[]> =>
    (await runApiData(
      () => apiClient.get({ url: '/api/report', security: bearer }),
      'in-place',
    )) as SharedReport[],
})

concurrency(sharedReportsQuery, { strategy: 'TAKE_LATEST' })

export const shareReportMutation = createMutation({
  handler: async (body: SharedReportCreate): Promise<SharedReport> =>
    (await runApiData(
      () =>
        apiClient.post({
          url: '/api/report',
          security: bearer,
          headers: json,
          body,
        }),
      // The dialog says why a report could not be shared, beside its form.
      'in-place',
    )) as SharedReport,
})

/** Deleting a report ends its link for everyone who has it. */
export const deleteSharedReportMutation = createMutation({
  handler: async (id: string): Promise<string> => {
    await runApiData(() =>
      apiClient.delete({ url: `/api/report/${id}`, security: bearer }),
    )

    return id
  },
})

/** Bills the report's period on its one project; answers with the invoice's id. */
export const invoiceSharedReportMutation = createMutation({
  handler: async (id: string): Promise<{ id: string }> =>
    (await runApiData(() =>
      apiClient.post({
        url: `/api/report/${id}/invoice`,
        security: bearer,
        headers: json,
        body: {},
      }),
    )) as { id: string },
})

export type PublicReportResult =
  | { report: PublicReport }
  | { gone: PublicReportGone }

/**
 * A report by its link, for anyone. A link that was deleted or never existed
 * and one the free plan has hidden are answers, not failures: the page says
 * which. Sent without the reader's session, which the route never reads.
 */
export const publicReportQuery = createQuery({
  handler: async (token: string): Promise<PublicReportResult> => {
    try {
      // The page says what happened itself, so no toast follows a refusal.
      const response = await runApi(
        () =>
          apiClient.get({
            url: `/api/report/public/${encodeURIComponent(token)}`,
            headers: { Authorization: '' },
          }),
        'in-place',
      )

      return { report: (response as { data: PublicReport }).data }
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 404) {
          return { gone: 'missing' }
        }
        if (error.response?.status === 410) {
          return { gone: 'retention' }
        }
      }

      throw error
    }
  },
})

concurrency(publicReportQuery, { strategy: 'TAKE_LATEST' })
