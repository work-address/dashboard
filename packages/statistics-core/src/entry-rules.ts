/**
 * Per-row rules for an Entry (GLOSSARY.md): Published, detail visible,
 * Invoiced, invoiceable, and phone time allowed. The API keeps SQL forms of
 * some of these beside its queries; these are what they must agree with.
 */

/** An instant as either side stores one. */
export type Instant = Date | string | number

const ms = (at: Instant): number =>
  typeof at === 'number' ? at : new Date(at).getTime()

/** A project's review window when its owner never set one. */
export const DEFAULT_REVIEW_WINDOW_HOURS = 24

/** What the rules read of an entry. */
export interface EntryRow {
  authorId: string | null | undefined
  fromAt: Instant
  toAt: Instant
  publishedAt?: Instant | null
  invoiceId?: string | null
  isPaid?: boolean | null
}

/** What the rules read of the entry's project. */
export interface EntryProject {
  ownerId: string | null | undefined
  reviewWindowHours?: number | null
}

/** Whether the review window of an entry ending at `toAt` is over. */
export function reviewEnded(
  toAt: Instant,
  reviewWindowHours: number | null | undefined,
  now: number = Date.now(),
): boolean {
  const hours = reviewWindowHours ?? DEFAULT_REVIEW_WINDOW_HOURS

  return ms(toAt) + hours * 3_600_000 <= now
}

/**
 * Published: the entry's detail has reached the owner, because its author
 * released it, an invoice billed it, or the review window ended.
 */
export function published(
  entry: Pick<EntryRow, 'toAt' | 'publishedAt' | 'invoiceId'>,
  project: Pick<EntryProject, 'reviewWindowHours'> | null | undefined,
  now: number = Date.now(),
): boolean {
  return Boolean(
    entry.publishedAt ||
      entry.invoiceId ||
      reviewEnded(entry.toAt, project?.reviewWindowHours, now),
  )
}

/**
 * Whether a reader sees an entry's detail: its author always, the owner once
 * it is published, nobody else, a viewer least of all.
 */
export function seesDetail(
  entry: Pick<EntryRow, 'authorId' | 'toAt' | 'publishedAt' | 'invoiceId'>,
  project: EntryProject | null | undefined,
  readerId: string,
  now: number = Date.now(),
): boolean {
  return (
    entry.authorId === readerId ||
    (project?.ownerId === readerId && published(entry, project, now))
  )
}

/** Whether the owner is waiting on the review window to see this detail. */
export function detailPendingReview(
  entry: Pick<EntryRow, 'toAt' | 'publishedAt' | 'invoiceId'>,
  project: EntryProject | null | undefined,
  readerId: string,
  now: number = Date.now(),
): boolean {
  return project?.ownerId === readerId && !published(entry, project, now)
}

/** An invoice as Invoiced reads it. */
export interface CoveringInvoice {
  id: string
  projectId: string
  /** The issuer; null on invoices from before issuers were kept. */
  authorId: string | null | undefined
  rejected: boolean
  /** Raised before invoices froze their lines: it covers its period instead. */
  legacy: boolean
  fromAt: Instant
  toAt: Instant
}

/**
 * Invoiced: covered by an invoice from its author that has not been rejected,
 * either billed on it or, for an invoice older than frozen lines, inside its
 * period. Its detail stays and only its paid state can still change by hand.
 */
export function invoiced(
  entry: Pick<EntryRow, 'authorId' | 'fromAt' | 'toAt' | 'invoiceId'> & {
    projectId: string
  },
  invoices: readonly CoveringInvoice[],
): boolean {
  return invoices.some(
    (invoice) =>
      invoice.projectId === entry.projectId &&
      !invoice.rejected &&
      (invoice.authorId == null || invoice.authorId === entry.authorId) &&
      (invoice.id === entry.invoiceId ||
        (invoice.legacy &&
          ms(entry.fromAt) < ms(invoice.toAt) &&
          ms(entry.toAt) > ms(invoice.fromAt))),
  )
}

/**
 * Whether an issuer may bill this entry now: their own, on no invoice and not
 * marked paid. With a period, only an entry wholly inside it. The API keeps
 * this as `INVOICEABLE` in time-repository.ts.
 */
export function invoiceable(
  entry: Pick<
    EntryRow,
    'authorId' | 'fromAt' | 'toAt' | 'invoiceId' | 'isPaid'
  >,
  issuerId: string,
  period?: { from: Instant; to: Instant },
): boolean {
  return (
    entry.authorId === issuerId &&
    !entry.invoiceId &&
    !entry.isPaid &&
    (!period ||
      (ms(entry.fromAt) >= ms(period.from) && ms(entry.toAt) <= ms(period.to)))
  )
}

/**
 * Whether phone time starting at `fromAt` is taken: the owner allows it now,
 * or it started before they last turned it off. Only that last switch is
 * kept, so an earlier off period is not told apart.
 */
export function phoneTimeAllowed(
  project: {
    allowMobileTime?: boolean | null
    mobileTimeOffAt?: Instant | null
  },
  fromAt: Instant,
): boolean {
  return Boolean(
    project.allowMobileTime ||
      (project.mobileTimeOffAt && ms(fromAt) < ms(project.mobileTimeOffAt)),
  )
}
