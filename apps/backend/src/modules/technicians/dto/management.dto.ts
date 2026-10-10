import { MaintenanceCategory, TierDecisionOutcome, TierRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsEnum,
  IsNumber,
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
import { ApplicationSkillDto } from './technicians.dto';

// ---------------------------------------------------------------- tier requests

/** A technician asks a manager to review their tier and/or add skills. */
export class CreateTierRequestDto {
  @IsString() @MinLength(3) @MaxLength(2000)
  notes!: string;

  /** Skills to add; the manager decides. Picked from GET /skills. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsUUID(undefined, { each: true })
  skillIds?: string[];
}

export class DecideTierRequestDto {
  @IsEnum(TierDecisionOutcome)
  outcome!: TierDecisionOutcome;

  /** For TIER_CHANGED: the tier to grant. Defaults to the tier the request proposed. */
  @IsOptional() @IsUUID()
  finalTierId?: string;

  /** Required when nothing changes, so the technician learns why. */
  @ValidateIf((o: DecideTierRequestDto) => o.outcome === TierDecisionOutcome.NO_CHANGE || o.notes !== undefined)
  @IsString() @MinLength(1) @MaxLength(2000)
  notes?: string;
}

export class ListTierRequestsQuery extends PaginationQuery {
  @IsOptional() @IsEnum(TierRequestStatus)
  status?: TierRequestStatus;
}

// ---------------------------------------------------------------- profile management

export class UpdateRatesDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10000)
  normal_rate!: number;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10000)
  emergency_rate!: number;
}

/**
 * The shape is checked by the service (422 with every problem). The DTO only requires the field to be present:
 * null is allowed (it clears the schedule), a missing field is not. IsDefined alone would reject null too, so it
 * is applied only when the value is undefined.
 */
export class SetScheduleDto {
  @ValidateIf((o: SetScheduleDto) => o.schedule === undefined)
  @IsDefined()
  schedule!: unknown;
}

export class SetSkillsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ApplicationSkillDto)
  skills!: ApplicationSkillDto[];
}

// ---------------------------------------------------------------- catalogue

export class CreateSkillDto {
  @IsString() @MinLength(2) @MaxLength(100)
  name!: string;

  @IsEnum(MaintenanceCategory)
  category!: MaintenanceCategory;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;
}

export class CreateTeamDto {
  @IsString() @MinLength(2) @MaxLength(100)
  name!: string;

  @IsEnum(MaintenanceCategory)
  category!: MaintenanceCategory;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;
}

export class AddTeamMemberDto {
  /** The technician's user id (team_members.user_id references technician_profiles.user_id). */
  @IsUUID()
  user_id!: string;

  @IsOptional() @IsString() @MaxLength(100)
  role_in_team?: string;
}
