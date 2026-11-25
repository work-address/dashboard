import {
  accessOf,
  canonicalAddress,
  roleOf,
  trackingWorkers,
} from '@work-address/statistics-core'
import { Effect } from 'effect'
import { inject, injectable } from 'inversify'
import moment from 'moment'
import { BadRequestError } from 'routing-controllers'

import { Project } from '@/entity/project'
import { User } from '@/entity/user'
import {
  FREE_PLAN_WORKERS,
  FREE_RETENTION_DAYS,
  HOSTED_SCREENSHOT_RETENTION_DAYS,
} from '@/model/plan'
import { RepoEffect } from '@/repository/abstract-repository-template'
import { AccountAddress } from '@/service/account-address'
import { fromPromise } from '@/service/effect-bridge'
import { Entitlement } from '@/service/entitlement'
import { ISeatInventory, WorkerSeats } from '@/service/worker-seats'

export interface ITrackingWorkers {
  /** Whether the owner has more workers than their plan lets track. */
  limited: boolean
  limit: number
  workers: {
    address: string
    name: string | null
    /** Has signed in, so there is an account behind the address. */
    connected: boolean
    tracking: boolean
  }[]
}

/**
 * Everything an owner's plan limits (web/PRODUCT.md §5; GLOSSARY.md, "Plan"):
 * how many workers they may list, who may record, how far back entries and
 * runs are kept, the longest a screenshot is kept, and who is on the bill.
 *
 * The plan is always the project owner's, never the author's: a project's
 * record is the owner's, so a worker's own plan changes nothing on it.
 * Premium and a self-hosted instance have no limits; `Entitlement` says which
 * an account is on, and nothing outside this module asks it what that means.
 *
 * What an upgrade brings back is `PlanChange`, which needs the modules that
 * read this one.
 */
@injectable()
export class Plan {
  @inject('Entitlement')
  protected entitlement: Entitlement
  @inject('WorkerSeats')
  protected seats: WorkerSeats

  /**
   * From when this owner's projects keep entries and runs, or null when they
   * keep everything. Anything older is refused on arrival and rotated out
   * when the project is next written to; what an invoice covers stays.
   */
  public keptFrom(
    owner: Pick<User, 'premium'> | null | undefined,
    now: Date = new Date(),
  ): Date | null {
    return this.entitlement.isPremium(owner)
      ? null
      : moment.utc(now).subtract(FREE_RETENTION_DAYS, 'days').toDate()
  }

  /** The longest any screenshot is kept here: hosted has a limit, self-hosted none. */
  public screenshotLimitDays(): number | null {
    return this.entitlement.isSaaS() ? HOSTED_SCREENSHOT_RETENTION_DAYS : null
  }

  /** Whether this person's new time on the project is accepted today. */
  public async mayTrack(project: Project, user: User): Promise<boolean> {
    // The lists say who could; the plan says which workers may today. On
    // Premium that is everyone, which needs no read of the seats.
    const role = roleOf(
      project.isOwner(user),
      { workers: project.workerAddresses, viewers: project.viewerAddresses },
      user.address ?? '',
    )
    const planTracks =
      role === 'worker' &&
      (this.entitlement.isPremium(project.user) ||
        (await this.tracking(project.user)).has(
          canonicalAddress(user.address ?? ''),
        ))

    return accessOf(role, planTracks).tracks
  }

  /**
   * Refuses a change to a project's workers that would take a limited owner
   * past the workers their plan includes. Only granting is limited, never
   * revoking or keeping: an owner whose subscription lapsed can still take
   * access away one worker at a time. Viewers are free whatever the plan.
   */
  public async checkGrant(
    project: Project,
    next: string[],
    current: string[],
  ): Promise<void> {
    if (this.entitlement.isPremium(project.user)) return

    const canonical = (addresses: string[]) =>
      addresses.map((address) => AccountAddress.toCanonical(address))
    const elsewhere = await this.seats.listed(project.user.id, {
      exceptProjectId: project.id,
    })
    const known = new Set([...canonical(current), ...elsewhere])
    const grants = canonical(next).some((address) => !known.has(address))
    const everyone = new Set([...elsewhere, ...canonical(next)])

    if (grants && everyone.size > FREE_PLAN_WORKERS) {
      throw new BadRequestError(
        `The free plan includes ${FREE_PLAN_WORKERS} contributors across your projects. Upgrade to Premium to add more.`,
      )
    }
  }

  /**
   * Runs a change to who is on an owner's projects (a list edit, a project
   * deleted) with the seat history recorded around it: before, so someone who
   * signed in since the last change is on record, and after, so a removal
   * ends their seat. Billing brings the history up to date again when it
   * reads, so a failure to record is logged and the change still goes through.
   */
  public aroundListChange<A>(
    ownerId: string | undefined,
    change: RepoEffect<A>,
  ): RepoEffect<A> {
    const record = fromPromise(() =>
      ownerId ? this.seats.sync(ownerId) : Promise.resolve(),
    ).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() =>
          console.error(`Seat history not updated for ${ownerId}`, error),
        ),
      ),
    )

    return Effect.gen(function* () {
      yield* record
      const result = yield* change
      yield* record

      return result
    })
  }

  /** What billing reads: who is on the owner's bill, now or over a period. */
  public inventory(
    owner: User,
    period?: { from: Date; to: Date },
  ): Promise<ISeatInventory> {
    return this.seats.inventory(owner, period)
  }

  /** The owner's workers and which of them their plan lets record today. */
  public async trackingWorkers(owner: User): Promise<ITrackingWorkers> {
    const listed = await this.seats.listed(owner.id)
    const premium = this.entitlement.isPremium(owner)
    const tracking = await this.tracking(owner)
    const accounts = await this.seats.accounts(owner.id)

    return {
      limited: !premium && listed.length > FREE_PLAN_WORKERS,
      limit: FREE_PLAN_WORKERS,
      workers: listed.map((address) => ({
        address: accounts.get(address)?.address ?? address,
        name: accounts.get(address)?.name ?? null,
        connected: accounts.has(address),
        tracking: tracking.has(address),
      })),
    }
  }

  /**
   * The owner's choice of who keeps recording without a plan, as it is stored.
   * Everyone chosen must be a worker on the owner's projects.
   */
  public async keptWorkers(
    owner: User,
    addresses: string[],
  ): Promise<string[]> {
    const listed = await this.seats.listed(owner.id)
    const kept = addresses.map((address) => AccountAddress.toCanonical(address))

    if (kept.some((address) => !listed.includes(address))) {
      throw new BadRequestError(
        'Everyone kept must be a contributor on your projects',
      )
    }

    return kept
  }

  /**
   * The workers the owner's plan lets record today: everyone on Premium,
   * otherwise their choice topped up from the first listed until it reaches
   * the free limit, so a lapse never leaves a worker who has been kept with
   * nothing to do but wait for a choice.
   */
  private async tracking(owner: User): Promise<Set<string>> {
    return trackingWorkers(await this.seats.listed(owner.id), {
      premium: this.entitlement.isPremium(owner),
      kept: owner.keptWorkers,
    })
  }
}
