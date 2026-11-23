import type {
  AgentWorkedRow,
  PersonDailyRow,
} from '@work-address/statistics-core'

/** A shared report as its sharer reads it back, with the link's secret. */
export interface ISharedReportView {
  id: string
  token: string
  title: string | null
  /** The sharer's days in `timeZone`; `to` is exclusive. */
  from: string
  to: string
  timeZone: string
  projectIds: string[]
  /** Empty: everyone the sharer sees on those projects. */
  userIds: string[]
  showAmounts: boolean
  createdAt: Date
  invoiceId: string | null
  /** Whether it is the sharer's own time on one project, not yet invoiced. */
  canInvoice: boolean
}

/**
 * The figures a shared report shows, read in the sharer's scope. Time only:
 * no activity, apps, titles, screenshots, prompts or locations, and people's
 * and agents' time side by side, never added.
 */
export interface ISharedFigures {
  projects: { id: string; title: string }[]
  /** Everyone named by a row, and nobody else. */
  people: { id: string; name: string }[]
  agents: { id: string; name: string; userId: string }[]
  daily: PersonDailyRow[]
  agentsDaily: AgentWorkedRow[]
  /** At current rates; absent unless asked for and the sharer may see money. */
  amounts?: { peopleCents: number; agentsCents: number }
}

/** What anyone with the link is shown. */
export interface IPublicReport extends ISharedFigures {
  title: string | null
  sharedBy: string
  from: string
  to: string
  timeZone: string
  createdAt: Date
}
