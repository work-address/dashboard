/**
 * What the API and the web demo's mock must both answer. Each runs these through
 * its own adapter: real HTTP and Postgres in api/src/test/contract, MSW in
 * web/src/shared/mock/contract.test.ts. Where they differ the API is right,
 * unless SPEC.md says otherwise.
 */
export type ContractPerson =
  | 'owner'
  | 'worker'
  | 'viewer'
  | 'outsider'
  /** On the Free plan, where `owner` is on Premium; owns `freeProject` alone. */
  | 'freeOwner'

/** Who makes a request: one of the people, or someone with no session at all. */
export type ContractReader = ContractPerson | 'anyone'

/** A shared report, by its id and by the secret in its link. */
export interface ContractReport {
  id: string
  token: string
}

/** Ids of a small world every scenario starts from, rate $60/h, 24 h review. */
export interface ContractWorld {
  project: string
  /** The people, for filters that name them. */
  ownerId: string
  workerId: string
  /** The worker's, inside the review window, note 'draft'. */
  draftEntry: string
  /** The worker's, past the review window, note 'old'. */
  oldEntry: string
  /** The worker's, 30 minutes, on no invoice, in `billableFromUnix`..`ToUnix`. */
  looseEntry: string
  /** The worker's, in that range too, already marked paid by hand. */
  paidEntry: string
  billableFromUnix: number
  billableToUnix: number
  /** The worker's, on `invoice`. */
  invoicedEntry: string
  /** Requested, issued by the worker. */
  invoice: string
  /** The worker's, on a project that is closed. */
  closedEntry: string
  /** The owner's, 30 minutes. */
  ownerEntry: string
  /** The worker's, 30 minutes, on a paid invoice of 3000 cents, un-marked by hand. */
  settledEntry: string
  /**
   * The worker's agents on `project`, by the id a reader filters with. Each
   * has one run, one running stretch long: `agent`'s is claude-code, completed,
   * 30 minutes from `agentRunFromUnix`, the last 20 of them inside
   * `draftEntry`; `otherAgent`'s is codex, failed, 10 minutes from
   * `otherAgentRunFromUnix`, a day earlier and beside no entry. `agent` is on
   * the worker's agent list, named 'claude-code', and on `project` at $12/h;
   * `otherAgent` has no rate there.
   */
  agent: string
  otherAgent: string
  agentRunFromUnix: number
  otherAgentRunFromUnix: number
  /**
   * `freeOwner`'s, with nobody else on it, so its history is hidden at 14
   * days. Holds 30 minutes of the free owner's, four hours old, on
   * `freeInvoice` and marked paid by hand.
   */
  freeProject: string
  /** Requested, issued by the free owner. */
  freeInvoice: string
  /**
   * Shared reports, each of one project over `contractSpan()` unless it says
   * otherwise. The owner's is of everyone on `project`, with amounts on.
   */
  ownerReport: ContractReport
  /** The worker's of `project`: their own time, amounts off, not invoiced. */
  workerReport: ContractReport
  /** The viewer's of `project`. */
  viewerReport: ContractReport
  /** The worker's of `project`, remembering `invoice` as made from it. */
  invoicedReport: ContractReport
  /** The worker's of `project`, deleted. */
  deletedReport: ContractReport
  /** The free owner's of `freeProject`: its 30 days reach past the free plan. */
  freeReport: ContractReport
  /** The free owner's of `freeProject` over `contractSpan(7)`. */
  freeRecentReport: ContractReport
}

export interface ContractRequest {
  method: 'get' | 'post' | 'put' | 'delete'
  path: string
  body?: unknown
}

export interface ContractResponse {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

export interface ContractAdapter {
  seed(): Promise<ContractWorld>
  /** As 'anyone', the request carries no session at all. */
  send(
    reader: ContractReader,
    request: ContractRequest,
  ): Promise<ContractResponse>
}

export interface ContractScenario {
  name: string
  as: ContractReader
  request: (world: ContractWorld) => ContractRequest
  status: number
  /** What must hold of the body; returns what is wrong, or nothing. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  check?: (body: any, world: ContractWorld) => string | undefined
  /**
   * A second request, made once the first has answered as it should, to read
   * back what the first changed. `first` is the first answer's body.
   */
  after?: {
    as: ContractReader
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request: (world: ContractWorld, first: any) => ContractRequest
    status: number
    check?: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: any,
      world: ContractWorld,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      first: any,
    ) => string | undefined
  }
}

const DAY_MS = 86_400_000
const day = (offset: number) =>
  new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10)

/**
 * The span statistics and shared reports are read over: `days` back through
 * today, in UTC. Both adapters seed their reports with it.
 */
export const contractSpan = (days = 30) => ({
  from: day(-days),
  to: day(1),
  timeZone: 'UTC',
})

const statistics = (extra: Record<string, unknown> = {}) => ({
  ...contractSpan(),
  ...extra,
})

const search = (): ContractRequest => ({
  method: 'post',
  path: '/time/search',
  body: { filter: {}, sort: { fromAt: 'DESC' }, page: 0, limit: 100 },
})

const searchWhere = (filter: Record<string, unknown>): ContractRequest => ({
  method: 'post',
  path: '/time/search',
  body: { filter, sort: { fromAt: 'DESC' }, page: 0, limit: 100 },
})

/* eslint-disable @typescript-eslint/no-explicit-any */
const entry = (body: any, id: string) =>
  (body[0] as any[]).find((row) => row.id === id)
const rowOf = (rows: any, world: ContractWorld) =>
  (rows as any[]).find((row) => row.projectId === world.project)
/* eslint-enable @typescript-eslint/no-explicit-any */

/** What must differ from the row, or nothing. Absent fields must be absent. */
const rowIs =
  (expected: Record<string, unknown>) =>
  (row: Record<string, unknown> | undefined, world: ContractWorld) => {
    const want: Record<string, unknown> = {
      ...expected,
      projectId: world.project,
    }
    const keys = [...new Set([...Object.keys(want), ...Object.keys(row ?? {})])]
    const wrong = keys.filter((key) => row?.[key] !== want[key])
    return wrong.length
      ? `${wrong.map((key) => `${key} is ${JSON.stringify(row?.[key])}`).join(', ')}, not ${JSON.stringify(wrong.map((key) => want[key]))}`
      : undefined
  }

