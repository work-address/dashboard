/**
 * Who may see what, and the rows as the API sends them. Every rule is the
 * shared core's (`@work-address/statistics-core`), the one the API calls too:
 * this file only reads the demo's rows into it. Role reads the lists alone;
 * Access adds the owner's plan, which limits only who may record. Detail
 * reaches the owner once published; viewers never get it.
 */
import {
  accessOf,
  canonicalAddress,
  detailPendingReview,
  invoiced,
  listsRow,
  published,
  roleOf as coreRoleOf,
  seesDetail,
  trackingWorkers,
  type Access,
  type ReaderRole,
} from '@work-address/statistics-core'

import { demoScreenshots } from './images'

import type {
  Db,
  MockInvoice,
  MockProject,
  MockRun,
  MockTime,
  MockUser,
} from './db'

export const userOf = (db: Db, id: string) =>
  db.users.find((user) => user.id === id)

export const projectOf = (db: Db, id: string) =>
  db.projects.find((project) => project.id === id && !project.deletedAt)

export const ownerPremium = (db: Db, project: MockProject) =>
  userOf(db, project.ownerId)?.premium ?? false

export const isOwner = (project: MockProject, userId: string) =>
  project.ownerId === userId

/** What the lists say, whatever the owner's plan: `ProjectAccess.role`. */
export const roleOf = (project: MockProject, userId: string): ReaderRole =>
  coreRoleOf(
    isOwner(project, userId),
    { workers: project.workerIds, viewers: project.viewerIds },
    userId,
  )

/** Everyone on the owner's worker lists, in the order they were listed. */
export const listedWorkers = (db: Db, ownerId: string) => [
  ...new Set(
    db.projects
      .filter((project) => project.ownerId === ownerId && !project.deletedAt)
      .flatMap((project) => project.workerIds),
  ),
]

/** The workers the owner's plan lets record today: `Plan.tracking`. */
export const trackingOf = (db: Db, ownerId: string) => {
  const owner = userOf(db, ownerId)

  return trackingWorkers(listedWorkers(db, ownerId), {
    premium: owner?.premium ?? false,
    kept: owner?.keptWorkers,
  })
}

/** What the person's role grants them on the project today. */
export const accessOn = (
  db: Db,
  project: MockProject,
  userId: string,
): Access =>
  accessOf(
    roleOf(project, userId),
    trackingOf(db, project.ownerId).has(canonicalAddress(userId)),
  )

/**
 * The entries a reader may list: an owner everyone's, a worker their own, a
 * viewer none. Reads no plan, like `ProjectAccess.filterEntries`.
 */
export const canListEntry = (
  db: Db,
  time: MockTime,
  userId: string,
): boolean => {
  const project = projectOf(db, time.projectId)

  return Boolean(
    project && listsRow(roleOf(project, userId), time.userId, userId),
  )
}

/** Every live project the user owns, works on or views. */
export const visibleProjects = (db: Db, userId: string) =>
  db.projects.filter(
    (project) => !project.deletedAt && roleOf(project, userId) !== null,
  )

/** An entry as the core reads it: the demo calls its author `userId`. */
const entryRow = (time: MockTime) => ({ ...time, authorId: time.userId })

/** Published by the author, invoiced, or past the project's review window. */
export const isPublished = (
  time: MockTime,
  project: MockProject,
  now = Date.now(),
) => published(time, project, now)

/**
 * Invoiced (GLOSSARY.md). The demo's invoices all freeze their lines, so
 * only the invoice an entry is billed on can cover it.
 */
export const isInvoiced = (db: Db, time: MockTime) => {
  const invoice = time.invoiceId
    ? db.invoices.find((row) => row.id === time.invoiceId)
    : undefined

  return invoiced(entryRow(time), invoice ? [coveringOf(invoice)] : [])
}

const coveringOf = (invoice: MockInvoice) => ({
  id: invoice.id,
  projectId: invoice.projectId,
  authorId: invoice.userId,
  rejected: invoice.state === 'REJECTED',
  legacy: false,
  fromAt: invoice.fromAt,
  toAt: invoice.toAt,
})

/**
 * The demo's agent is the product a person's runs used (team.ts): this is the
 * id a run's agent goes by on every route, and what a reader filters with.
 */
export const agentIdOf = (run: Pick<MockRun, 'userId' | 'product'>) =>
  `${run.userId}:${run.product}`

/** The author always; the owner once published; nobody else. */
export const hasDetail = (
  time: MockTime,
  project: MockProject,
  userId: string,
  now = Date.now(),
) => seesDetail(entryRow(time), project, userId, now)

export const shapeUser = (user: MockUser) => ({
  ...user,
  // The API derives this too: where an EVM account is paid. Without it the
  // demo could never draw a profile's QR code or an invoice's "Pay to".
  payWallet: user.address.startsWith('0x') ? user.address : null,
})

const shapeProjectCore = (db: Db, project: MockProject) => {
  const owner = userOf(db, project.ownerId)
  const address = (id: string) => userOf(db, id)?.address ?? ''
  const {
    ownerId: _owner,
    workerIds,
    viewerIds,
    deletedAt: _deleted,
    ...rest
  } = project
  return {
    ...rest,
    workerAddresses: workerIds.map(address),
    viewerAddresses: viewerIds.map(address),
    user: owner ? shapeUser(owner) : undefined,
  }
}

