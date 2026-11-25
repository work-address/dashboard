import { validate } from 'class-validator'
import { Cause, Effect } from 'effect'
import { inject, injectable } from 'inversify'
import moment from 'moment'

import { Time } from '@/entity/time'
import { EntryUpload } from '@/service/entry-upload'
import { User } from '@/entity/user'
import { TimeRepository } from '@/repository/time-repository'
import { ProjectRepository } from '@/repository/project-repository'
import { ITimeInsertionResult } from '@/model/time'
import { ErrorFormatter } from '@/service/error-formatter'
import { ILogger } from '@/model/logging'
import { TimeCreateDto, TimeSearchDto } from '@/model/dto/time'
import AccessException from '@/exception/access-exception'
import ConstraintsValidationException from '@/exception/constraints-validation-exception'
import RetentionExceededException from '@/exception/retention-exceeded-exception'
import MobileTimeNotAllowedException from '@/exception/mobile-time-not-allowed-exception'
import { Project } from '@/entity/project'
import { ImageResizer } from '@/service/image-resizer'
import { Plan } from '@/service/plan'
import { KeptHistory } from '@/service/kept-history'
import { FREE_PLAN_WORKERS, FREE_RETENTION_DAYS } from '@/model/plan'
import { RepoEffect } from '@/repository/abstract-repository-template'
import { fromPromise } from '@/service/effect-bridge'

@injectable()
export class TimeManager {
  @inject('TimeRepository')
  protected timeRepository: TimeRepository
  @inject('ProjectRepository')
  protected projectRepository: ProjectRepository
  @inject('ImageResizer')
  protected imageResizer: ImageResizer
  @inject('ILogger')
  protected logger: ILogger
  @inject('Plan')
  protected plan: Plan
  @inject('KeptHistory')
  protected history: KeptHistory

  /**
   * A tracker syncs a batch and each entry succeeds or fails on its own, so one
   * bad row must not sink the rest. That partial success used to be a `catch`
   * inside a loop pushing into a shared array; as an Effect the per-entry
   * failure is in the type, and the "one bad entry is a result, not an
   * exception" rule lives in one place instead of being re-stated per branch.
   */
  public createOrUpdateMany(
    data: TimeCreateDto[],
    user: User,
  ): RepoEffect<ITimeInsertionResult[]> {
    // Effect.suspend so the cutoff and the retention set belong to each run
    // rather than to the moment the effect was built. An effect is a
    // description that may be run more than once - a retry, say - and a Set
    // shared across runs would let a later attempt purge projects that only an
    // earlier one touched, deleting time entries the current batch never saw.
    return Effect.suspend(() => {
      // Fixed for the whole request so every entry is judged against the same
      // window, and so the purge below cannot move past what was just accepted.
      const now = new Date()
      // The projects whose owner's plan keeps only a trailing window, and
      // from when. One moment, one window: they all share the cutoff.
      // Every project the batch reached, for what follows a write to it.
      const written = new Map<string, Project>()
      const touchedProjects = new Set<string>()

      const storeEntry = (
        item: TimeCreateDto,
      ): Effect.Effect<ITimeInsertionResult, unknown> =>
        Effect.gen(this, function* () {
          const fromAt = moment(item.fromAt).toDate()

          const project =
            yield* this.projectRepository.findProjectForTimeTracking(
              item.projectId,
              user,
            )

          touchedProjects.add(project.id)

          // Before any refusal: an upload's arrival is what rotates a project
          // past its window, whether or not the plan lets its author record,
          // as for agent runs.
          written.set(project.id, project)

          if (!(yield* fromPromise(() => this.plan.mayTrack(project, user)))) {
            return yield* Effect.fail(
              new AccessException(
                `This project's plan limits tracking to ${FREE_PLAN_WORKERS} contributors, and you are not one of them. Your recorded hours stay available and you can still invoice them.`,
              ),
            )
          }

          // Refuse rather than accept-and-hide: saving this row and hiding
          // it moments later would hand the client an id for a row that no
          // longer exists, and a syncing tracker would drop its local copy.
          if (this.history.refuses(project, fromAt, now)) {
            return yield* Effect.fail(
              new RetentionExceededException(
                `Entry starts before the ${FREE_RETENTION_DAYS}-day retention window of this project's plan and was not stored`,
              ),
            )
          }

          // The uploader names its source, so naming one grants nothing: phone
          // time is taken only where the owner allowed it, or from before they
          // last turned it off, and it only ever carries less detail.
          const mobile = item.source === 'mobile'

          if (mobile && !TimeManager.mobileAllowed(project, fromAt)) {
            return yield* Effect.fail(new MobileTimeNotAllowedException())
          }

          // Resized before the slice is locked, so no image work holds the lock.
          const read = EntryUpload.read(item, project)
          const slice = {
            ...read,
            screenshot: yield* fromPromise(() =>
              this.resize(read.screenshot ?? undefined),
            ),
          }
          const { saved, row } = yield* this.timeRepository.storeUpload(
            { project, author: user, fromAt: slice.fromAt },
            (existing) =>
              EntryUpload.decide(slice, existing, {
                project,
                author: user,
                now,
              }),
          )

          return { ...row, id: saved.id }
        })

      const program = Effect.gen(this, function* () {
        // Sequential on purpose: Effect.forEach runs without concurrency unless
        // asked, and both the result order the tracker reconciles against and the
        // retention set built along the way depend on that.
        const insertionResults = yield* Effect.forEach(data, (item) =>
          storeEntry(item).pipe(
            // catchAllCause, not catchAll: the loop this replaced caught every
            // throw, so a defect must land in the result row too rather than
            // failing the whole batch.
            Effect.catchAllCause((cause) =>
              Effect.succeed({
                ...item,
                error: this.reportEntryFailure(Cause.squash(cause)),
                appsAccepted: undefined,
                locationsAccepted: undefined,
                apps: undefined,
                screenshot: undefined,
                processes: undefined,
                locations: undefined,
              }),
            ),
          ),
        )

        yield* fromPromise(() =>
          this.history.settle([...written.values()], { force: true, now }),
        )

        yield* this.timeRepository.purgeExpiredScreenshots(
          [...touchedProjects],
          this.plan.screenshotLimitDays(),
        )
        yield* this.timeRepository.purgeExpiredLocations(
          [...touchedProjects],
          this.plan.screenshotLimitDays(),
        )
        return insertionResults
      })

      return program
    })
  }