/** A row without its activity figures, which depend on the seed's entries. */
const moneyOf = (row: Record<string, unknown> | undefined) => {
  const { minutesActive, keyboardKeys, mouseKeys, mouseDistance, ...money } =
    row ?? {}
  return money
}

const allTime = (w: ContractWorld): ContractRequest => ({
  method: 'get',
  path: `/time/totals/${w.project}/project`,
})

const overview = (w: ContractWorld): ContractRequest => ({
  method: 'post',
  path: '/statistics/overview',
  body: statistics({ projectIds: [w.project] }),
})

const freeOverview = (w: ContractWorld): ContractRequest => ({
  method: 'post',
  path: '/statistics/overview',
  body: statistics({ projectIds: [w.freeProject] }),
})

const agentsDaily =
  (extra: (w: ContractWorld) => Record<string, unknown> = () => ({})) =>
  (w: ContractWorld): ContractRequest => ({
    method: 'post',
    path: '/statistics/agents/daily',
    body: statistics({ projectIds: [w.project], ...extra(w) }),
  })

/** The free plan keeps 14 days: `FREE_RETENTION_DAYS` in the API's model/plan.ts. */
const FREE_RETENTION_MS = 14 * DAY_MS

/** What is wrong with a body that should say the free plan hides history. */
const hidesHistory =
  (canUpgrade: boolean) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (body: any) => {
    const at = Date.parse(body.hiddenBefore)
    const limit = Date.now() - FREE_RETENTION_MS
    if (!(Math.abs(at - limit) < 60_000))
      return `hiddenBefore is ${JSON.stringify(body.hiddenBefore)}, not ${new Date(limit).toISOString()}`
    if (body.hiddenBefore !== new Date(at).toISOString())
      return `hiddenBefore is ${body.hiddenBefore}, not an ISO date-time`
    return body.canUpgrade === canUpgrade
      ? undefined
      : `canUpgrade is ${JSON.stringify(body.canUpgrade)}, not ${canUpgrade}`
  }

/** What is wrong with a body that should say nothing is hidden. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hidesNothing = (body: any) =>
  'hiddenBefore' in body || 'canUpgrade' in body
    ? `carries hiddenBefore ${JSON.stringify(body.hiddenBefore)}, canUpgrade ${JSON.stringify(body.canUpgrade)}`
    : undefined

const utcDay = (unix: number) => new Date(unix).toISOString().slice(0, 10)

/** What differs from the rows expected, in order, or nothing. */
const rowsAre = (name: string, rows: unknown, expected: unknown[]) =>
  JSON.stringify(rows) === JSON.stringify(expected)
    ? undefined
    : `${name} is ${JSON.stringify(rows)}, not ${JSON.stringify(expected)}`

/**
 * What is wrong with an agent report that should hold these agents of the
 * worker's and no others. A run can cross the reader's midnight, so an agent's
 * rows are summed: that is how a reader is meant to use them.
 */
const agentTimeIs =
  (
    expected: (w: ContractWorld) => {
      agentId: string
      assistedSeconds: number
      autonomousSeconds: number
    }[],
  ) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (body: any, world: ContractWorld) => {
    const want = expected(world)
    const rows = body.daily as {
      day: string
      userId: string
      agentId: string
      product: string
      assistedSeconds: number
      autonomousSeconds: number
      waitSeconds: number
    }[]
    const stray = rows.find(
      (row) =>
        row.userId !== world.workerId ||
        !want.some((agent) => agent.agentId === row.agentId),
    )
    if (stray) return `carries a row of ${stray.userId}, ${stray.agentId}`
    for (const agent of want) {
      const sum = (key: 'assistedSeconds' | 'autonomousSeconds') =>
        rows
          .filter((row) => row.agentId === agent.agentId)
          .reduce((total, row) => total + row[key], 0)
      if (
        sum('assistedSeconds') !== agent.assistedSeconds ||
        sum('autonomousSeconds') !== agent.autonomousSeconds
      )
        return `${agent.agentId} has ${sum('assistedSeconds')} assisted and ${sum('autonomousSeconds')} autonomous seconds`
    }
    return undefined
  }

const share = (body: Record<string, unknown>): ContractRequest => ({
  method: 'post',
  path: '/report',
  body: { ...contractSpan(), ...body },
})

const open = (report: Pick<ContractReport, 'token'>): ContractRequest => ({
  method: 'get',
  path: `/report/public/${report.token}`,
})

const invoiceOf = (report: ContractReport): ContractRequest => ({
  method: 'post',
  path: `/report/${report.id}/invoice`,
  body: {},
})

/** Every key a sharer's view of a report has, and no other. */
const VIEW_KEYS = [
  'canInvoice',
  'createdAt',
  'from',
  'id',
  'invoiceId',
  'projectIds',
  'showAmounts',
  'timeZone',
  'title',
  'to',
  'token',
  'userIds',
]

/** What is wrong with a sharer's view of a report, or nothing. */
const viewIs = (
  view: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
) => {
  if (!view) return 'the report is not there'
  const keys = rowsAre('the view’s keys', Object.keys(view).sort(), VIEW_KEYS)
  if (keys) return keys
  if (typeof view.token !== 'string' || view.token.length < 32)
    return `token is ${JSON.stringify(view.token)}`
  const wrong = Object.keys(expected).filter(
    (key) => JSON.stringify(view[key]) !== JSON.stringify(expected[key]),
  )
  return wrong.length
    ? wrong
        .map(
          (key) =>
            `${key} is ${JSON.stringify(view[key])}, not ${JSON.stringify(expected[key])}`,
        )
        .join(', ')
    : undefined
}

/** Every key an opened report has; `amounts` only where it shows money. */
const REPORT_KEYS = [
  'agents',
  'agentsDaily',
  'createdAt',
  'daily',
  'from',
  'people',
  'projects',
  'sharedBy',
  'timeZone',
  'title',
  'to',
]

/**
 * What is wrong with an opened report of `project`, or nothing. `people` and
 * `agents` are the seconds each must add up to, and name everyone the report
 * may name; with `total` instead, the report names nobody and no agent. A run
 * or a day's entries can fall either side of the reader's midnight, so rows
 * are summed.
 */
