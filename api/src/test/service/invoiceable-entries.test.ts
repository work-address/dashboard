import { suite, test } from '@testdeck/mocha'
import { expect } from 'chai'
import moment from 'moment'

import { Invoice } from '@/entity/invoice'
import { Project } from '@/entity/project'
import { Time } from '@/entity/time'
import { User } from '@/entity/user'
import { EInvoiceState } from '@/model/invoice'
import { EProjectState } from '@/model/project'
import { InvoiceRepository } from '@/repository/invoice-repository'
import { ProjectRepository } from '@/repository/project-repository'
import {
  InvoiceableSelection,
  TimeRepository,
} from '@/repository/time-repository'
import { runPromise } from '@/service/effect-bridge'
import { InvoiceManager } from '@/service/invoice-manager'
import { AbstractDatabaseIntegration } from '@/test/abstract-database.integration'
import { ProjectFixture } from '@/test/fixture/project-fixture'
import { TimeFixture } from '@/test/fixture/time-fixture'
import { UserFixture } from '@/test/fixture/user-fixture'

/**
 * Which of an author's Entries an invoice may still bill (SPEC: "Already-paid
 * hours cannot be re-billed"): unpaid, and not Invoiced as GLOSSARY.md defines
 * it, which includes the period of an invoice older than frozen lines.
 */
@suite()
export class InvoiceableEntriesTest extends AbstractDatabaseIntegration {
  protected userFixture: UserFixture
  protected projectFixture: ProjectFixture
  protected timeFixture: TimeFixture
  protected timeRepository: TimeRepository
  protected projectRepository: ProjectRepository
  protected invoiceManager: InvoiceManager
  protected invoiceRepository: InvoiceRepository

  constructor() {
    super()

    this.userFixture = this.container.get('UserFixture')
    this.projectFixture = this.container.get('ProjectFixture')
    this.timeFixture = this.container.get('TimeFixture')
    this.timeRepository = this.container.get('TimeRepository')
    this.projectRepository = this.container.get('ProjectRepository')
    this.invoiceManager = this.container.get('InvoiceManager')
    this.invoiceRepository = this.container.get('InvoiceRepository')
  }

  /** A worker's hour starting `daysAgo` days ago. */
  private entry(project: Project, author: User, daysAgo: number) {
    const from = moment.utc().subtract(daysAgo, 'days').startOf('minute')

    return this.timeFixture.create(
      project,
      from.toDate(),
      from.clone().add(60, 'minutes').toDate(),
      author,
    )
  }

  /** An invoice from before lines were frozen, as old rows still are. */
  private legacyInvoice(
    project: Project,
    time: Time,
    issuer: User,
    state = EInvoiceState.REQUESTED,
  ) {
    const invoice = new Invoice()
    invoice.project = project
    invoice.user = issuer
    invoice.fromAt = moment(time.fromAt).subtract(1, 'minute').toDate()
    invoice.toAt = moment(time.toAt).add(1, 'minute').toDate()
    invoice.amountCents = 100
    invoice.state = state
    return runPromise(this.invoiceRepository.saveSingle(invoice))
  }

  private async scenario() {
    const owner = await this.userFixture.createPremiumUser()
    const worker = await this.userFixture.createUser()
    const project = await this.projectFixture.create(
      owner,
      EProjectState.ACTIVE,
    )
    project.workerAddresses = [worker.address]
    project.rateHour = 60
    await runPromise(this.projectRepository.saveSingle(project))

    return { owner, worker, project }
  }

  private async billed(invoice: Invoice) {
    const times = await runPromise(this.timeRepository.findForInvoice(invoice))
    return times.map((time) => time.id).sort()
  }

  private async refusal(run: () => Promise<unknown>): Promise<unknown> {
    try {
      await run()
    } catch (error: unknown) {
      return error
    }
    throw new Error('Expected the invoice to be refused')
  }

