import { inject, injectable } from 'inversify'
import { hiddenHistory, HiddenHistory } from '@work-address/statistics-core'

import { getDataSource } from '@/connector/data-source'
import { Project } from '@/entity/project'
import { TimeAgent } from '@/entity/time-agent'
import { User } from '@/entity/user'
import { ProjectRepository } from '@/repository/project-repository'
import { TimeRepository } from '@/repository/time-repository'
import { runPromise } from '@/service/effect-bridge'
import { Plan } from '@/service/plan'

type Kept = Pick<Project, 'id' | 'user'>

/**
 * What history a project keeps (SPEC.md, "What premium governs"): on the
 * hosted service an unpaid workspace hides entries and agent runs at 14 days.
 * The limit is the project owner's (`Plan.keptFrom`), and everything that
 * follows from it is answered here:
 *
 * - whether something that old may still be stored (`refuses`);
 * - hiding what is past the limit (`settle`), softly, so an upgrade brings it
 *   back, and never what an invoice covers;
 * - what a period reaches for and cannot show (`hidden`).
 *
 * Hiding is done to the stored rows, not in each query: every read of a
 * project settles it first, and then reads as it always has. What is shown
 * and what is stored cannot disagree, in a query written today or later.
 */
@injectable()
export class KeptHistory {
  /** A read settles a project at most this often; a write always does. */
  private static readonly SETTLE_EVERY = 10 * 60 * 1000

  /**
   * When a read last settled each project, and each reader's projects, in
   * this process. Shared by every instance: the container makes a new one
   * per request.
   */
  private static readonly settledAt = new Map<string, number>()

  @inject('Plan') protected plan: Plan
  @inject('ProjectRepository') protected projects: ProjectRepository
  @inject('TimeRepository') protected times: TimeRepository

  /** From when a project keeps entries and runs, or null when it keeps all. */
  public keptFrom(
    project: Pick<Project, 'user'>,
    now = new Date(),
  ): Date | null {
    return this.plan.keptFrom(project.user, now)
  }

  /**
   * Whether something that started at `fromAt` is already older than the
   * project keeps. It is refused on arrival rather than stored and hidden a
   * moment later, which would hand its sender an id for a row that is gone.
   */
  public refuses(
    project: Pick<Project, 'user'>,
    fromAt: Date,
    now = new Date(),
  ): boolean {
    const keptFrom = this.keptFrom(project, now)

    return keptFrom !== null && fromAt < keptFrom
  }

  /**
   * Hides what these projects no longer keep: entries and runs that started
   * before the limit, except what an invoice covers. Called before a read of
   * the projects and after a write to them. A read may find a project settled
   * minutes ago and leave it; `force`, for a write, never does.
   */
  public async settle(
    projects: Kept[],
    { force = false, now = new Date() }: { force?: boolean; now?: Date } = {},
  ): Promise<void> {
    const byLimit = new Map<number, string[]>()

    for (const project of projects) {
      if (!force && !KeptHistory.due(project.id, now)) continue
      KeptHistory.settledAt.set(project.id, now.getTime())

      const keptFrom = this.keptFrom(project, now)

      if (keptFrom) {
        byLimit.set(keptFrom.getTime(), [
          ...(byLimit.get(keptFrom.getTime()) ?? []),
          project.id,
        ])
      }
    }

    for (const [limit, projectIds] of byLimit) {
      const keptFrom = new Date(limit)

      // An entry is kept while an invoice covers it, by the rule the entries'
      // own repository holds; a run is billed by its own link to an invoice.
      await runPromise(
        this.times.softDeleteExpiredEntriesForProjects(projectIds, keptFrom),
      )
      await getDataSource()
        .createQueryBuilder()
        .softDelete()
        .from(TimeAgent)
        .where('"projectId" IN (:...projectIds)', { projectIds })
        .andWhere('"fromAt" < :keptFrom', { keptFrom })
        .andWhere('"invoiceId" IS NULL')
        .andWhere('"deletedAt" IS NULL')
        .execute()
    }
  }

  /**
   * Settles every project this reader can see, for a read that spans them
   * without naming them, such as a list of entries.
   */
  public async settleFor(reader: User, now = new Date()): Promise<void> {
    if (!KeptHistory.due(`reader:${reader.id}`, now)) return
    KeptHistory.settledAt.set(`reader:${reader.id}`, now.getTime())

    await this.settle(
      await runPromise(this.projects.findAllWithAccess(reader)),
      { now },
    )
  }

  /**
   * What a period that starts at `from` reaches for and these projects no
   * longer show, and whether this reader could lift it by upgrading.
   */
  public hidden(
    projects: Project[],
    from: Date,
    reader: User,
    now = new Date(),
  ): HiddenHistory {
    return hiddenHistory(
      projects.map((project) => ({
        keptFrom: this.keptFrom(project, now)?.getTime() ?? null,
        owned: project.isOwner(reader),
      })),
      from.getTime(),
    )
  }

  /** Whether a read has left this alone long enough to settle it again. */
  private static due(key: string, now: Date): boolean {
    // The map only ever holds what was read lately.
    if (KeptHistory.settledAt.size > 10_000) KeptHistory.settledAt.clear()

    return (
      now.getTime() - (KeptHistory.settledAt.get(key) ?? 0) >=
      KeptHistory.SETTLE_EVERY
    )
  }
}
