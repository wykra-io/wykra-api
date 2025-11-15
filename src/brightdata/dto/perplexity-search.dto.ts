import { IsNotEmpty, IsOptional, IsString, IsNumber, Min } from 'class-validator';

export class PerplexitySearchDTO {
  @IsNotEmpty()
  @IsString()
  url!: string;

  @IsNotEmpty()
  @IsString()
  prompt!: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  index?: number;
}

