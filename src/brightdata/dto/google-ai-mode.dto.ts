import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GoogleAiModeItemDTO {
  @IsNotEmpty()
  @IsString()
  url!: string;

  @IsNotEmpty()
  @IsString()
  prompt!: string;

  @IsOptional()
  @IsString()
  country?: string;
}

export class GoogleAiModeDTO {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoogleAiModeItemDTO)
  items!: GoogleAiModeItemDTO[];
}