export const shapeProject = (db: Db, project: MockProject, meId: string) => {
  const { rateHour, ...core } = shapeProjectCore(db, project)
  const access = accessOn(db, project, meId)

  return {
    ...core,
    // A viewer gets time and no money.
    ...(access.seesMoney ? { rateHour } : {}),
    role: access.role,
    workers: project.workerIds
      .map((id) => userOf(db, id))
      .filter(Boolean)
      .map((user) => shapeUser(user!)),
    viewers: project.viewerIds
      .map((id) => userOf(db, id))
      .filter(Boolean)
      .map((user) => shapeUser(user!)),
    agents: [],
    canTrack: access.tracks,
  }
}

/** A time entry as `TimeVisibility.redact` leaves it for this reader. */
export const shapeTime = (
  db: Db,
  time: MockTime,
  meId: string,
  now = Date.now(),
) => {
  const project = projectOf(db, time.projectId)!
  const author = userOf(db, time.userId)
  const { projectId: _p, userId: _u, invoiceId: _i, screenshot, ...rest } = time
  const base = {
    ...rest,
    isInvoiced: isInvoiced(db, time),
    project: shapeProjectCore(db, project),
    user: author ? shapeUser(author) : undefined,
    screenshot: screenshot === null ? undefined : demoScreenshots()[screenshot],
    processes: [] as unknown[],
    appsReason: null,
    appsTruncated: false,
    apps: time.apps.map((app) => ({ ...app, titles: [] })),
  }
  if (hasDetail(time, project, meId, now)) {
    return base
  }
  return {
    ...base,
    note: null,
    minutesActive: null,
    keyboardKeys: null,
    mouseKeys: null,
    mouseDistance: null,
    screenshot: undefined,
    processes: null,
    apps: undefined,
    locations: undefined,
    detailPendingReview: detailPendingReview(time, project, meId, now),
  }
}

/**
 * An invoice as the API answers it: its frozen lines, and on the invoice page
 * the entries it bills with their roll-up. Money and minutes come from the
 * human line, because that is what was charged (`InvoiceManager.reportFor`).
 */
export const shapeInvoice = (
  db: Db,
  invoice: MockInvoice,
  meId: string,
  full = false,
) => {
  const project =
    projectOf(db, invoice.projectId) ??
    db.projects.find((p) => p.id === invoice.projectId)!
  const author = userOf(db, invoice.userId)
  // Absent on an invoice saved before the demo froze lines, until the day's
  // edits are dropped at midnight.
  const lines = invoice.lines ?? []
  const shaped = {
    id: invoice.id,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    project: shapeProjectCore(db, project),
    user: author ? shapeUser(author) : undefined,
    fromAt: invoice.fromAt,
    toAt: invoice.toAt,
    amountCents: invoice.amountCents,
    state: invoice.state,
    lines,
    rejectionReason: invoice.rejectionReason,
    rejectedAt: invoice.rejectedAt,
    paidAt: invoice.paidAt,
  }
  if (!full) {
    return shaped
  }
  const entries = db.times.filter((time) => invoice.timeIds.includes(time.id))
  const sum = (key: 'keyboardKeys' | 'mouseKeys' | 'mouseDistance') =>
    entries.reduce((total, e) => total + (e[key] ?? 0), 0)
  const human = lines.find((line) => line.kind === 'human')
  const minutes = human?.minutes ?? 0
  return {
    ...shaped,
    time: entries.map((entry) => {
      const {
        project: _p,
        user: _u,
        apps: _a,
        ...rest
      } = shapeTime(db, entry, meId)
      return rest
    }),
    report: {
      rateHour: human
        ? human.rateHourCents === null
          ? null
          : human.rateHourCents / 100
        : 0,
      rateTotal: invoice.amountCents / 100,
      minutes,
      minutesActive: human?.activeMinutes ?? 0,
      minutesPaid: invoice.state === 'PAID' ? minutes : 0,
      minutesUnpaid: invoice.state === 'Requested' ? minutes : 0,
      keyboardKeys: sum('keyboardKeys'),
      mouseKeys: sum('mouseKeys'),
      mouseDistance: sum('mouseDistance'),
    },
  }
}

/**
 * A run as agent search sends it: another worker's prompt is held from the
 * owner until their review window passes or the run is invoiced.
 */
export const shapeRun = (
  db: Db,
  run: MockRun,
  meId: string,
  now = Date.now(),
) => {
  const project = projectOf(db, run.projectId)
  // Held as an entry's detail is: released by its author, billed, or past review.
  const held =
    run.userId !== meId &&
    !published(
      { ...run, publishedAt: run.released ? run.toAt : null },
      project,
      now,
    )
  // The demo's agent is the product a person's runs used (team.ts), and a
  // quarter of its runs came from a server: the run key says which, so the
  // seed's other data stays as it was.
  const agentId = agentIdOf(run)
  const mode = run.mode ?? (parseInt(run.runKey[0], 16) < 4 ? 'fixed' : 'timer')
  return {
    deletedAt: null,
    ...run,
    agentId,
    agentName: run.product,
    agentRateHourCents: project?.agentRates?.[agentId] ?? 0,
    sourceInstanceId: run.agentId,
    // A day's runs are one session, so a run has neighbours to show.
    sourceSessionId: run.sessionId ?? `demo-${run.fromAt.slice(0, 10)}`,
    sourceRunId: run.runKey,
    sourceAgentId: 'root',
    measurement: {
      mode,
      coverage: 'run',
      qualification: 'unqualified',
      liveness: false,
      provisional: false,
      adapterVersion: 'demo',
      runtimeVersion: 'demo',
      schemaVersion: 1,
    },
    manual: false,
    prompt: held ? null : run.prompt,
    ...(held && run.prompt ? { promptPendingReview: true } : {}),
  }
}
