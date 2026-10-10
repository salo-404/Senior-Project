import { IsBoolean, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/** The customer confirms the summary ({ confirmed: true }) or corrects it ({ confirmed: false, note }). */
export class ConfirmSummaryDto {
  @IsBoolean()
  confirmed!: boolean;

  /** Required with confirmed: false. Not allowed with confirmed: true (checked in the service). */
  @ValidateIf((o: ConfirmSummaryDto) => o.confirmed === false || o.note !== undefined)
  @IsString() @MinLength(3) @MaxLength(2000)
  note?: string;
}
