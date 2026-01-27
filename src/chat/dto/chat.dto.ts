import { IsNotEmpty, IsOptional, IsString, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class ChatDTO {
  @IsNotEmpty()
  @IsString()
  query!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sessionId?: number;
}