  /**
   * Whether phone time starting at `fromAt` is taken: the owner allows it now,
   * or it started before they last turned it off. Only that last switch is
   * kept, so an earlier off period is not told apart.
   */
  public static mobileAllowed(project: Project, fromAt: Date): boolean {
    return Boolean(
      project.allowMobileTime ||
        (project.mobileTimeOffAt && fromAt < project.mobileTimeOffAt),
    )
  }

  /**
   * One entry's failure, as its result row says it. The row is a 200, so neither
   * the error handler nor Sentry hears of it: an unexpected one is logged here,
   * as for any route that handles recordings.
   */
  private reportEntryFailure(error: unknown) {
    if (!ErrorFormatter.expected(error)) {
      this.logger.error('unexpected error storing a time entry', {
        error: ErrorFormatter.forLog(error, true),
      })
    }

    return ErrorFormatter.format(error)
  }

  public publish(ids: string[], user: User): RepoEffect<void> {
    return Effect.gen(this, function* () {
      const times = yield* this.timeRepository.findByIdsAsAuthor(ids, user)
      yield* this.timeRepository.publishAsAuthor(
        times.map((time) => time.id),
        user,
      )
    })
  }

  /**
   * The entries a reader may list. Their projects are settled first, as for
   * every read, so the list shows what those projects still keep.
   */
  public search(
    search: TimeSearchDto,
    user: User,
  ): RepoEffect<[Time[], number]> {
    return fromPromise(() => this.history.settleFor(user)).pipe(
      Effect.flatMap(() => this.timeRepository.findAndCount(search, user)),
    )
  }

  /** Allowed on an invoiced entry too: `SPEC.md` keeps this one hand change. */
  public setIsPaidMany(
    ids: string[],
    isPaid: boolean,
    user: User,
  ): RepoEffect<void> {
    return this.timeRepository.updateAsAuthor(ids, user, { isPaid })
  }

  public edit(id: string, data: Time, user: User): RepoEffect<void> {
    return Effect.gen(this, function* () {
      // The route's 'edit' group selects the fields but checks none of them.
      const errors = yield* fromPromise(() =>
        validate(data, { skipMissingProperties: true }),
      )

      if (errors.length) {
        return yield* Effect.fail(new ConstraintsValidationException(errors))
      }

      yield* this.timeRepository.editAsAuthor(id, user, data)
    })
  }

  public removeScreenshots(ids: string[], user: User): RepoEffect<void> {
    return this.timeRepository.updateUninvoicedAsAuthor(ids, user, {
      screenshot: null,
    })
  }

  public removeLocations(ids: string[], user: User): RepoEffect<void> {
    return this.timeRepository.clearLocationsAsAuthor(ids, user)
  }

  public removeProcesses(ids: string[], user: User): RepoEffect<void> {
    return this.timeRepository.clearProcessesAsAuthor(ids, user)
  }

  public removeMany(ids: string[], user: User): RepoEffect<void> {
    return this.timeRepository.removeAsAuthor(ids, user)
  }

  public async resize(screenshot?: string): Promise<string | null> {
    if (!screenshot) {
      return null
    }

    return this.imageResizer.resize(screenshot, 600)
  }
}
