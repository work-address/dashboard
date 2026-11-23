import { randomBytes } from 'crypto'
import { isUUID } from 'class-validator'
import { inject, injectable } from 'inversify'
import moment from 'moment-timezone'
import { BadRequestError, NotFoundError } from 'routing-controllers'

import { Project } from '@/entity/project'
import { SharedReport } from '@/entity/shared-report'
import { User } from '@/entity/user'
import AccessException from '@/exception/access-exception'
import SharedReportGoneException from '@/exception/shared-report-gone-exception'
import { SharedReportCreateDto } from '@/model/dto/shared-report'
import { StatisticsQueryDto } from '@/model/dto/statistics'
import { IPublicReport, ISharedReportView } from '@/model/shared-report'
import { ProjectRepository } from '@/repository/project-repository'
import { SharedReportRepository } from '@/repository/shared-report-repository'
import { runPromise } from '@/service/effect-bridge'
import { InvoiceManager } from '@/service/invoice-manager'
import { ProjectAccess } from '@/service/project-access'
import { StatisticsManager } from '@/service/statistics-manager'

/** 32 random bytes, as base64url writes them. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/

/**
 * Shared reports (SPEC.md, "A shared report is `Statistics` at a link"): what
 * a reader may share, what its link answers, and when it can be billed. It
 * keeps the span, the filters and the secret; `StatisticsManager` reads the
 * figures, in the sharer's scope, each time the link is opened, and
 * `InvoiceManager` makes the invoice by its own rules.
 */
@injectable()
export class SharedReportManager {
  @inject('ProjectAccess') protected access: ProjectAccess
  @inject('InvoiceManager') protected invoices: InvoiceManager
  @inject('ProjectRepository') protected projects: ProjectRepository
  @inject('SharedReportRepository') protected reports: SharedReportRepository
  @inject('StatisticsManager') protected statistics: StatisticsManager

  /**
   * Shares a span of what the sharer sees. Whatever statistics would refuse
   * this reader is refused here, and amounts are refused to a sharer who may
   * not see money on one of the projects.
   */
  public async create(
    data: SharedReportCreateDto,
    sharer: User,
  ): Promise<ISharedReportView> {
    const report = Object.assign(new SharedReport(), {
      userId: sharer.id,
      token: randomBytes(32).toString('base64url'),
      title: data.title?.trim() || null,
      from: data.from,
      to: data.to,
      timeZone: data.timeZone,
      projectIds: [...new Set(data.projectIds)],
      userIds: [...new Set(data.userIds ?? [])],
      showAmounts: data.showAmounts === true,
      invoiceId: null,
    })
    const scope = await this.statistics.scope(
      SharedReportManager.query(report),
      sharer,
    )

    if (report.showAmounts && scope.viewers.length) {
      throw new AccessException(
        'Amounts can be shared only for projects you own or work on',
      )
    }

    return this.view(
      await runPromise(this.reports.saveSingle(report)),
      sharer,
      scope.projects,
    )
  }

  /** The sharer's own reports, newest first. */
  public async list(sharer: User): Promise<ISharedReportView[]> {
    const [reports, projects] = await Promise.all([
      this.reports.findBySharer(sharer.id),
      runPromise(this.projects.findAllWithAccess(sharer)),
    ])

    return reports.map((report) => this.view(report, sharer, projects))
  }

  /** Ends the link. The report stays stored, deleted, and is never found again. */
  public async remove(id: string, sharer: User): Promise<void> {
    const report = await this.own(id, sharer)

    await runPromise(this.reports.softDelete({ id: report.id }))
  }

