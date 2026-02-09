import { IsIn, IsString, MinLength } from 'class-validator';

export class SocialAuthDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @IsIn(['telegram', 'google'])
  provider!: 'telegram' | 'google';
}
