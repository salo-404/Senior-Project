import { MaintenanceCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';

export class CreateEquipmentDto {
  @IsUUID()
  equipment_type_id!: string;

  /** Where the unit is installed; must be one of the customer's addresses. */
  @IsOptional() @IsUUID()
  address_id?: string;

  @IsString() @IsNotEmpty() @MaxLength(150)
  name!: string;

  @IsOptional() @IsString() @MaxLength(100)
  brand?: string;

  @IsOptional() @IsString() @MaxLength(100)
  model?: string;

  @IsOptional() @IsString() @MaxLength(100)
  serial_number?: string;

  @IsOptional() @Type(() => Date) @IsDate()
  installation_date?: Date;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class UpdateEquipmentDto {
  @IsOptional() @IsUUID()
  address_id?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(150)
  name?: string;

  @IsOptional() @IsString() @MaxLength(100)
  brand?: string;

  @IsOptional() @IsString() @MaxLength(100)
  model?: string;

  @IsOptional() @IsString() @MaxLength(100)
  serial_number?: string;

  @IsOptional() @Type(() => Date) @IsDate()
  installation_date?: Date;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class ListEquipmentTypesQuery {
  @IsOptional() @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory;
}

export class ListEquipmentQuery extends PaginationQuery {}
