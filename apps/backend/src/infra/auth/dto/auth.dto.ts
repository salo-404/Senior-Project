import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const PHONE = /^\+?[0-9 ()-]{6,20}$/;

/**
 * Deliberately has no `role` field: the role is set by the backend and the global ValidationPipe
 * (forbidNonWhitelisted) rejects a request that tries to send one.
 */
export class RegisterDto {
  @IsEmail() @MaxLength(254)
  email!: string;

  @IsString() @MinLength(8) @MaxLength(128)
  password!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  first_name!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  last_name!: string;

  @IsOptional() @IsString() @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone?: string;
}

export class LoginDto {
  @IsEmail() @MaxLength(254)
  email!: string;

  // No MinLength here: the login form must not reveal the password policy.
  @IsString() @IsNotEmpty() @MaxLength(128)
  password!: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(128)
  old_password!: string;

  @IsString() @MinLength(8) @MaxLength(128)
  new_password!: string;
}
