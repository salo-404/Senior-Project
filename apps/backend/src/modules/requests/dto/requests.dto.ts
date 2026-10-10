import { ContactPreference, RequestPriority } from '@prisma/client';
import { IsEnum, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** The detailed form for NORMAL and URGENT requests (EMERGENCY uses the short form below). */
export class CreateRequestDto {
  @IsUUID()
  equipment_id!: string;

  @IsUUID()
  address_id!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @IsString() @MinLength(10) @MaxLength(4000)
  description!: string;

  /** NORMAL by default. URGENT is only sorted higher in the dispatcher queue. */
  @IsOptional() @IsIn([RequestPriority.NORMAL, RequestPriority.URGENT])
  priority?: 'NORMAL' | 'URGENT';

  @IsOptional() @IsString() @MaxLength(100)
  problem_type?: string;

  /** Structured answers from the intake form. `safety_concern: true` marks the request as a safety escalation. */
  @IsOptional() @IsObject()
  intake_answers?: Record<string, unknown>;

  /** e.g. "en", "ar", "ar-LB", "ar-latn" */
  @IsOptional() @IsString() @MaxLength(20)
  language?: string;
}

/** The customer's answer to the fixed safety question ("Is there a burning smell right now?"). */
export class SafetyConfirmDto {
  @IsIn(['yes', 'no'])
  answer!: 'yes' | 'no';
}

/** The simplified EMERGENCY form: no title (the backend generates one) and no AI. */
export class CreateEmergencyDto {
  @IsUUID()
  equipment_id!: string;

  /** Defaults to the customer's default address. */
  @IsOptional() @IsUUID()
  address_id?: string;

  @IsString() @MinLength(5) @MaxLength(1000)
  description!: string;

  @IsEnum(ContactPreference)
  contact_preference!: ContactPreference;

  @IsOptional() @IsString() @MaxLength(20)
  language?: string;
}
