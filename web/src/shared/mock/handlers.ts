/**
 * Every API route the web calls, answered from the demo database. Each
 * handler goes through `route`, which applies the network settings, the
 * session and the API's error statuses, so a handler only says what the API
 * would answer.
 */
import {
  canonicalAddress,
  FREE_PLAN_WORKERS,
} from '@work-address/statistics-core'
import { http, HttpResponse, delay, type HttpHandler } from 'msw'

import { issueInvoice, setInvoiceState } from './billing'
import { settleHistory } from './kept-history'
import {
  listReports,
  openReport,
  ownReport,
  reportPeriod,
  reportView,
  shareReport,
} from './reports'
import { DEMO_ACCESS_TOKEN, DEMO_REFRESH_TOKEN, signInDemo } from './session'
import {
  readDemoSettings,
  writeDemoSettings,
  type DemoSignIn,
} from './settings'
import {
  accessOn,
  canListEntry,
  hasDetail,
  isInvoiced,
  isOwner,
  isPublished,
  listedWorkers,
  projectOf,
  shapeInvoice,
  shapeProject,
  shapeRun,
  shapeTime,
  shapeUser,
  trackingOf,
  userOf,
  visibleProjects,
} from './shape'
import {
  agentsDaily,
  apps,
  DemoHttpError,
  insightsMe,
  overview,
  projectFigures,
  reportRefused,
  statisticsScope,
  team,
  timeDaily,
  timeHourly,
  type StatisticsQuery,
} from './statistics'
import { demoDb, removeRows, saveRow } from './store'
import { ownAgents, teamOf } from './team'

import type { Db, MockInvoice, MockProject, MockTime, MockUser } from './db'

/** `AGENT_PRODUCTS` in the API's model/agent.ts. */
const AGENT_PRODUCTS = new Set([
  'claude-code',
  'codex',
  'cursor',
  'gemini-cli',
  'copilot',
  'windsurf',
  'cline',
  'minimax',
  'devin-local',
  'claude-cowork',
  'kimi-code',
  'kimi-cli',
  'openclaw',
  'hermes',
  'opencode',
])

type Ctx = {
  request: Request
  params: Record<string, string>
  body: Record<string, unknown>
  db: Db
  meId: string
  /** The signed-in user; set on every route that needs a session. */
  me: MockUser
}

type Handler = (ctx: Ctx) => unknown

const NETWORK_DELAY = { instant: 0, fast: 120, slow: 1600 } as const

const api = (path: string) => `*/api${path}`

const fail = (status: number, message: string) => {
  throw new DemoHttpError(status, message)
}

const isSignedIn = (request: Request) =>
  !readDemoSettings().signedOut &&
  request.headers.get('authorization') === DEMO_ACCESS_TOKEN

