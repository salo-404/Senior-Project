import { RequestPriority, RequestStatus, UrgencyLevel } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';

export class ListCasesQuery extends PaginationQuery {
  @IsOptional() @IsEnum(RequestStatus)
  status?: RequestStatus;

  @IsOptional() @IsEnum(RequestPriority)
  priority?: RequestPriority;

  /** Staff only: cases flagged as safety escalations. */
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean()
  escalated?: boolean;
}

export const REVIEW_ACTIONS = ['START', 'REQUIRE_FOLLOW_UP', 'APPROVE', 'REJECT'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export class ReviewCaseDto {
  /**
   * START: NEW -> UNDER_REVIEW. REQUIRE_FOLLOW_UP: ask the customer a question (reason = the question).
   * APPROVE: ready for assignment. REJECT: close the case (reason is shown to the customer).
   */
  @IsIn(REVIEW_ACTIONS)
  action!: ReviewAction;

  @ValidateIf((o: ReviewCaseDto) => o.action === 'REQUIRE_FOLLOW_UP' || o.action === 'REJECT' || o.reason !== undefined)
  @IsString() @MinLength(3) @MaxLength(2000)
  reason?: string;
}

export class UpdateCaseDto {
  @IsOptional() @IsString() @MaxLength(4000)
  summary?: string;

  @IsOptional() @IsEnum(UrgencyLevel)
  urgency_level?: UrgencyLevel;

  @IsOptional() @IsString() @MaxLength(100)
  problem_type?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(300, { each: true })
  symptoms?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(300, { each: true })
  possible_causes?: string[];
}

export class FollowUpResponseDto {
  @IsString() @IsNotEmpty() @MaxLength(4000)
  answer!: string;
}

export class CancelCaseDto {
  @IsString() @MinLength(3) @MaxLength(2000)
  reason!: string;
}
