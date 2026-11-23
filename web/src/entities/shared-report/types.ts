/**
 * A shared report as its sharer sees it: the fixed period and filters it was
 * shared with, and the link's secret. The figures are never stored; the
 * public page reads them each time it is opened.
 */
export type SharedReport = {
  id: string
  /** The secret part of the link. */
  token: string
  title: string | null
  /** Reader's days in `timeZone`; `to` is exclusive, as the statistics API has it. */
  from: string
  to: string
  timeZone: string
  projectIds: string[]
  /** Empty: everyone the sharer may see on those projects. */
  userIds: string[]
  showAmounts: boolean
  createdAt: string
  /** The invoice made from this report, when there is one. */
  invoiceId: string | null
  /** Whether it is the sharer's own time on one project, which an invoice can bill. */
  canInvoice: boolean
}

export type SharedReportCreate = {
  title?: string
  from: string
  to: string
  timeZone: string
  /** Omitted: every project these filters reach, fixed by the server. */
  projectIds?: string[]
  userIds?: string[]
  /** Asked for; the answer's `showAmounts` says whether it was kept. */
  showAmounts?: boolean
}

/** What anyone with the link is shown. Money is present only when the sharer switched it on. */
export type PublicReport = {
  title: string | null
  /** The sharer's name. */
  sharedBy: string
  from: string
  to: string
  timeZone: string
  createdAt: string
  projects: { id: string; title: string }[]
  /** Named only when the sharer may see time split by person. */
  people: { id: string; name: string }[]
  agents: { id: string; name: string; userId: string }[]
  daily: {
    day: string
    projectId: string
    userId?: string
    trackedSeconds: number
  }[]
  agentsDaily: {
    day: string
    projectId: string
    userId: string
    agentId: string
    workedSeconds: number
  }[]
  amounts?: { peopleCents: number; agentsCents: number }
}

/** Why a link shows no report. */
export type PublicReportGone = 'missing' | 'retention'
