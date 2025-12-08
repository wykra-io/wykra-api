import { IsString } from 'class-validator';

export class PerplexitySearchChainDTO {
  @IsString()
  query: string;
}
