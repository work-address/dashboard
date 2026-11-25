import type { baseApi } from '@/shared'

/**
 * Access (GLOSSARY.md): what the reader's role grants them today, once the
 * owner's plan is taken into account. The one place the dashboard asks; the
 * rules are SPEC.md's "Who can see what" and "What premium governs".
 *
 * Computed on the client from what the API already sends with each project:
 * `role`, which reads no plan, and `canTrack`, which is the API's own
 * `Plan.mayTrack` on an active project. The plan limits only new tracking, so
 * `track` is the one answer that reads it; every other answer is the role's.
 */

export type ReaderRole = NonNullable<baseApi.Project['role']>

/** The fields of a project that Access reads. */
export type AccessProject = {
  role?: ReaderRole | null
  canTrack?: unknown
}

export type ProjectAccess = {
  /** The rate, money, and paid and unpaid time: own for a worker, all for an owner. */
  amounts: boolean
  /** Activity, apps, screenshots and the rest of an entry's detail. */
  detail: boolean
  /** The team list and agent runs: own for a worker, all for an owner. */
  agents: boolean
  /** Every worker's figures, not only the reader's own: the people filter. */
  everyone: boolean
  /** Issuing an invoice for one's own time. */
  invoice: boolean
  /** Changing the project, its lists, or deleting it. */
  manage: boolean
  /** Recording new time now: the role, the plan, and the project being open. */
  track: boolean
}

const NONE: ProjectAccess = {
  amounts: false,
  detail: false,
  agents: false,
  everyone: false,
  invoice: false,
  manage: false,
  track: false,
}

/** What the reader may see and do on one project. No role grants nothing. */
export const projectAccess = (
  project: AccessProject | null | undefined,
): ProjectAccess => {
  const role = project?.role

  if (!role) {
    return NONE
  }

  const works = role === 'owner' || role === 'worker'

  return {
    amounts: works,
    detail: works,
    agents: works,
    everyone: role === 'owner',
    invoice: works,
    manage: role === 'owner',
    track: works && project?.canTrack === true,
  }
}

export type ReaderAccess = {
  /** Owns or works on a project: the tracking, agent and screenshot widgets. */
  works: boolean
  /** Owns a project: the people filter and the owner's own tools. */
  owns: boolean
  /** Sees money on some project, so is offered it, e.g. in a shared report. */
  amounts: boolean
  /** Only ever a viewer: no entries, no Team or Agents pages. */
  viewsOnly: boolean
}

/**
 * What the reader may do across all their projects, from their roles on each.
 * Someone on no project yet is not "only a viewer": they may still create one.
 */
export const readerAccess = (
  roles: ReadonlyArray<ReaderRole | null | undefined>,
): ReaderAccess => {
  const known = roles.filter((role): role is ReaderRole => Boolean(role))
  const works = known.some((role) => role === 'owner' || role === 'worker')

  return {
    works,
    owns: known.includes('owner'),
    amounts: works,
    viewsOnly: known.length > 0 && !works,
  }
}

/** `readerAccess` over a list of projects. */
export const projectsAccess = (
  projects: ReadonlyArray<AccessProject>,
): ReaderAccess => readerAccess(projects.map((project) => project.role))

/** The invoice fields that Access reads. */
export type AccessInvoice = {
  state?: string | null
  /** The issuer. */
  user?: { id?: string | null } | null
  project?: { user?: { id?: string | null } | null } | null
}

type Reader = { id?: string | null } | null | undefined

export type InvoiceAccess = {
  /**
   * Mark paid or unpaid. Only the issuer: the person owed the money is the one
   * who knows whether it arrived. A rejected invoice is closed.
   */
  settle: boolean
  /** Reject it. Only the project's owner, and only while it awaits payment. */
  reject: boolean
}

/** What the reader may do to one invoice. */
export const invoiceAccess = (
  invoice: AccessInvoice | null | undefined,
  reader: Reader,
): InvoiceAccess => {
  const id = reader?.id

  if (!id || !invoice) {
    return { settle: false, reject: false }
  }

  return {
    settle: invoice.user?.id === id && invoice.state !== 'REJECTED',
    reject: invoice.project?.user?.id === id && invoice.state === 'Requested',
  }
}
