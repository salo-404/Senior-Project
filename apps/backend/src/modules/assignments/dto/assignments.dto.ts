import { AssignmentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';

const PHONE = /^\+?[0-9 ()-]{6,20}$/;

export class CreateAssignmentDto {
  /** Any technician that appears in the ranking; the dispatcher is not bound to the top recommendation. */
  @IsUUID()
  technician_profile_id!: string;

  @IsOptional() @Type(() => Date) @IsDate()
  scheduled_at?: Date;

  /** Kept in the ranking snapshot with the assignment. */
  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

/** For an EMERGENCY when no internal technician is free. The external technician has no account. */
export class CreateExternalAssignmentDto {
  @IsString() @IsNotEmpty() @MaxLength(150)
  external_name!: string;

  @IsString() @Matches(PHONE, { message: 'external_phone must be a valid phone number' })
  external_phone!: string;

  @IsOptional() @Type(() => Date) @IsDate()
  scheduled_at?: Date;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class ListAssignmentsQuery extends PaginationQuery {
  @IsOptional() @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;

  @IsOptional() @IsUUID()
  request_id?: string;
}