function route(
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  handler: Handler,
  { auth = true }: { auth?: boolean } = {},
): HttpHandler {
  return http[method](api(path), async ({ request, params }) => {
    const settings = readDemoSettings()
    await delay(NETWORK_DELAY[settings.network.speed])
    if (settings.network.failNext) {
      writeDemoSettings({ network: { ...settings.network, failNext: false } })
      return HttpResponse.json(
        { message: 'Demo: the next request fails' },
        { status: 500 },
      )
    }
    if (settings.network.failure === 'all') {
      return HttpResponse.json(
        { message: 'Demo: every request fails' },
        { status: 500 },
      )
    }
    const db = demoDb()
    // Every read shows what the projects still keep, as on the API.
    settleHistory(db)
    if (auth && !isSignedIn(request)) {
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    let body: Record<string, unknown> = {}
    if (method !== 'get') {
      try {
        body = (await request.json()) as Record<string, unknown>
      } catch {
        body = {}
      }
    }
    try {
      const result = await handler({
        request,
        params: params as Record<string, string>,
        body: body ?? {},
        db,
        meId: db.meId,
        me: userOf(db, db.meId)!,
      })
      return result instanceof Response
        ? result
        : HttpResponse.json(result ?? null)
    } catch (error) {
      if (error instanceof DemoHttpError) {
        return HttpResponse.json(
          {
            message: error.message,
            // The name the API gives a missing record: it is what the pages
            // tell "not found" from "failed" by (getLoadFailureKind).
            name: error.status === 404 ? 'NotFoundError' : 'DemoError',
            ...(error.reason ? { reason: error.reason } : {}),
          },
          { status: error.status },
        )
      }
      throw error
    }
  })
}

const withTokens = (body: unknown) =>
  HttpResponse.json(body as never, {
    headers: {
      Authorization: DEMO_ACCESS_TOKEN,
      'Refresh-Token': DEMO_REFRESH_TOKEN,
      'Access-Control-Expose-Headers': 'Authorization, Refresh-Token',
    },
  })

/** `[items, total]` for a search page, as every search route answers. */
const page = <T>(items: T[], body: Record<string, unknown>) => {
  const limit = Number(body.limit) || 20
  const index = Number(body.page) || 0
  return [items.slice(index * limit, (index + 1) * limit), items.length]
}

const compare = (a: unknown, b: unknown) =>
  a === b
    ? 0
    : a === null || a === undefined
      ? 1
      : b === null || b === undefined
        ? -1
        : a < b
          ? -1
          : 1

function sortBy<T>(
  rows: T[],
  sort: unknown,
  read: (row: T, key: string) => unknown,
) {
  const [key, direction] =
    Object.entries((sort ?? {}) as Record<string, string>)[0] ?? []
  if (!key) {
    return rows
  }
  const sign = direction === 'DESC' ? -1 : 1
  return [...rows].sort((a, b) => sign * compare(read(a, key), read(b, key)))
}

const userByAddress = (db: Db, address: string) =>
  db.users.find((user) => user.address.toLowerCase() === address.toLowerCase())

/** Collaborator addresses as users, adding someone new for an unknown address. */
function idsForAddresses(db: Db, addresses: unknown): string[] {
  if (!Array.isArray(addresses)) {
    return []
  }
  return addresses.map((address: string) => {
    const known = userByAddress(db, address)
    if (known) {
      return known.id
    }
    const now = new Date().toISOString()
    return saveRow('users', {
      ...userOf(db, db.meId)!,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      address,
      name: '',
      email: null,
      premium: false,
    }).id
  })
}

/** The owner's workers and which of them their plan lets record: `Plan.trackingWorkers`. */
function trackingWorkersOf(db: Db, ownerId: string) {
  const listed = listedWorkers(db, ownerId)
  const tracking = trackingOf(db, ownerId)

  return {
    limited: !userOf(db, ownerId)?.premium && listed.length > FREE_PLAN_WORKERS,
    limit: FREE_PLAN_WORKERS,
    workers: listed.map((id) => {
      const worker = userOf(db, id)

      return {
        address: worker?.address ?? id,
        name: worker?.name || null,
        connected: true,
        tracking: tracking.has(canonicalAddress(id)),
      }
    }),
  }
}

const PROJECT_FIELDS = [
  'title',
  'text',
  'rateHour',
  'state',
  'trackScreenshots',
  'trackProcesses',
  'trackAgents',
  'trackWindowTitles',
  'trackBrowserDomains',
  'allowManualTime',
  'allowMobileTime',
  'trackLocation',
  'reviewWindowHours',
  'screenshotRetentionDays',
] as const

function applyProjectBody(
  db: Db,
  project: MockProject,
  body: Record<string, unknown>,
) {
  for (const field of PROJECT_FIELDS) {
    if (field in body) {
      ;(project as Record<string, unknown>)[field] = body[field]
    }
  }
  if (typeof project.rateHour === 'number') {
    project.rateHour = Number(project.rateHour).toFixed(2)
  }
  // As the API: phone tracking always records location, whatever is sent.
  project.trackLocation = project.allowMobileTime === true
  if ('workerAddresses' in body) {
    project.workerIds = idsForAddresses(db, body.workerAddresses)
  }
  if ('viewerAddresses' in body) {
    project.viewerIds = idsForAddresses(db, body.viewerAddresses)
  }
  project.updatedAt = new Date().toISOString()
  return project
}

const visibleTimes = (db: Db, meId: string) =>
  db.times.filter((time) => canListEntry(db, time, meId))

const DETAIL_FILTERS = [
  'screenshot',
  'withScreenshots',
  'withProcesses',
  'note',
  'keyboardKeysFrom',
  'keyboardKeysTo',
  'minutesActiveFrom',
  'minutesActiveTo',
  'mouseKeysFrom',
  'mouseKeysTo',
  'mouseDistanceFrom',
  'mouseDistanceTo',
]

/** Whether a list filter lets this id through; an empty list narrows nothing. */
const among = (list: unknown, id: string) =>
  !Array.isArray(list) || list.length === 0 || list.includes(id)

function searchTimes({ db, meId, body }: Ctx) {
  const filter = (body.filter ?? {}) as Record<string, unknown>
  const has = (key: string) => filter[key] !== undefined && filter[key] !== null
  const needsDetail = DETAIL_FILTERS.some(has)
  const range = (value: number | null, key: string) =>
    (!has(`${key}From`) ||
      (value ?? -Infinity) >= Number(filter[`${key}From`])) &&
    (!has(`${key}To`) || (value ?? Infinity) <= Number(filter[`${key}To`]))
  const rows = visibleTimes(db, meId).filter((time) => {
    const project = projectOf(db, time.projectId)!
    if (project.state !== 'Active') {
      return false
    }
    if (needsDetail && !hasDetail(time, project, meId)) {
      return false
    }
    if (has('projectId') && time.projectId !== filter.projectId) {
      return false
    }
    if (
      !among(filter.projectIds, time.projectId) ||
      !among(filter.userIds, time.userId)
    ) {
      return false
    }
    if (has('source') && time.source !== filter.source) {
      return false
    }
    if (
      has('fromAt') &&
      Date.parse(time.fromAt) < Date.parse(String(filter.fromAt))
    ) {
      return false
    }
    if (
      has('toAt') &&
      Date.parse(time.toAt) > Date.parse(String(filter.toAt))
    ) {
      return false
    }
    if (
      has('note') &&
      !(time.note ?? '')
        .toLowerCase()
        .includes(String(filter.note).toLowerCase())
    ) {
      return false
    }
    if (
      has('withScreenshots') &&
      Boolean(filter.withScreenshots) !== (time.screenshot !== null)
    ) {
      return false
    }
    if (
      has('withProcesses') &&
      Boolean(filter.withProcesses) !== time.apps.length > 0
    ) {
      return false
    }
    return (
      range(time.minutesActive, 'minutesActive') &&
      range(time.keyboardKeys, 'keyboardKeys') &&
      range(time.mouseKeys, 'mouseKeys') &&
      range(time.mouseDistance, 'mouseDistance')
    )
  })
  const sorted = sortBy(rows, body.sort, (time, key) =>
    key === 'projectName'
      ? projectOf(db, time.projectId)?.title
      : key === 'paidStatus'
        ? time.isPaid
        : key === 'screenshot'
          ? time.screenshot
          : (time as Record<string, unknown>)[key],
  )
  const [items, total] = page(sorted, body)
  return [(items as MockTime[]).map((time) => shapeTime(db, time, meId)), total]
}

/** SPEC.md "An invoiced entry keeps its detail": the whole batch is refused. */
function keepInvoiced(db: Db, times: MockTime[]) {
  if (times.some((time) => isInvoiced(db, time))) {
    fail(
      400,
      'This time is on an invoice, so its detail stays unless the invoice is rejected',
    )
  }
}

/** Entries the reader may change: their own record, nobody else's. */
function editableTimes(db: Db, meId: string, ids: unknown) {
  const wanted = new Set(Array.isArray(ids) ? (ids as string[]) : [])
  const rows = db.times.filter((time) => wanted.has(time.id))
  for (const time of rows) {
    if (time.userId !== meId) {
      fail(403, 'Access denied')
    }
  }
  return rows
}

const visibleInvoices = (db: Db, meId: string) =>
  db.invoices.filter((invoice) => {
    const project = db.projects.find((p) => p.id === invoice.projectId)
    return invoice.userId === meId || (project && isOwner(project, meId))
  })

function rejectableInvoice(db: Db, meId: string, id: string) {
  const invoice = db.invoices.find((i) => i.id === id)
  const project = invoice && db.projects.find((p) => p.id === invoice.projectId)
  if (!invoice || !project) {
    fail(404, 'Invoice not found')
  }
  if (!isOwner(project!, meId)) {
    fail(403, 'Only the project owner may reject an invoice')
  }
  if (invoice!.state !== 'Requested') {
    fail(400, 'Only a requested invoice can be rejected')
  }
  return invoice!
}

function settleableInvoice(db: Db, meId: string, id: string) {
  const invoice = db.invoices.find((i) => i.id === id)
  if (!invoice) {
    fail(404, 'Invoice not found')
  }
  if (invoice!.userId !== meId) {
    fail(403, 'Only the person who issued an invoice may change its payment')
  }
  if (invoice!.state === 'REJECTED') {
    fail(400, 'A rejected invoice cannot be paid')
  }
  return invoice!
}

const statistics = (
  path: string,
  answer: (ctx: Ctx, query: StatisticsQuery) => unknown,
) => route('post', path, (ctx) => answer(ctx, ctx.body as StatisticsQuery))

/** How the API answers each Google failure the demo can be set to. */
const DEMO_GOOGLE_REFUSALS: Partial<
  Record<DemoSignIn, { name: string; status: number }>
> = {
  'google-email-taken': { name: 'GoogleEmailTakenException', status: 401 },
  'google-email-unverified': {
    name: 'GoogleEmailUnverifiedException',
    status: 401,
  },
  'google-invalid': { name: 'AuthenticationException', status: 401 },
  'google-unavailable': { name: 'GoogleUnavailableException', status: 503 },
}

const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

/** What `AgentDto` lets through, or null: the API answers anything else 400. */
function agentDraft(body: Record<string, unknown>) {
  const { name, slug, product, isDefault, bindings } = body
  const valid =
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 60 &&
    !/[<>]/.test(name) &&
    [...name].every((char) => char.charCodeAt(0) > 31) &&
    typeof slug === 'string' &&
    /^[\da-z][\da-z-]{0,59}$/.test(slug) &&
    typeof product === 'string' &&
    AGENT_PRODUCTS.has(product) &&
    typeof isDefault === 'boolean' &&
    Array.isArray(bindings) &&
    bindings.every((id) => typeof id === 'string' && UUID.test(id)) &&
    new Set(bindings).size === bindings.length

  return valid
    ? {
        name: name as string,
        slug: slug as string,
        product: product as string,
        isDefault: isDefault as boolean,
        bindings: (bindings as string[]).map((id) => id.toLowerCase()),
      }
    : null
}

export const handlers: HttpHandler[] = [
  // Auth: any sign-in signs in as the demo's chosen role.
  // Like the API it never refuses: a token that identifies nobody gets nothing.
  route(
    'get',
    '/auth/status',
    ({ me, request }) =>
      isSignedIn(request)
        ? shapeUser(me)
        : new HttpResponse(null, { status: 200 }),
    { auth: false },
  ),
  route('post', '/auth/nonce', () => crypto.randomUUID(), {
    auth: false,
  }),
  // The demo panel picks what the sign-in screen meets. Its made-up client IDs
  // stop at the demo's stand-in for Google's button.
  route(
    'get',
    '/auth/methods',
    () => {
      const { signIn } = readDemoSettings()

      if (signIn === 'methods-failed') {
        return HttpResponse.json(
          { message: 'Demo: sign-in methods fail' },
          { status: 500 },
        )
      }

      if (signIn === 'wallet-only') {
        return {}
      }

      return {
        googleClientId:
          signIn === 'script-failed' ? 'demo-script-failed' : 'demo-client-id',
      }
    },
    { auth: false },
  ),
  route(
    'post',
    '/auth/eth',
    ({ db }) => {
      signInDemo()
      return withTokens(shapeUser(userOf(db, db.meId)!))
    },
    { auth: false },
  ),
  route(
    'post',
    '/auth/google',
    ({ db }) => {
      const refusal = DEMO_GOOGLE_REFUSALS[readDemoSettings().signIn]

      if (refusal) {
        return HttpResponse.json(
          { name: refusal.name, message: `Demo: ${refusal.name}` },
          { status: refusal.status },
        )
      }

      signInDemo()
      return withTokens(shapeUser(userOf(db, db.meId)!))
    },
    { auth: false },
  ),
  route(
    'post',
    '/auth/refresh',
    () =>
      readDemoSettings().signedOut
        ? HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
        : withTokens({}),
    { auth: false },
  ),
  route(
    'get',
    '/auth/timeTracker/:nonce',
    ({ params }) => ({ nonce: params.nonce }),
    { auth: false },
  ),
  route('post', '/auth/timeTracker/:nonce/connect', () => ({
    connected: true,
  })),

  // Profile.
  route('get', '/user/tracking-workers', ({ db, meId }) =>
    trackingWorkersOf(db, meId),
  ),
  route('put', '/user/tracking-workers', ({ db, me, meId, body }) => {
    const listed = listedWorkers(db, meId)
    const kept = ((body.addresses ?? []) as string[]).map(
      (address) => userByAddress(db, address)?.id ?? address,
    )
    if (kept.some((id) => !listed.includes(id))) {
      fail(400, 'Everyone kept must be a contributor on your projects')
    }
    saveRow('users', { ...me, keptWorkers: kept })
    return trackingWorkersOf(db, meId)
  }),
  route('get', '/user/:id', ({ db, params }) => {
    const user = userOf(db, params.id)
    if (!user) {
      fail(404, 'User does not exist')
    }
    return shapeUser(user!)
  }),
  route('put', '/user', ({ me, body }) => {
    const { id: _id, address: _a, roles: _r, premium: _p, ...fields } = body
    return shapeUser(
      saveRow('users', {
        ...me,
        ...fields,
        updatedAt: new Date().toISOString(),
      } as MockUser),
    )
  }),

  // Projects.
  route('post', '/project/search', ({ db, meId, body }) => {
    const filter = (body.filter ?? {}) as Record<string, unknown>
    const rows = visibleProjects(db, meId).filter(
      (p) =>
        (!filter.state || p.state === filter.state) &&
        (!filter.projectId || p.id === filter.projectId) &&
        (!filter.userId || p.ownerId === filter.userId) &&
        (!filter.title ||
          p.title.toLowerCase().includes(String(filter.title).toLowerCase())),
    )
    const [items, total] = page(
      sortBy(rows, body.sort, (p, key) => (p as Record<string, unknown>)[key]),
      body,
    )
    return [
      (items as MockProject[]).map((p) => shapeProject(db, p, meId)),
      total,
    ]
  }),
  route('post', '/project', ({ db, meId, body }) => {
    const now = new Date().toISOString()
    const project = applyProjectBody(
      db,
      {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        title: '',
        text: '',
        rateHour: '0.00',
        state: 'Active',
        ownerId: meId,
        workerIds: [],
        viewerIds: [],
        trackScreenshots: false,
        trackProcesses: false,
        trackAgents: false,
        trackWindowTitles: false,
        trackBrowserDomains: false,
        allowManualTime: false,
        allowMobileTime: false,
        trackLocation: false,
        reviewWindowHours: 24,
        screenshotRetentionDays: null,
        deletedAt: null,
      },
      body,
    )
    return shapeProject(db, saveRow('projects', project), meId)
  }),
  route('put', '/project/:id', ({ db, meId, params, body }) => {
    const project = projectOf(db, params.id)
    if (!project) {
      fail(404, 'Project not found')
    }
    if (!isOwner(project!, meId)) {
      fail(403, 'Access denied')
    }
    return shapeProject(
      db,
      saveRow('projects', applyProjectBody(db, { ...project! }, body)),
      meId,
    )
  }),
  route('delete', '/project/:id', ({ db, meId, params }) => {
    const project = projectOf(db, params.id)
    if (!project) {
      fail(404, 'Project not found')
    }
    if (!isOwner(project!, meId)) {
      fail(403, 'Access denied')
    }
    saveRow('projects', { ...project!, deletedAt: new Date().toISOString() })
    return { success: true }
  }),
  route('get', '/project/:id/stats/:period', ({ db, meId, params }) => {
    const project = projectOf(db, params.id)
    if (!project || !accessOn(db, project, meId).reads) {
      fail(403, 'Access denied')
    }
    const days = { '7D': 7, '1M': 30, '1Y': 365 }[params.period] ?? 30
    const since = Date.now() - days * 86_400_000
    const byApp = new Map<string, number>()
    for (const time of db.times) {
      if (time.projectId !== params.id || Date.parse(time.fromAt) < since) {
        continue
      }
      // A worker reads their own; the owner and viewers what is published.
      const shared = accessOn(db, project!, meId).lists !== 'own'
      if (time.userId !== meId && !(shared && isPublished(time, project!))) {
        continue
      }
      for (const app of time.apps) {
        byApp.set(app.name, (byApp.get(app.name) ?? 0) + app.seconds)
      }
    }
    return [...byApp]
      .sort((a, b) => b[1] - a[1])
      .map(([processName, seconds]) => ({
        processName,
        timeMin: seconds / 60,
        period: params.period,
      }))
  }),

  // Time.
  route('post', '/time/search', searchTimes),
  route('get', '/time/totals/:id/project', ({ db, meId, params }) => {
    const project = projectOf(db, params.id)
    if (!project || !accessOn(db, project, meId).reads) {
      fail(403, 'Access denied')
    }
    const minutes = (value: unknown) =>
      value === undefined ? undefined : Math.round(Number(value) / 60)
    return projectFigures(db, meId, [project!]).map((row) => ({
      projectId: row.projectId,
      minutes: minutes(row.trackedSeconds),
      rateHour: row.rateHour,
      minutesActive: minutes(row.activeSeconds),
      minutesPaid: minutes(row.paidSeconds),
      minutesUnpaid: minutes(row.unpaidSeconds),
      keyboardKeys: row.keyboardKeys,
      mouseKeys: row.mouseKeys,
      mouseDistance: row.mouseDistance,
      earnedCents: row.earnedCents,
      paidCents: row.paidCents,
      unpaidCents: row.unpaidCents,
    }))
  }),
  route('get', '/time/:id', ({ db, meId, params }) => {
    const time = db.times.find((row) => row.id === params.id)
    if (!time || !canListEntry(db, time, meId)) {
      fail(403, 'Access denied')
    }
    return shapeTime(db, time!, meId)
  }),
  route('put', '/time/:id', ({ db, meId, params, body }) => {
    const [time] = editableTimes(db, meId, [params.id])
    if (!time) {
      fail(404, 'Time not found')
    }
    if ('note' in body && (body.note ?? '') !== (time.note ?? '')) {
      keepInvoiced(db, [time])
    }
    return shapeTime(
      db,
      saveRow('times', {
        ...time,
        note: 'note' in body ? (body.note as string | null) : time.note,
        isPaid: 'isPaid' in body ? Boolean(body.isPaid) : time.isPaid,
        updatedAt: new Date().toISOString(),
      }),
      meId,
    )
  }),
  route('delete', '/time', ({ db, meId, body }) => {
    const rows = editableTimes(db, meId, body.ids)
    keepInvoiced(db, rows)
    removeRows(
      'times',
      rows.map((t) => t.id),
    )
    return { success: true }
  }),
  ...(['paid', 'unpaid'] as const).map((state) =>
    route('post', `/time/${state}`, ({ db, meId, body }) => {
      for (const time of editableTimes(db, meId, body.ids)) {
        saveRow('times', { ...time, isPaid: state === 'paid' })
      }
      return { success: true }
    }),
  ),
  route('delete', '/time/screenshots', ({ db, meId, body }) => {
    const rows = editableTimes(db, meId, body.ids)
    keepInvoiced(db, rows)
    for (const time of rows) {
      saveRow('times', { ...time, screenshot: null })
    }
    return { success: true }
  }),
  route('delete', '/time/locations', ({ db, meId, body }) => {
    const rows = editableTimes(db, meId, body.ids)
    keepInvoiced(db, rows)
    for (const time of rows) {
      saveRow('times', {
        ...time,
        locations: [],
        locationStatus:
          time.source === 'mobile' ? 'removed' : time.locationStatus,
      })
    }
    return { success: true }
  }),
  route('delete', '/time/processes', ({ db, meId, body }) => {
    const rows = editableTimes(db, meId, body.ids)
    keepInvoiced(db, rows)
    for (const time of rows) {
      saveRow('times', { ...time, apps: [] })
    }
    return { success: true }
  }),

  // Invoices.
  route('post', '/invoice/search', ({ db, meId, body }) => {
    const filter = (body.filter ?? {}) as Record<string, unknown>
    const rows = visibleInvoices(db, meId).filter(
      (i) =>
        (!filter.projectId || i.projectId === filter.projectId) &&
        (!filter.state || i.state === filter.state) &&
        (!filter.fromAt ||
          new Date(i.fromAt) >= new Date(filter.fromAt as string)) &&
        (!filter.toAt || new Date(i.toAt) <= new Date(filter.toAt as string)) &&
        (filter.amountFrom === undefined ||
          i.amountCents >= (filter.amountFrom as number)) &&
        (filter.amountTo === undefined ||
          i.amountCents <= (filter.amountTo as number)),
    )
    const [items, total] = page(
      sortBy(rows, body.sort, (i, key) => {
        // The two the API sorts from a joined table rather than a column.
        if (key === 'projectName') {
          return db.projects.find((p) => p.id === i.projectId)?.title
        }
        if (key === 'issuedBy') {
          const issuer = db.users.find((u) => u.id === i.userId)
          return issuer?.name || issuer?.address
        }
        return (i as Record<string, unknown>)[key]
      }),
      body,
    )
    return [
      (items as MockInvoice[]).map((i) => shapeInvoice(db, i, meId)),
      total,
    ]
  }),
  route('get', '/invoice/:id', ({ db, meId, params }) => {
    if (!db.invoices.some((i) => i.id === params.id)) {
      fail(404, 'Invoice not found')
    }
    const invoice = visibleInvoices(db, meId).find((i) => i.id === params.id)
    if (!invoice) {
      fail(403, 'Access denied')
    }
    return shapeInvoice(db, invoice!, meId, true)
  }),
  route('post', '/invoice/project/:projectId', ({ db, meId, params, body }) => {
    const project = projectOf(db, params.projectId)
    if (!project || !accessOn(db, project, meId).works) {
      fail(403, 'Access denied')
    }
    const invoice = issueInvoice(
      db,
      meId,
      project!,
      body as { timeIds?: string[]; fromUnix?: number; toUnix?: number },
    )
    return invoice ? shapeInvoice(db, invoice, meId) : null
  }),
  route('post', '/invoice/:id/reject', ({ db, meId, params, body }) =>
    shapeInvoice(
      db,
      setInvoiceState(
        db,
        rejectableInvoice(db, meId, params.id),
        'REJECTED',
        body.reason as string,
      ),
      meId,
    ),
  ),
  route('post', '/invoice/:id/paid', ({ db, meId, params }) =>
    shapeInvoice(
      db,
      setInvoiceState(db, settleableInvoice(db, meId, params.id), 'PAID'),
      meId,
    ),
  ),
  route('post', '/invoice/:id/unpaid', ({ db, meId, params }) =>
    shapeInvoice(
      db,
      setInvoiceState(db, settleableInvoice(db, meId, params.id), 'Requested'),
      meId,
    ),
  ),

  // Agent runs: everyone's on owned projects, one's own elsewhere.
  route('post', '/agent-tracking/search', ({ db, meId, body }) => {
    const projects = body.projectId
      ? [projectOf(db, String(body.projectId))].filter((p): p is MockProject =>
          Boolean(p && accessOn(db, p, meId).works),
        )
      : db.projects.filter((p) => !p.deletedAt && accessOn(db, p, meId).works)
    if (body.projectId && projects.length === 0) {
      fail(403, 'Forbidden')
    }
    const ids = new Set(projects.map((p) => p.id))
    const owned = new Set(
      projects.filter((p) => isOwner(p, meId)).map((p) => p.id),
    )
    const rows = db.runs
      .filter(
        (run) =>
          ids.has(run.projectId) &&
          (owned.has(run.projectId) || run.userId === meId),
      )
      .filter(
        (run) =>
          !body.fromAt ||
          Date.parse(run.toAt) >= Date.parse(String(body.fromAt)),
      )
      .filter(
        (run) =>
          !body.toAt || Date.parse(run.fromAt) < Date.parse(String(body.toAt)),
      )
      .sort((a, b) => b.fromAt.localeCompare(a.fromAt))
    const filters: [string, (run: ReturnType<typeof shapeRun>) => string][] = [
      ['userId', (run) => run.userId],
      ['agentId', (run) => run.agentId],
      ['mode', (run) => run.measurement.mode],
      ['status', (run) => run.status],
      ['sessionId', (run) => run.sourceSessionId],
      ['runKey', (run) => run.runKey],
    ]
    const shaped = rows
      .map((run) => shapeRun(db, run, meId))
      .filter((run) =>
        filters.every(
          ([key, value]) => body[key] == null || value(run) === body[key],
        ),
      )
    const offset = Number(body.offset) || 0
    return [shaped.slice(offset, offset + 100), shaped.length]
  }),
  route(
    'delete',
    '/agent-tracking/runs/:runKey/prompt',
    ({ db, meId, params }) => {
      const run = db.runs.find((row) => row.runKey === params.runKey)
      if (!run) {
        throw new DemoHttpError(404, 'RUN_NOT_FOUND')
      }
      if (run.userId !== meId) {
        fail(403, 'Forbidden')
      }
      if (run.invoiceId) {
        fail(409, 'RUN_INVOICED')
      }
      saveRow('runs', { ...run, prompt: null })
      return { success: true }
    },
  ),

  // Statistics, on the API's terms.
  statistics('/statistics/overview', ({ db, meId }, q) =>
    overview(statisticsScope(db, meId, q)),
  ),
  statistics('/statistics/apps/:kind', ({ db, meId, params }, q) => {
    const scope = statisticsScope(db, meId, q)
    if (scope.projects.length === 0) {
      return { rows: [] }
    }
    if (reportRefused(scope, params.kind)) {
      fail(403, 'Access denied')
    }
    return { rows: apps(scope, params.kind) }
  }),
  statistics('/statistics/time/daily', ({ db, meId }, q) => ({
    rows: timeDaily(statisticsScope(db, meId, q)),
  })),
  statistics('/statistics/time/hourly', ({ db, meId }, q) =>
    timeHourly(db, meId, q),
  ),
  statistics('/statistics/insights/me', ({ db, meId }, q) =>
    insightsMe(db, meId, q),
  ),
  statistics('/statistics/agents/daily', ({ db, meId }, q) =>
    agentsDaily(statisticsScope(db, meId, q)),
  ),
  statistics('/statistics/team', ({ db, meId }, q) =>
    team(statisticsScope(db, meId, q)),
  ),

  // Shared reports. The link is open to anyone: no session is asked for.
  route('post', '/report', ({ db, meId, body }) => shareReport(db, meId, body)),
  route('get', '/report', ({ db, meId }) => listReports(db, meId)),
  route(
    'get',
    '/report/public/:token',
    ({ db, params }) => openReport(db, params.token),
    { auth: false },
  ),
  route('delete', '/report/:id', ({ db, meId, params }) => {
    removeRows('reports', [ownReport(db, meId, params.id).id])
    return new HttpResponse(null, { status: 204 })
  }),
  route('post', '/report/:id/invoice', ({ db, meId, params }) => {
    const report = ownReport(db, meId, params.id)
    const view = reportView(db, report)
    if (view.invoiceId) {
      return { id: view.invoiceId }
    }
    const project = projectOf(db, report.projectIds[0])
    if (!view.canInvoice || !project) {
      fail(400, 'Only a report of your own time on one project can be invoiced')
    }
    // The invoice is the period's, by the invoice's own rules.
    const invoice = issueInvoice(db, meId, project!, reportPeriod(report))!
    saveRow('reports', { ...report, invoiceId: invoice.id })
    return { id: invoice.id }
  }),

  // The Team page.
  route('get', '/team', ({ db, meId }) => teamOf(db, meId)),
  route('get', '/agents', ({ db, meId }) => ownAgents(db, meId)),
  route('put', '/project/:id/agents/:agentId', ({ db, meId, params, body }) => {
    const project = projectOf(db, params.id)
    if (!project || !accessOn(db, project, meId).works) {
      fail(403, 'Access denied')
    }
    // The reader's own: one their runs imply, or one they set up by hand.
    const own =
      params.agentId.startsWith(`${meId}:`) ||
      db.agents.some(
        (agent) => agent.id === params.agentId && agent.userId === meId,
      )
    if (!own) {
      fail(403, 'Access denied')
    }
    saveRow('projects', {
      ...project!,
      agentRates: {
        ...project!.agentRates,
        [params.agentId]: Number(body.rateHourCents),
      },
    })
    return { agentId: params.agentId, rateHourCents: body.rateHourCents }
  }),

  // Setting up an agent on a server: the agent, then its machine's credential.
  route('post', '/agents', ({ db, meId, body }) => {
    const draft = agentDraft(body)
    if (!draft) {
      fail(400, 'Invalid body')
    }
    const mine = db.agents.filter((agent) => agent.userId === meId)
    if (ownAgents(db, meId).some((agent) => agent.slug === draft!.slug)) {
      fail(400, 'SLUG_IN_USE')
    }
    const peers = mine.filter(
      (agent) => !agent.removedAt && agent.product === draft!.product,
    )
    if (
      peers.some((agent) =>
        agent.bindings.some((id) => draft!.bindings.includes(id)),
      )
    ) {
      fail(400, 'BINDING_IN_USE')
    }
    // At most one default: the agent that asks, or unasked the product's
    // first agent with no machine bindings.
    const isDefault =
      draft!.isDefault ||
      (draft!.bindings.length === 0 && !peers.some((agent) => agent.isDefault))
    if (isDefault) {
      for (const peer of peers.filter((agent) => agent.isDefault)) {
        saveRow('agents', { ...peer, isDefault: false })
      }
    }
    const { userId: _owner, ...agent } = saveRow('agents', {
      ...draft!,
      id: crypto.randomUUID(),
      userId: meId,
      isDefault,
      createdAt: new Date().toISOString(),
      removedAt: null,
    })
    return agent
  }),
  route('get', '/agent-tracking/credentials', ({ db, meId }) =>
    db.credentials
      .filter((credential) => credential.userId === meId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ userId: _owner, ...credential }) => credential),
  ),
  route('post', '/agent-tracking/credentials', ({ meId, body }) => {
    if (
      typeof body.instanceId !== 'string' ||
      !UUID.test(body.instanceId) ||
      (body.mode !== 'timer' && body.mode !== 'fixed')
    ) {
      fail(400, 'Invalid body')
    }
    const secret = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    const credential = `wa_agent_${secret}`
    const now = Date.now()
    const row = saveRow('credentials', {
      id: crypto.randomUUID(),
      userId: meId,
      instanceId: String(body.instanceId).toLowerCase(),
      label: String(body.label ?? ''),
      mode: body.mode === 'timer' ? ('timer' as const) : ('fixed' as const),
      prefix: credential.slice(0, 12),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 90 * 86_400_000).toISOString(),
      revokedAt: null,
      lastUsedAt: null,
    })
    return {
      id: row.id,
      instanceId: row.instanceId,
      credential,
      expiresAt: row.expiresAt,
    }
  }),
  route('delete', '/agent-tracking/credentials/:id', ({ db, meId, params }) => {
    const credential = db.credentials.find(
      (row) => row.id === params.id && row.userId === meId,
    )
    if (!credential) {
      fail(404, 'Not found')
    }
    saveRow('credentials', {
      ...credential!,
      revokedAt: new Date().toISOString(),
    })
    return null
  }),
]

/** Signing out in the app: the demo remembers it across reloads. */

export { signOutDemo as demoSignOut } from './session'
