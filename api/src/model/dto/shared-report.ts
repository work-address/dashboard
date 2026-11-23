import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator'

/**
 * What a reader shares: a span and filters, as `StatisticsQueryDto` names
 * them. `StatisticsManager.scope` decides whether they may read it.
 */
export class SharedReportCreateDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  // No markup and no control characters: it is shown to anyone with the link.
  @Matches(/^[^<>\p{Cc}]*$/u)
  title?: string
  @IsString() @MaxLength(10) from: string
  @IsString() @MaxLength(10) to: string
  @IsString() @MaxLength(64) timeZone: string
  /**
   * Omitted or empty: every project these filters reach in the sharer's
   * scope, fixed when the report is shared.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  projectIds?: string[]
  /** Omitted or empty: everyone the sharer sees on those projects. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  userIds?: string[]
  /** Amounts at current rates; left off for a sharer who may not see money. */
  @IsOptional() @IsBoolean() showAmounts?: boolean
}