const reportIs = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  world: ContractWorld,
  expected: {
    people?: Record<string, number>
    agents?: Record<string, number>
    total?: number
    amounts?: { peopleCents: number; agentsCents: number }
  },
) => {
  const keys = rowsAre(
    'the report’s keys',
    Object.keys(body).sort(),
    [...REPORT_KEYS, ...(expected.amounts ? ['amounts'] : [])].sort(),
  )
  if (keys) return keys
  if (typeof body.sharedBy !== 'string' || !body.sharedBy)
    return `sharedBy is ${JSON.stringify(body.sharedBy)}`
  const projects = rowsAre(
    'projects',
    (body.projects as { id: string }[]).map((project) => project.id),
    [world.project],
  )
  if (projects) return projects

  const daily = body.daily as Record<string, unknown>[]
  const agentsDaily = body.agentsDaily as Record<string, unknown>[]
  const strayKeys = [
    ...daily.flatMap((row) =>
      Object.keys(row).filter(
        (key) =>
          !['day', 'projectId', 'userId', 'trackedSeconds'].includes(key),
      ),
    ),
    ...agentsDaily.flatMap((row) =>
      Object.keys(row).filter(
        (key) =>
          !['day', 'projectId', 'userId', 'agentId', 'workedSeconds'].includes(
            key,
          ),
      ),
    ),
  ]
  if (strayKeys.length) return `rows carry ${strayKeys.join(', ')}`
  if ([...daily, ...agentsDaily].some((row) => row.projectId !== world.project))
    return 'a row is of another project'

  const sums = (rows: Record<string, unknown>[], by: string, of: string) => {
    const totals: Record<string, number> = {}
    for (const row of rows) {
      const key = String(row[by] ?? '')
      totals[key] = (totals[key] ?? 0) + Number(row[of])
    }
    return totals
  }
  const sorted = (totals: Record<string, number>) =>
    JSON.stringify(Object.entries(totals).sort())
  const people = expected.people ?? { '': expected.total ?? 0 }
  const tracked = sums(daily, 'userId', 'trackedSeconds')
  if (sorted(tracked) !== sorted(people))
    return `time is ${sorted(tracked)}, not ${sorted(people)}`
  if (!expected.people && daily.some((row) => 'userId' in row))
    return 'a row names a person'
  const worked = sums(agentsDaily, 'agentId', 'workedSeconds')
  if (sorted(worked) !== sorted(expected.agents ?? {}))
    return `agent time is ${sorted(worked)}, not ${sorted(expected.agents ?? {})}`
  if (agentsDaily.some((row) => row.userId !== world.workerId))
    return 'an agent row is not the worker’s'

  // Everyone and every agent a row names is named once, and nobody else is.
  const named = (list: { id: string; name: string }[]) =>
    list.every((item) => typeof item.name === 'string')
      ? list.map((item) => item.id).sort()
      : ['a name is missing']
  return (
    rowsAre(
      'people',
      named(body.people),
      [
        ...new Set([
          ...Object.keys(expected.people ?? {}),
          ...(Object.keys(expected.agents ?? {}).length
            ? [world.workerId]
            : []),
        ]),
      ].sort(),
    ) ??
    rowsAre(
      'agents',
      named(body.agents),
      Object.keys(expected.agents ?? {}).sort(),
    ) ??
    ((body.agents as { userId: string }[]).some(
      (agent) => agent.userId !== world.workerId,
    )
      ? 'an agent is not the worker’s'
      : undefined) ??
    (expected.amounts
      ? rowsAre(
          'amounts',
          [body.amounts.peopleCents, body.amounts.agentsCents],
          [expected.amounts.peopleCents, expected.amounts.agentsCents],
        )
      : undefined)
  )
}

const projectRead = (w: ContractWorld): ContractRequest => ({
  method: 'post',
  path: '/project/search',
  body: { filter: { projectId: w.project }, sort: { id: 'ASC' }, page: 0 },
})

const noteIs =
  (id: keyof ContractWorld, note: string | null) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (body: any, world: ContractWorld) => {
    const row = entry(body, world[id] as string)
    if (!row) return `${id} is not listed`
    return (row.note ?? null) === note
      ? undefined
      : `${id} has note ${JSON.stringify(row.note)}, not ${JSON.stringify(note)}`
  }

