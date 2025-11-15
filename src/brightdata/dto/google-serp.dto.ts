import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class GoogleSerpDTO {
  @IsNotEmpty()
  @IsString()
  keyword!: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  startPage?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  endPage?: number;
}
