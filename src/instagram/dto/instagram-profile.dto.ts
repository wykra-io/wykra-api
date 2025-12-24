import { IsNotEmpty, IsString } from 'class-validator';

export class InstagramProfileDTO {
  @IsNotEmpty()
  @IsString()
  profile!: string;
}