export const CONTRACT_SCENARIOS: ContractScenario[] = [
  // Invoices: SPEC.md "Only the issuer may mark an invoice paid", "Only the
  // owner may reject an invoice", "A viewer sees no invoices"
  {
    name: 'the issuer marks their invoice paid',
    as: 'worker',
    request: (w) => ({ method: 'post', path: `/invoice/${w.invoice}/paid` }),
    status: 200,
  },
  {
    name: 'the owner cannot mark a worker’s invoice paid',
    as: 'owner',
    request: (w) => ({ method: 'post', path: `/invoice/${w.invoice}/paid` }),
    status: 403,
  },
  {
    name: 'the owner rejects a requested invoice',
    as: 'owner',
    request: (w) => ({ method: 'post', path: `/invoice/${w.invoice}/reject` }),
    status: 200,
  },
  {
    name: 'the issuer cannot reject their own invoice',
    as: 'worker',
    request: (w) => ({ method: 'post', path: `/invoice/${w.invoice}/reject` }),
    status: 403,
  },
  {
    name: 'a viewer cannot read an invoice',
    as: 'viewer',
    request: (w) => ({ method: 'get', path: `/invoice/${w.invoice}` }),
    status: 403,
  },
  {
    name: 'an invoice bills each unpaid entry’s own span in the period',
    as: 'worker',
    request: (w) => ({
      method: 'post',
      path: `/invoice/project/${w.project}`,
      body: { fromUnix: w.billableFromUnix, toUnix: w.billableToUnix },
    }),
    status: 200,
    check: (body) =>
      body.amountCents === 3000
        ? undefined
        : `amountCents is ${body.amountCents}, not 3000`,
  },

  // Entries: SPEC.md "Time.isPaid is set by an invoice or by its author"
  {
    name: 'an author edits their own entry',
    as: 'worker',
    request: (w) => ({
      method: 'put',
      path: `/time/${w.draftEntry}`,
      body: { note: 'changed' },
    }),
    status: 200,
  },
  {
    name: 'the owner cannot edit a worker’s entry',
    as: 'owner',
    request: (w) => ({
      method: 'put',
      path: `/time/${w.draftEntry}`,
      body: { note: 'changed' },
    }),
    status: 403,
  },
  {
    name: 'an entry on no invoice can be marked paid by hand',
    as: 'worker',
    request: (w) => ({
      method: 'post',
      path: '/time/paid',
      body: { ids: [w.looseEntry] },
    }),
    status: 200,
  },
  {
    name: 'an entry on an invoice can be marked paid by hand',
    as: 'worker',
    request: (w) => ({
      method: 'post',
      path: '/time/paid',
      body: { ids: [w.invoicedEntry] },
    }),
    status: 200,
  },
  {
    name: 'only its author can mark an entry paid by hand',
    as: 'owner',
    request: (w) => ({
      method: 'post',
      path: '/time/paid',
      body: { ids: [w.invoicedEntry] },
    }),
    status: 403,
  },

  // Invoiced entries: SPEC.md "An invoiced entry keeps its detail"
  {
    name: 'an author deletes an entry on no invoice',
    as: 'worker',
    request: (w) => ({
      method: 'delete',
      path: '/time',
      body: { ids: [w.looseEntry] },
    }),
    status: 200,
  },
  {
    name: 'an invoiced entry cannot be deleted',
    as: 'worker',
    request: (w) => ({
      method: 'delete',
      path: '/time',
      body: { ids: [w.invoicedEntry] },
    }),
    status: 400,
  },
  {
    name: 'a batch with an invoiced entry in it is refused whole',
    as: 'worker',
    request: (w) => ({
      method: 'delete',
      path: '/time',
      body: { ids: [w.looseEntry, w.invoicedEntry] },
    }),
    status: 400,
  },
  {
    name: 'only its author can delete an entry',
    as: 'owner',
    request: (w) => ({
      method: 'delete',
      path: '/time',
      body: { ids: [w.looseEntry] },
    }),
    status: 403,
  },
  {
    name: 'an author removes a screenshot from an entry on no invoice',
    as: 'worker',
    request: (w) => ({
      method: 'delete',
      path: '/time/screenshots',
      body: { ids: [w.looseEntry] },
    }),
    status: 200,
  },
  {
    name: 'an invoiced entry keeps its screenshot',
    as: 'worker',
    request: (w) => ({
      method: 'delete',
      path: '/time/screenshots',
      body: { ids: [w.invoicedEntry] },
    }),
    status: 400,
  },
  {
    name: 'an invoiced entry keeps its apps',
    as: 'worker',
    request: (w) => ({
      method: 'delete',
      path: '/time/processes',
      body: { ids: [w.invoicedEntry] },
    }),
    status: 400,
  },
  {
    name: 'an invoiced entry keeps its note',
    as: 'worker',
    request: (w) => ({
      method: 'put',
      path: `/time/${w.invoicedEntry}`,
      body: { note: 'changed' },
    }),
    status: 400,
  },
  {
    name: 'an edit may carry an invoiced entry’s same note with a paid change',
    as: 'worker',
    request: (w) => ({
      method: 'put',
      path: `/time/${w.invoicedEntry}`,
      body: { note: 'invoiced', isPaid: true },
    }),
    status: 200,
  },

  {
    name: 'a search says which entries are invoiced',
    as: 'worker',
    request: search,
    status: 200,
    check: (body, w) =>
      entry(body, w.invoicedEntry)?.isInvoiced === true &&
      entry(body, w.looseEntry)?.isInvoiced === false
        ? undefined
        : 'isInvoiced is wrong',
  },

  // Detail: SPEC.md "Detail waits for the worker's review"
  {
    name: 'an author sees their own detail before review',
    as: 'worker',
    request: search,
    status: 200,
    check: noteIs('draftEntry', 'draft'),
  },
  {
    name: 'the owner does not see detail before review',
    as: 'owner',
    request: search,
    status: 200,
    check: noteIs('draftEntry', null),
  },
  {
    name: 'the owner sees detail once the review window ends',
    as: 'owner',
    request: search,
    status: 200,
    check: noteIs('oldEntry', 'old'),
  },
  {
    name: 'a viewer lists no entries',
    as: 'viewer',
    request: search,
    status: 200,
    check: (body) =>
      body[0].length === 0 ? undefined : `lists ${body[0].length} entries`,
  },
  {
    name: 'the search narrows to the people asked for',
    as: 'owner',
    request: (w) => searchWhere({ userIds: [w.workerId] }),
    status: 200,
    check: (body, w) =>
      entry(body, w.draftEntry) && !entry(body, w.ownerEntry)
        ? undefined
        : 'did not list the worker alone',
  },
  {
    name: 'naming a person shows a viewer no entries either',
    as: 'viewer',
    request: (w) => searchWhere({ userIds: [w.workerId] }),
    status: 200,
    check: (body) =>
      body[0].length === 0 ? undefined : `lists ${body[0].length} entries`,
  },
  {
    name: 'the search narrows to the projects asked for',
    as: 'owner',
    request: (w) => searchWhere({ projectIds: [w.project] }),
    status: 200,
    check: (body, w) =>
      entry(body, w.draftEntry) &&
      (body[0] as { project?: { id?: string } }[]).every(
        (row) => row.project?.id === w.project,
      )
        ? undefined
        : 'listed another project, or none of this one',
  },
  {
    name: 'empty people and project lists narrow nothing',
    as: 'owner',
    request: () => searchWhere({ userIds: [], projectIds: [] }),
    status: 200,
    check: (body, w) =>
      entry(body, w.draftEntry) && entry(body, w.ownerEntry)
        ? undefined
        : 'an empty list hid entries',
  },
  {
    name: 'the search narrows to the source asked for',
    as: 'owner',
    request: () => searchWhere({ source: 'desktop' }),
    status: 200,
    check: (body, w) =>
      entry(body, w.ownerEntry) ? undefined : 'did not list desktop time',
  },
  {
    name: 'a source nothing came from lists nothing',
    as: 'owner',
    request: () => searchWhere({ source: 'manual' }),
    status: 200,
    check: (body) =>
      body[0].length === 0 ? undefined : `lists ${body[0].length} entries`,
  },
  {
    name: 'the phone is a source the search takes',
    as: 'owner',
    request: () => searchWhere({ source: 'mobile' }),
    status: 200,
    check: (body) =>
      body[0].length === 0 ? undefined : `lists ${body[0].length} entries`,
  },
  {
    name: 'a viewer cannot read an entry',
    as: 'viewer',
    request: (w) => ({ method: 'get', path: `/time/${w.oldEntry}` }),
    status: 403,
  },
  {
    name: 'a worker lists their own entries and nobody else’s',
    as: 'worker',
    request: search,
    status: 200,
    check: (body, world) =>
      entry(body, world.ownerEntry)
        ? 'lists the owner’s entry'
        : entry(body, world.oldEntry)
          ? undefined
          : 'does not list their own entry',
  },
  {
    name: 'a worker cannot remove the location of someone else’s entry',
    as: 'worker',
    request: (w) => ({
      method: 'delete',
      path: '/time/locations',
      body: { ids: [w.ownerEntry] },
    }),
    status: 403,
  },
  {
    name: 'a worker cannot read someone else’s entry',
    as: 'worker',
    request: (w) => ({ method: 'get', path: `/time/${w.ownerEntry}` }),
    status: 403,
  },
  {
    name: 'the owner lists everyone’s entries',
    as: 'owner',
    request: search,
    status: 200,
    check: (body, world) =>
      entry(body, world.ownerEntry) && entry(body, world.oldEntry)
        ? undefined
        : 'does not list both',
  },
  {
    name: 'an outsider sees nothing',
    as: 'outsider',
    request: search,
    status: 200,
    check: (body) =>
      body[0].length === 0 ? undefined : `lists ${body[0].length} entries`,
  },
  {
    name: 'a closed project’s entries are not listed',
    as: 'worker',
    request: search,
    status: 200,
    check: (body, world) =>
      entry(body, world.closedEntry) ? 'lists the closed entry' : undefined,
  },

  // Project totals: SPEC.md "Who can see what"
  {
    name: 'a viewer’s all-time totals are the project’s time and nothing else',
    as: 'viewer',
    request: allTime,
    status: 200,
    check: (body, world) => rowIs({ minutes: 210 })(rowOf(body, world), world),
  },
  {
    name: 'a worker’s all-time totals count their own time and money',
    as: 'worker',
    request: allTime,
    status: 200,
    check: (body, world) =>
      rowIs({
        minutes: 180,
        minutesPaid: 30,
        minutesUnpaid: 150,
        rateHour: 60,
        earnedCents: 18000,
        // The paid invoice, and one hand-marked half hour at $60/h.
        paidCents: 6000,
        unpaidCents: 15000,
      })(moneyOf(rowOf(body, world)), world),
  },
  {
    name: 'the owner’s all-time totals count everyone',
    as: 'owner',
    request: allTime,
    status: 200,
    check: (body, world) =>
      rowIs({
        minutes: 210,
        minutesPaid: 30,
        minutesUnpaid: 180,
        rateHour: 60,
        earnedCents: 21000,
        paidCents: 6000,
        unpaidCents: 18000,
      })(moneyOf(rowOf(body, world)), world),
  },
  {
    name: 'an outsider reads no totals',
    as: 'outsider',
    request: allTime,
    status: 403,
  },
  {
    name: 'a viewer’s project read says their role and leaves out the rate',
    as: 'viewer',
    request: projectRead,
    status: 200,
    check: (body) => {
      const [project] = body[0]
      if (project?.role !== 'viewer') return `role is ${project?.role}`
      return 'rateHour' in project ? 'carries rateHour' : undefined
    },
  },
  ...(['owner', 'worker'] as const).map(
    (role): ContractScenario => ({
      name: `a ${role}’s project read says their role and carries the rate`,
      as: role,
      request: projectRead,
      status: 200,
      check: (body) => {
        const [project] = body[0]
        if (project?.role !== role) return `role is ${project?.role}`
        return Number(project.rateHour) === 60
          ? undefined
          : `rateHour is ${project.rateHour}`
      },
    }),
  ),

  // Reports: SPEC.md "Who can see what"
  {
    name: 'a viewer’s period totals are the project’s time and nothing else',
    as: 'viewer',
    request: overview,
    status: 200,
    check: (body, world) =>
      rowIs({ trackedSeconds: 12600 })(rowOf(body.totals, world), world),
  },
  {
    name: 'a worker’s period totals count their own time and money',
    as: 'worker',
    request: overview,
    status: 200,
    check: (body, world) => {
      const row = rowOf(body.totals, world)
      return row?.trackedSeconds === 10800 && row?.paidCents === 6000
        ? undefined
        : `tracked ${row?.trackedSeconds}, paid ${row?.paidCents}`
    },
  },
  {
    name: 'the owner’s period totals count everyone',
    as: 'owner',
    request: overview,
    status: 200,
    check: (body, world) => {
      const row = rowOf(body.totals, world)
      return row?.trackedSeconds === 12600 && row?.paidCents === 6000
        ? undefined
        : `tracked ${row?.trackedSeconds}, paid ${row?.paidCents}`
    },
  },
  // Invoiced time: GLOSSARY.md "Invoiced". A viewer's rows above already
  // carry nothing but the project's time.
  ...(['worker', 'owner'] as const).map(
    (role): ContractScenario => ({
      name: `a ${role}’s period totals say what is invoiced, and what of it is unpaid`,
      as: role,
      request: overview,
      status: 200,
      check: (body, world) => {
        const row = rowOf(body.totals, world)
        // A half hour on a requested invoice, and one un-marked by hand on a
        // paid one: unpaid is the entry's own state, not its invoice's.
        return row?.invoicedSeconds === 3600 &&
          row?.invoicedUnpaidSeconds === 3600
          ? undefined
          : `invoiced ${row?.invoicedSeconds}, of it unpaid ${row?.invoicedUnpaidSeconds}`
      },
    }),
  ),
  {
    name: 'invoiced time marked paid by hand is invoiced, and not unpaid',
    as: 'freeOwner',
    request: freeOverview,
    status: 200,
    check: (body, world) => {
      const row = (body.totals as Record<string, unknown>[]).find(
        (totals) => totals.projectId === world.freeProject,
      )
      return row?.trackedSeconds === 1800 &&
        row?.invoicedSeconds === 1800 &&
        row?.invoicedUnpaidSeconds === 0
        ? undefined
        : `tracked ${row?.trackedSeconds}, invoiced ${row?.invoicedSeconds}, of it unpaid ${row?.invoicedUnpaidSeconds}`
    },
  },

  // Hidden history: SPEC.md "What premium governs"
  {
    name: 'a free owner’s totals say from when their plan hides history, and that they can upgrade',
    as: 'freeOwner',
    request: freeOverview,
    status: 200,
    check: hidesHistory(true),
  },
  {
    name: 'a free owner’s agent report says the same',
    as: 'freeOwner',
    request: (w) => ({
      method: 'post',
      path: '/statistics/agents/daily',
      body: statistics({ projectIds: [w.freeProject] }),
    }),
    status: 200,
    check: hidesHistory(true),
  },
  {
    name: 'a period inside the free plan’s window hides nothing',
    as: 'freeOwner',
    request: (w) => ({
      method: 'post',
      path: '/statistics/overview',
      body: statistics({ projectIds: [w.freeProject], from: day(-7) }),
    }),
    status: 200,
    check: hidesNothing,
  },
  {
    name: 'a read by invoice hides nothing: an invoice keeps what it covers',
    as: 'freeOwner',
    request: (w) => ({
      method: 'post',
      path: '/statistics/overview',
      body: statistics({
        projectIds: [w.freeProject],
        invoiceId: w.freeInvoice,
      }),
    }),
    status: 200,
    check: hidesNothing,
  },
  ...(['owner', 'worker', 'viewer'] as const).map(
    (role): ContractScenario => ({
      name: `a Premium owner’s project hides nothing from its ${role}`,
      as: role,
      request: overview,
      status: 200,
      check: hidesNothing,
    }),
  ),
  {
    name: 'a Premium owner’s agent report hides nothing',
    as: 'owner',
    request: agentsDaily(),
    status: 200,
    check: hidesNothing,
  },

  // Agent time: SPEC.md "A worker's agents are the worker's"
  ...(['owner', 'worker'] as const).map(
    (role): ContractScenario => ({
      name: `a ${role} reads agent time by worker and agent`,
      as: role,
      request: agentsDaily(),
      status: 200,
      check: agentTimeIs((w) => [
        { agentId: w.agent, assistedSeconds: 1200, autonomousSeconds: 600 },
        { agentId: w.otherAgent, assistedSeconds: 0, autonomousSeconds: 600 },
      ]),
    }),
  ),
  {
    name: 'agent runs are counted over the period, and on the day each started',
    as: 'owner',
    request: agentsDaily(),
    status: 200,
    check: (body, w) =>
      rowsAre('runs', body.runs, [
        { product: 'claude-code', status: 'completed', count: 1 },
        { product: 'codex', status: 'failed', count: 1 },
      ]) ??
      rowsAre('runsDaily', body.runsDaily, [
        { day: utcDay(w.otherAgentRunFromUnix), status: 'failed', count: 1 },
        { day: utcDay(w.agentRunFromUnix), status: 'completed', count: 1 },
      ]),
  },
  {
    name: 'runs are counted by day even when agent time is cut by hour',
    as: 'owner',
    request: agentsDaily(() => ({ bucket: 'hour' })),
    status: 200,
    check: (body, w) =>
      (body.daily as { day: string }[]).every((row) =>
        /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(row.day),
      )
        ? rowsAre('runsDaily', body.runsDaily, [
            {
              day: utcDay(w.otherAgentRunFromUnix),
              status: 'failed',
              count: 1,
            },
            { day: utcDay(w.agentRunFromUnix), status: 'completed', count: 1 },
          ])
        : 'agent time is not keyed by hour',
  },
  {
    name: 'the agent filter narrows agent time and both run counts',
    as: 'owner',
    request: agentsDaily((w) => ({ agentIds: [w.otherAgent] })),
    status: 200,
    check: (body, w) =>
      agentTimeIs((world) => [
        {
          agentId: world.otherAgent,
          assistedSeconds: 0,
          autonomousSeconds: 600,
        },
      ])(body, w) ??
      rowsAre('runs', body.runs, [
        { product: 'codex', status: 'failed', count: 1 },
      ]) ??
      rowsAre('runsDaily', body.runsDaily, [
        { day: utcDay(w.otherAgentRunFromUnix), status: 'failed', count: 1 },
      ]),
  },
  {
    name: 'an empty agent filter narrows nothing',
    as: 'worker',
    request: agentsDaily(() => ({ agentIds: [] })),
    status: 200,
    check: (body) =>
      body.runs.length === 2 ? undefined : `counts ${body.runs.length} runs`,
  },
  {
    name: 'a viewer reads no agent time and no runs',
    as: 'viewer',
    request: agentsDaily(),
    status: 200,
    check: (body) =>
      rowsAre('daily', body.daily, []) ??
      rowsAre('runs', body.runs, []) ??
      rowsAre('runsDaily', body.runsDaily, []),
  },
  {
    name: 'the team report does not read the agent filter',
    as: 'owner',
    request: (w) => ({
      method: 'post',
      path: '/statistics/team',
      body: statistics({ projectIds: [w.project], agentIds: [w.otherAgent] }),
    }),
    status: 200,
    check: (body, w) => {
      const row = (
        body.rows as { userId: string; agentSeconds: number }[]
      ).find((person) => person.userId === w.workerId)
      return row?.agentSeconds === 2400
        ? undefined
        : `the worker has ${row?.agentSeconds} agent seconds, not 2400`
    },
  },

  // Shared reports: SPEC.md "A shared report is `Statistics` at a link"
  {
    name: 'an owner shares a span of everyone’s time, and it heads their list',
    as: 'owner',
    request: (w) => share({ projectIds: [w.project], title: '  March  ' }),
    status: 200,
    check: (body, w) =>
      viewIs(body, {
        title: 'March',
        ...contractSpan(),
        projectIds: [w.project],
        userIds: [],
        showAmounts: false,
        invoiceId: null,
        // Everyone's time is not the owner's own to bill.
        canInvoice: false,
      }),
    after: {
      as: 'owner',
      request: () => ({ method: 'get', path: '/report' }),
      status: 200,
      check: (body, w, first) =>
        rowsAre(
          'the list',
          (body as { id: string }[]).map((report) => report.id),
          [first.id, w.ownerReport.id],
        ),
    },
  },
  {
    name: 'an owner’s report of themself alone can be invoiced',
    as: 'owner',
    request: (w) => share({ projectIds: [w.project], userIds: [w.ownerId] }),
    status: 200,
    check: (body, w) =>
      viewIs(body, { userIds: [w.ownerId], canInvoice: true }),
  },
  {
    name: 'a worker shares their own time, which can be invoiced',
    as: 'worker',
    request: (w) => share({ projectIds: [w.project], showAmounts: true }),
    status: 200,
    check: (body) => viewIs(body, { showAmounts: true, canInvoice: true }),
  },
  {
    name: 'a worker cannot share someone else’s time',
    as: 'worker',
    request: (w) => share({ projectIds: [w.project], userIds: [w.ownerId] }),
    status: 403,
  },
  {
    name: 'a viewer shares the project’s time, which cannot be invoiced',
    as: 'viewer',
    request: (w) => share({ projectIds: [w.project] }),
    status: 200,
    check: (body) => viewIs(body, { canInvoice: false }),
  },
  {
    name: 'a viewer’s report leaves off the amounts they asked for',
    as: 'viewer',
    request: (w) => share({ projectIds: [w.project], showAmounts: true }),
    status: 200,
    check: (body) => viewIs(body, { showAmounts: false, canInvoice: false }),
  },
  {
    name: 'a viewer cannot share one person’s time',
    as: 'viewer',
    request: (w) => share({ projectIds: [w.project], userIds: [w.workerId] }),
    status: 403,
  },
  {
    name: 'an outsider cannot share a project they do not see',
    as: 'outsider',
    request: (w) => share({ projectIds: [w.project] }),
    status: 403,
  },
  {
    name: 'a report keeps the span and the project it was shared with',
    as: 'freeOwner',
    request: (w) => share({ projectIds: [w.freeProject], from: day(-7) }),
    status: 200,
    check: (body, w) =>
      viewIs(body, {
        ...contractSpan(7),
        projectIds: [w.freeProject],
        canInvoice: false,
      }),
  },
  {
    name: 'a report takes the spans statistics takes, and no longer ones',
    as: 'owner',
    request: (w) => share({ projectIds: [w.project], from: day(-400) }),
    status: 400,
  },
  {
    name: 'a report that names no project takes every project its sharer reads',
    as: 'owner',
    request: () => share({ projectIds: [] }),
    status: 200,
    check: (body, w) =>
      (body as { projectIds: string[] }).projectIds.includes(w.project)
        ? undefined
        : 'the owner’s project is not in the report',
  },
  {
    name: 'with a person filter, every project means the ones it applies to',
    as: 'owner',
    request: (w) => share({ userIds: [w.workerId] }),
    status: 200,
    check: (body, w) =>
      viewIs(body, { userIds: [w.workerId] }) ??
      ((body as { projectIds: string[] }).projectIds.includes(w.project)
        ? undefined
        : 'the owner’s project is not in the report'),
  },
  {
    name: 'filters that reach none of the sharer’s projects share nothing',
    as: 'worker',
    request: (w) => share({ userIds: [w.ownerId] }),
    status: 400,
  },
  {
    name: 'a report’s title carries no markup',
    as: 'owner',
    request: (w) => share({ projectIds: [w.project], title: '<b>March</b>' }),
    status: 400,
  },
  {
    name: 'nobody shares a report without signing in',
    as: 'anyone',
    request: (w) => share({ projectIds: [w.project] }),
    status: 401,
  },
  {
    name: 'the list is the sharer’s own, with what each report can still do',
    as: 'worker',
    request: () => ({ method: 'get', path: '/report' }),
    status: 200,
    check: (body, w) => {
      const reports = body as { id: string }[]
      const ids = reports.map((report) => report.id).sort()
      const own = [w.workerReport.id, w.invoicedReport.id].sort()
      if (JSON.stringify(ids) !== JSON.stringify(own))
        return `lists ${JSON.stringify(ids)}, not ${JSON.stringify(own)}`
      return (
        viewIs(
          reports.find((report) => report.id === w.workerReport.id),
          {
            token: w.workerReport.token,
            invoiceId: null,
            canInvoice: true,
          },
        ) ??
        viewIs(
          reports.find((report) => report.id === w.invoicedReport.id),
          { invoiceId: w.invoice, canInvoice: false },
        )
      )
    },
  },
  {
    name: 'someone who shared nothing lists nothing',
    as: 'outsider',
    request: () => ({ method: 'get', path: '/report' }),
    status: 200,
    check: (body) => rowsAre('the list', body, []),
  },

  // The link: open to anyone, read in the sharer's scope
  {
    name: 'anyone opens an owner’s link: everyone by name, agents, and amounts where switched on',
    as: 'anyone',
    request: (w) => open(w.ownerReport),
    status: 200,
    check: (body, w) =>
      reportIs(body, w, {
        // Seven half hours at $60, and the attached agent's half hour at $12.
        people: { [w.workerId]: 10800, [w.ownerId]: 1800 },
        agents: { [w.agent]: 1800, [w.otherAgent]: 600 },
        amounts: { peopleCents: 21000, agentsCents: 600 },
      }) ??
      ((body.agents as { id: string; name: string }[]).find(
        (agent) => agent.id === w.agent,
      )?.name === 'claude-code'
        ? undefined
        : 'the agent is not named as its worker names it'),
  },
  {
    name: 'a signed-in stranger opens the same link and reads the same',
    as: 'outsider',
    request: (w) => open(w.ownerReport),
    status: 200,
    check: (body, w) =>
      reportIs(body, w, {
        people: { [w.workerId]: 10800, [w.ownerId]: 1800 },
        agents: { [w.agent]: 1800, [w.otherAgent]: 600 },
        amounts: { peopleCents: 21000, agentsCents: 600 },
      }),
  },
  {
    name: 'a worker’s link shows their own time and agents, and no amounts unless switched on',
    as: 'anyone',
    request: (w) => open(w.workerReport),
    status: 200,
    check: (body, w) =>
      reportIs(body, w, {
        people: { [w.workerId]: 10800 },
        agents: { [w.agent]: 1800, [w.otherAgent]: 600 },
      }),
  },
  {
    name: 'a viewer’s link shows the project’s time, with nobody, no agent and no amounts in it',
    as: 'anyone',
    request: (w) => open(w.viewerReport),
    status: 200,
    check: (body, w) => reportIs(body, w, { total: 12600 }),
  },
  {
    name: 'a deleted report’s link is not found',
    as: 'anyone',
    request: (w) => open(w.deletedReport),
    status: 404,
  },
  {
    name: 'a link that never was one is not found',
    as: 'anyone',
    request: () => open({ token: 'A'.repeat(43) }),
    status: 404,
  },
  {
    name: 'a report’s id does not open it',
    as: 'owner',
    request: (w) => open({ token: w.ownerReport.id }),
    status: 404,
  },
  {
    name: 'a free plan’s report that reaches past 14 days is gone, and says why',
    as: 'anyone',
    request: (w) => open(w.freeReport),
    status: 410,
    check: (body) =>
      body.reason === 'retention'
        ? undefined
        : `reason is ${JSON.stringify(body.reason)}`,
  },
  {
    name: 'a free plan’s report inside its window opens',
    as: 'anyone',
    request: (w) => open(w.freeRecentReport),
    status: 200,
    check: (body, w) => {
      const rows = body.daily as { projectId: string; trackedSeconds: number }[]
      return rows.length === 1 &&
        rows[0].projectId === w.freeProject &&
        rows[0].trackedSeconds === 1800
        ? undefined
        : `daily is ${JSON.stringify(rows)}`
    },
  },

  // Ending a link, and billing a report
  {
    name: 'the sharer deletes a report, and its link is not found',
    as: 'worker',
    request: (w) => ({
      method: 'delete',
      path: `/report/${w.workerReport.id}`,
    }),
    status: 204,
    after: {
      as: 'anyone',
      request: (w) => open(w.workerReport),
      status: 404,
    },
  },
  {
    name: 'a deleted report leaves its sharer’s list',
    as: 'worker',
    request: (w) => ({
      method: 'delete',
      path: `/report/${w.invoicedReport.id}`,
    }),
    status: 204,
    after: {
      as: 'worker',
      request: () => ({ method: 'get', path: '/report' }),
      status: 200,
      check: (body, w) =>
        rowsAre(
          'the list',
          (body as { id: string }[]).map((report) => report.id),
          [w.workerReport.id],
        ),
    },
  },
  {
    name: 'only its sharer deletes a report',
    as: 'owner',
    request: (w) => ({
      method: 'delete',
      path: `/report/${w.workerReport.id}`,
    }),
    status: 403,
    after: {
      as: 'anyone',
      request: (w) => open(w.workerReport),
      status: 200,
    },
  },
  {
    name: 'a report that was deleted cannot be deleted again',
    as: 'worker',
    request: (w) => ({
      method: 'delete',
      path: `/report/${w.deletedReport.id}`,
    }),
    status: 404,
  },
  {
    name: 'a report of the sharer’s own time is invoiced, and remembers its invoice',
    as: 'worker',
    request: (w) => invoiceOf(w.workerReport),
    status: 200,
    check: (body, w) =>
      typeof body.id === 'string' && body.id !== w.invoice
        ? rowsAre('the answer’s keys', Object.keys(body), ['id'])
        : `the invoice is ${JSON.stringify(body.id)}`,
    after: {
      as: 'worker',
      request: () => ({ method: 'get', path: '/report' }),
      status: 200,
      check: (body, w, first) =>
        viewIs(
          (body as { id: string }[]).find(
            (report) => report.id === w.workerReport.id,
          ),
          { invoiceId: first.id, canInvoice: false },
        ),
    },
  },
  {
    name: 'the invoice made from a report is the sharer’s to read',
    as: 'worker',
    request: (w) => invoiceOf(w.workerReport),
    status: 200,
    after: {
      as: 'worker',
      request: (_w, first) => ({ method: 'get', path: `/invoice/${first.id}` }),
      status: 200,
      check: (body, w) =>
        body.project?.id === w.project && body.state === 'Requested'
          ? undefined
          : `the invoice is on ${body.project?.id}, ${body.state}`,
    },
  },
  {
    name: 'asked twice, a report answers with the one invoice',
    as: 'worker',
    request: (w) => invoiceOf(w.workerReport),
    status: 200,
    after: {
      as: 'worker',
      request: (w) => invoiceOf(w.workerReport),
      status: 200,
      check: (body, _w, first) =>
        body.id === first.id
          ? undefined
          : `a second invoice ${body.id}, not ${first.id}`,
    },
  },
  {
    name: 'a report that has an invoice answers with it',
    as: 'worker',
    request: (w) => invoiceOf(w.invoicedReport),
    status: 200,
    check: (body, w) =>
      body.id === w.invoice
        ? undefined
        : `the invoice is ${body.id}, not ${w.invoice}`,
  },
  {
    name: 'a report of everyone’s time cannot be invoiced',
    as: 'owner',
    request: (w) => invoiceOf(w.ownerReport),
    status: 400,
  },
  {
    name: 'a viewer’s report cannot be invoiced',
    as: 'viewer',
    request: (w) => invoiceOf(w.viewerReport),
    status: 400,
  },
  {
    name: 'only its sharer invoices a report',
    as: 'owner',
    request: (w) => invoiceOf(w.workerReport),
    status: 403,
  },

  {
    name: 'a viewer cannot read window titles',
    as: 'viewer',
    request: (w) => ({
      method: 'post',
      path: '/statistics/apps/titles',
      body: statistics({ projectIds: [w.project] }),
    }),
    status: 403,
  },
  {
    name: 'a worker cannot read the workers report',
    as: 'worker',
    request: (w) => ({
      method: 'post',
      path: '/statistics/apps/workers',
      body: statistics({ projectIds: [w.project] }),
    }),
    status: 403,
  },
  {
    name: 'the owner reads the workers report',
    as: 'owner',
    request: (w) => ({
      method: 'post',
      path: '/statistics/apps/workers',
      body: statistics({ projectIds: [w.project] }),
    }),
    status: 200,
  },
  {
    name: 'a viewer cannot read figures by invoice',
    as: 'viewer',
    request: (w) => ({
      method: 'post',
      path: '/statistics/overview',
      body: statistics({ projectIds: [w.project], invoiceId: w.invoice }),
    }),
    status: 403,
  },
]

/** Runs one scenario on a fresh world; returns what went wrong, or nothing. */
export async function runScenario(
  adapter: ContractAdapter,
  scenario: ContractScenario,
): Promise<string | undefined> {
  const world = await adapter.seed()
  const response = await adapter.send(scenario.as, scenario.request(world))

  if (response.status !== scenario.status) {
    return `status ${response.status}, not ${scenario.status}: ${JSON.stringify(response.body)?.slice(0, 200)}`
  }

  const wrong = scenario.check?.(response.body, world)

  if (wrong || !scenario.after) return wrong

  const { after } = scenario
  const second = await adapter.send(
    after.as,
    after.request(world, response.body),
  )

  if (second.status !== after.status) {
    return `afterwards, status ${second.status}, not ${after.status}: ${JSON.stringify(second.body)?.slice(0, 200)}`
  }

  const stillWrong = after.check?.(second.body, world, response.body)

  return stillWrong && `afterwards, ${stillWrong}`
}
