import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PerplexityChatDTO {
  @IsNotEmpty()
  @IsString()
  message!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;
}
