import { CommissionTierName, TierRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';
import { RegisterDto } from '../../../infra/auth/dto/auth.dto';

export class ApplicationSkillDto {
  @IsUUID()
  skill_id!: string;

  /** 1 (basic) to 5 (expert), self-assessed; the manager reviews it. */
  @IsInt() @Min(1) @Max(5)
  proficiency_level!: number;
}

/** The application template: what the technician applies for and their background. */
export class ApplicationDetailsDto {
  /** Picked from GET /skills. The job categories applied for are derived from these. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => ApplicationSkillDto)
  skills!: ApplicationSkillDto[];

  @Type(() => Number) @IsInt() @Min(0) @Max(80)
  years_of_experience!: number;

  @IsString() @MinLength(20) @MaxLength(2000)
  bio!: string;

  // Requested hourly rates; the manager may adjust them when approving.
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10000)
  normal_rate!: number;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10000)
  emergency_rate!: number;

  @IsOptional() @IsEnum(CommissionTierName)
  proposed_tier?: CommissionTierName;

  /** Certifications, previous employers, anything else that supports the application. */
  @IsOptional() @IsString() @MaxLength(4000)
  supporting_notes?: string;
}

/** Public signup as a technician: the account fields plus the application template. */
export class RegisterTechnicianDto extends RegisterDto {
  // IsDefined + IsObject: ValidateNested alone lets a missing value through.
  @IsDefined() @IsObject() @ValidateNested() @Type(() => ApplicationDetailsDto)
  application!: ApplicationDetailsDto;
}

/** A rejected technician applying again with the existing account. */
export class ReapplyDto extends ApplicationDetailsDto {}

export class DecideApplicationDto {
  @IsIn([TierRequestStatus.APPROVED, TierRequestStatus.REJECTED])
  decision!: 'APPROVED' | 'REJECTED';

  /** Required when rejecting; the applicant sees it. */
  @ValidateIf((o: DecideApplicationDto) => o.decision === 'REJECTED' || o.review_notes !== undefined)
  @IsString() @MinLength(1) @MaxLength(2000)
  review_notes?: string;

  /** Tier granted on approval; defaults to the proposed tier, then BRONZE. */
  @IsOptional() @IsEnum(CommissionTierName)
  final_tier?: CommissionTierName;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10000)
  normal_rate?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10000)
  emergency_rate?: number;
}

export class ListApplicationsQuery extends PaginationQuery {
  @IsOptional() @IsEnum(TierRequestStatus)
  status?: TierRequestStatus;
}