  /**
   * Bills the report's period on its one project, once: a report that has an
   * invoice answers with that one. The invoice is `InvoiceManager`'s, for the
   * same period by its own rules; the report only remembers which it was.
   */
  public async invoice(id: string, sharer: User): Promise<{ id: string }> {
    const report = await this.own(id, sharer)

    if (report.invoiceId) return { id: report.invoiceId }

    const project =
      report.projectIds.length === 1
        ? await runPromise(
            this.projects.findProjectWithAccess(
              Object.assign(new Project(), { id: report.projectIds[0] }),
              sharer,
            ),
          )
        : undefined

    if (!project || !this.canInvoice(report, sharer, [project])) {
      throw new BadRequestError(
        'Only a report of your own time on one project can be invoiced',
      )
    }

    const instant = (day: string) =>
      moment.tz(day, 'YYYY-MM-DD', true, report.timeZone).valueOf()

    try {
      const invoice = await runPromise(
        this.invoices.create(
          { fromUnix: instant(report.from), toUnix: instant(report.to) },
          project,
          sharer,
        ),
      )

      await this.reports.linkInvoice(report.id, invoice.id)

      return { id: invoice.id }
    } catch (error) {
      // A second request that lost the race finds the time already billed:
      // the invoice the first one made is the answer to both.
      const again = await this.reports.findLive(report.id)

      if (again?.invoiceId) return { id: again.invoiceId }

      throw error
    }
  }

  /**
   * What the link answers anyone: the report read now, in the sharer's scope
   * as it is now. Not found once the sharer sees none of its projects; gone
   * while a project owner's plan hides part of its span.
   */
  public async readPublic(token: string): Promise<IPublicReport> {
    const report = TOKEN.test(token)
      ? await this.reports.findByToken(token)
      : null
    const scope =
      report?.user &&
      (await this.statistics.remainingScope(
        SharedReportManager.query(report),
        report.user,
      ))

    if (!report || !scope) throw new NotFoundError('Report not found')

    // Not exempt the way invoiced hours are: sharing a report every week
    // would otherwise keep all history without a plan.
    if (this.statistics.hiddenHistory(scope).hiddenBefore) {
      throw new SharedReportGoneException()
    }

    return {
      title: report.title,
      sharedBy: report.user.name || report.user.address,
      from: report.from,
      to: report.to,
      timeZone: report.timeZone,
      createdAt: report.createdAt,
      ...(await this.statistics.sharedFigures(scope, report.showAmounts)),
    }
  }

  /** The statistics query a report stands for. */
  private static query(report: SharedReport): StatisticsQueryDto {
    return {
      from: report.from,
      to: report.to,
      timeZone: report.timeZone,
      projectIds: report.projectIds,
      userIds: report.userIds,
    }
  }

  /** A live report of this sharer's; anyone else's is refused. */
  private async own(id: string, sharer: User): Promise<SharedReport> {
    const report = isUUID(id) ? await this.reports.findLive(id) : null

    if (!report) throw new NotFoundError('Report not found')
    if (report.userId !== sharer.id) {
      throw new AccessException('The report is not yours')
    }

    return report
  }

  private view(
    report: SharedReport,
    sharer: User,
    projects: Project[],
  ): ISharedReportView {
    return {
      id: report.id,
      token: report.token,
      title: report.title,
      from: report.from,
      to: report.to,
      timeZone: report.timeZone,
      projectIds: report.projectIds,
      userIds: report.userIds,
      showAmounts: report.showAmounts,
      createdAt: report.createdAt,
      invoiceId: report.invoiceId ?? null,
      canInvoice: this.canInvoice(report, sharer, projects),
    }
  }

  /**
   * A report of the sharer's own time on one project, not yet invoiced: a
   * worker's report is their own time whatever it names, an owner's only when
   * it names them alone. `projects` are the ones the sharer sees today.
   */
  private canInvoice(
    report: SharedReport,
    sharer: User,
    projects: Project[],
  ): boolean {
    if (report.invoiceId || report.projectIds.length !== 1) return false

    const project = projects.find(({ id }) => id === report.projectIds[0])
    const role = project ? this.access.role(project, sharer) : null

    return (
      role === 'worker' ||
      (role === 'owner' &&
        report.userIds.length === 1 &&
        report.userIds[0] === sharer.id)
    )
  }
}
