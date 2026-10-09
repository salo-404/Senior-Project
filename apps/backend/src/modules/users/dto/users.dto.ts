import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';

const PHONE = /^\+?[0-9 ()-]{6,20}$/;

export class UpdateProfileDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  first_name?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  last_name?: string;

  @IsOptional() @IsString() @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone?: string;
}

/** Roles a manager may create. The role comes from this DTO, never from a public endpoint. */
export const STAFF_ROLES: Role[] = [Role.DISPATCHER, Role.MANAGER];

export class CreateStaffDto {
  @IsEmail() @MaxLength(254)
  email!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  first_name!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  last_name!: string;

  @IsOptional() @IsString() @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone?: string;

  @IsIn(STAFF_ROLES)
  role!: Role;
}

export class ChangeRoleDto {
  @IsIn(STAFF_ROLES)
  role!: Role;
}

export class ListUsersQuery extends PaginationQuery {
  @IsOptional() @IsIn(Object.values(Role))
  role?: Role;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  is_active?: boolean;

  @IsOptional() @IsString() @MaxLength(100)
  q?: string;
}

export class ActivateAccountDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  token!: string;

  @IsString() @MinLength(8) @MaxLength(128)
  password!: string;
}
