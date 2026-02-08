import { IsEmail, IsString, MinLength } from 'class-validator';

export class EmailAuthDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
