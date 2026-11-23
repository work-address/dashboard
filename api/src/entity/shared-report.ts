import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm'

import { AbstractBaseEntity } from '@/entity/abstract-base-entity'
import { Invoice } from '@/entity/invoice'
import { User } from '@/entity/user'

/**
 * A shared report (GLOSSARY.md): the span and filters a reader shared, and the
 * secret of its link. Never the figures - each opening reads them in the
 * sharer's scope as it is then. Deleting it, softly, ends the link.
 */
@Entity('shared_report')
export class SharedReport extends AbstractBaseEntity {
  @Index() @Column('uuid') userId: string
  /** The sharer. */
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User
  /**
   * The secret part of the link. Kept readable, not hashed, because the
   * sharer copies the link again later.
   */
  @Index({ unique: true }) @Column('varchar', { length: 64 }) token: string
  @Column('varchar', { length: 120, nullable: true }) title: string | null
  /**
   * The sharer's days in `timeZone`, as `YYYY-MM-DD`; `to` is exclusive, as
   * `StatisticsQueryDto` has it.
   */
  @Column('varchar', { name: 'fromDay', length: 10 }) from: string
  @Column('varchar', { name: 'toDay', length: 10 }) to: string
  @Column('text') timeZone: string
  @Column('uuid', { array: true }) projectIds: string[]
  /** Empty: everyone the sharer sees on those projects. */
  @Column('uuid', { array: true, default: () => "'{}'" }) userIds: string[]
  @Column('bool', { default: false }) showAmounts: boolean
  /** The invoice made from this report, which is all it knows of it. */
  @Index() @Column('uuid', { nullable: true }) invoiceId: string | null
  @ManyToOne(() => Invoice, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invoiceId' })
  invoice: Invoice | null
}
