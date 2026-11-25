/**
 * Role and Access (GLOSSARY.md), written once for the API and the demo's mock.
 * Role is what a project's lists say; Access is what that role grants today,
 * once the owner's plan is taken into account. Only recording reads the plan:
 * nobody loses sight of the record, or the right to invoice what they
 * recorded, because an owner's plan changed (SPEC.md, "Who can see what").
 */
import type { ReaderRole } from './statistics-scope.js'

/** How many workers a free owner may list across their projects, and keep recording. */
export const FREE_PLAN_WORKERS = 2

/**
 * An address as accounts are matched by it: trimmed, in any case. Lists hold
 * addresses as they were typed.
 */
export const canonicalAddress = (address: string): string =>
  address.trim().toLowerCase()

/** A project's lists: addresses on the API, the demo's user ids in the mock. */
export interface ProjectLists {
  workers?: readonly string[] | null
  viewers?: readonly string[] | null
}

const onList = (list: readonly string[] | null | undefined, key: string) => {
  const target = canonicalAddress(key)

  return (list ?? []).some((listed) => canonicalAddress(listed) === target)
}

/**
 * What a person is on a project: owner, worker, viewer, or nothing. `owns` is
 * the caller's, since an owner is the project's account and not on a list;
 * `key` is what the lists hold for this person. No plan is read.
 */
export function roleOf(
  owns: boolean,
  lists: ProjectLists,
  key: string,
): ReaderRole {
  if (owns) return 'owner'
  if (onList(lists.workers, key)) return 'worker'
  if (onList(lists.viewers, key)) return 'viewer'
  return null
}

/** What a role grants a person on one project today. */
export interface Access {
  role: ReaderRole
  /** Sees the project and its totals. */
  reads: boolean
  /** Works on it: invoices their own time and runs, and sets their agents' rates. */
  works: boolean
  /** May record new time on it today. The only grant the owner's plan limits. */
  tracks: boolean
  /** Sees the rate, and money beside time. A viewer gets time alone. */
  seesMoney: boolean
  /** Whose entries and runs they list: a viewer reads totals, never rows. */
  lists: 'everyone' | 'own' | 'none'
}

/**
 * Whether a role works on the project: invoices their own time and runs and
 * lists their own record. Reads no plan, so it holds while they are owed.
 */
export const works = (role: ReaderRole): boolean =>
  role === 'owner' || role === 'worker'

const listsOf = (role: ReaderRole): Access['lists'] =>
  role === 'owner' ? 'everyone' : role === 'worker' ? 'own' : 'none'

/**
 * Access for a role. `planTracks` is whether the owner's plan takes this
 * worker's new time today: always on Premium, and on Free for the workers
 * `trackingWorkers` keeps. An owner always records on their own project.
 */
export function accessOf(role: ReaderRole, planTracks: boolean): Access {
  return {
    role,
    reads: role !== null,
    works: works(role),
    tracks: role === 'owner' || (role === 'worker' && planTracks),
    seesMoney: works(role),
    lists: listsOf(role),
  }
}

/**
 * Whether a reader may list an entry or run written by `authorId`: an owner
 * everyone's, a worker their own, a viewer none. Takes the role, because
 * listing reads no plan: a worker keeps sight of their own record while they
 * may still be owed money.
 */
export const listsRow = (
  role: ReaderRole,
  authorId: string,
  readerId: string,
): boolean => {
  const lists = listsOf(role)

  return lists === 'everyone' || (lists === 'own' && authorId === readerId)
}

/**
 * The workers whose new time an owner's plan takes today, as canonical
 * addresses: everyone listed on Premium, or while there are no more than
 * the free plan includes; otherwise the owner's choice, topped up from the
 * first listed until it reaches the free limit, so a lapse never leaves a
 * kept worker waiting for a choice.
 */
export function trackingWorkers(
  listed: readonly string[],
  plan: { premium: boolean; kept?: readonly string[] | null },
): Set<string> {
  const all = [...new Set(listed.map(canonicalAddress))]

  if (plan.premium || all.length <= FREE_PLAN_WORKERS) return new Set(all)

  const chosen = (plan.kept ?? [])
    .map(canonicalAddress)
    .filter((address) => all.includes(address))

  return new Set([...new Set([...chosen, ...all])].slice(0, FREE_PLAN_WORKERS))
}
