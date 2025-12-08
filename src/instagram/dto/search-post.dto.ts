import { IsNotEmpty, IsString } from 'class-validator';

export class SearchPostDto {
  @IsNotEmpty()
  @IsString()
  query!: string;
}
