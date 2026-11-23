import { injectable } from 'inversify'

import { SharedReport } from '@/entity/shared-report'
import { AbstractRepositoryTemplate } from '@/repository/abstract-repository-template'

/** Shared reports as they are stored. A deleted one is never found. */
@injectable()
export class SharedReportRepository extends AbstractRepositoryTemplate<SharedReport> {
  protected target = SharedReport

  public findLive(id: string): Promise<SharedReport | null> {
    return this.getRepo().findOne({ where: { id } })
  }

  /** The report a link opens, with its sharer. */
  public findByToken(token: string): Promise<SharedReport | null> {
    return this.getRepo().findOne({
      where: { token },
      relations: { user: true },
    })
  }

  /** A sharer's own reports, newest first. */
  public findBySharer(userId: string): Promise<SharedReport[]> {
    return this.getRepo().find({
      where: { userId },
      order: { createdAt: 'DESC', id: 'ASC' },
    })
  }

  /**
   * Remembers the invoice made from a report. The first one stays: a report
   * that already has an invoice is left as it is.
   */
  public async linkInvoice(id: string, invoiceId: string): Promise<void> {
    await this.getRepo()
      .createQueryBuilder()
      .update(SharedReport)
      .set({ invoiceId })
      .where('id = :id AND "invoiceId" IS NULL', { id })
      .execute()
  }
}
