import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAddressDto {
  @IsOptional() @IsString() @MaxLength(100)
  label?: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  street!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  city!: string;

  @IsOptional() @IsString() @MaxLength(100)
  district?: string;

  @IsOptional() @IsString() @MaxLength(50)
  floor?: string;

  @IsOptional() @IsString() @MaxLength(100)
  building?: string;

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;

  /** The customer's first address is always the default; later ones only when this is true. */
  @IsOptional() @IsBoolean()
  is_default?: boolean;
}

export class UpdateAddressDto {
  @IsOptional() @IsString() @MaxLength(100)
  label?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  street?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  city?: string;

  @IsOptional() @IsString() @MaxLength(100)
  district?: string;

  @IsOptional() @IsString() @MaxLength(50)
  floor?: string;

  @IsOptional() @IsString() @MaxLength(100)
  building?: string;

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;

  /** Only `true` is accepted: making an address the default un-defaults the others. */
  @IsOptional() @IsBoolean()
  is_default?: boolean;
}
