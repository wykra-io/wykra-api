import { IsNotEmpty, IsString } from 'class-validator';

export class TikTokProfileDTO {
  @IsNotEmpty()
  @IsString()
  profile!: string;
}

