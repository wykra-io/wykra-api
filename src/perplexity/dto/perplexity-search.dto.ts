import { IsOptional, IsString } from 'class-validator';

export class PerplexitySearchDTO {
  @IsOptional()
  @IsString()
  model?: string;
}