  /**
   * An unpaid Entry inside the worker's own old invoice has no `invoiceId`,
   * yet it is Invoiced: it can't be deleted, so it must not be billed again,
   * whichever way the next invoice is raised.
   */
  @test()
  async noInvoiceBillsAnEntryInsideAnOldInvoicesPeriod() {
    const raise = {
      period: (project: Project, worker: User) =>
        this.invoiceManager.create(
          {
            fromUnix: +moment.utc().subtract(10, 'days'),
            toUnix: +moment.utc(),
          } as never,
          project,
          worker,
        ),
      outstanding: (project: Project, worker: User) =>
        this.invoiceManager.ensureForProject(project, worker),
    }

    for (const way of ['period', 'outstanding'] as const) {
      const { worker, project } = await this.scenario()
      const open = await this.entry(project, worker, 4)
      const covered = await this.entry(project, worker, 2)
      await this.legacyInvoice(project, covered, worker)

      const invoice = await runPromise(raise[way](project, worker))
      expect(await this.billed(invoice!), way).to.deep.equal([open.id])
    }

    const { worker, project } = await this.scenario()
    const covered = await this.entry(project, worker, 2)
    await this.legacyInvoice(project, covered, worker)
    expect(
      await this.refusal(() =>
        runPromise(
          this.invoiceManager.createFromTimeIds(project, worker, [covered.id]),
        ),
      ),
    ).to.have.property('httpCode', 400)
  }

  /**
   * Every kind of Entry an author may have on a project, against the three
   * ways an invoice selects them.
   */
  @test()
  async eachSelectionFindsOnlyWhatIsStillInvoiceable() {
    const { owner, worker, project } = await this.scenario()
    const open = await this.entry(project, worker, 7)
    const paidByHand = await this.entry(project, worker, 6)
    paidByHand.isPaid = true
    await runPromise(this.timeRepository.saveSingle(paidByHand))
    const linked = await this.entry(project, worker, 5)
    await runPromise(
      this.invoiceManager.createFromTimeIds(project, worker, [linked.id]),
    )
    const inOldInvoice = await this.entry(project, worker, 4)
    await this.legacyInvoice(project, inOldInvoice, worker)
    const inColleaguesOldInvoice = await this.entry(project, worker, 3)
    await this.legacyInvoice(project, inColleaguesOldInvoice, owner)
    const inRejectedOldInvoice = await this.entry(project, worker, 2)
    await this.legacyInvoice(
      project,
      inRejectedOldInvoice,
      worker,
      EInvoiceState.REJECTED,
    )
    const someoneElses = await this.entry(project, owner, 7)
    const otherProject = await this.projectFixture.create(
      worker,
      EProjectState.ACTIVE,
    )
    const onAnotherProject = await this.entry(otherProject, worker, 7)

    const find = (selection: InvoiceableSelection) =>
      runPromise(
        this.timeRepository.findInvoiceable(project, worker, selection),
      ).then((times) => times.map((time) => time.id))

    // In time order.
    expect(await find('outstanding')).to.deep.equal([
      open.id,
      inColleaguesOldInvoice.id,
      inRejectedOldInvoice.id,
    ])
    expect(
      await find({
        from: moment
          .utc()
          .subtract(6 * 24 + 12, 'hours')
          .toDate(),
        to: moment
          .utc()
          .subtract(2 * 24 + 12, 'hours')
          .toDate(),
      }),
    ).to.deep.equal([inColleaguesOldInvoice.id])

    const invoiceable = [open, inColleaguesOldInvoice, inRejectedOldInvoice]
    for (const time of invoiceable)
      expect(await find({ ids: [time.id, time.id] })).to.deep.equal([time.id])
    for (const time of [
      paidByHand,
      linked,
      inOldInvoice,
      someoneElses,
      onAnotherProject,
    ])
      expect(
        await this.refusal(() => find({ ids: [open.id, time.id] })),
        time.id,
      ).to.have.property('httpCode', 400)
    expect(await this.refusal(() => find({ ids: [] }))).to.have.property(
      'httpCode',
      400,
    )
  }
}
