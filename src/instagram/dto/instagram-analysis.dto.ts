import { IsNotEmpty, IsString } from 'class-validator';

export class InstagramAnalysisDTO {
  @IsNotEmpty()
  @IsString()
  profile!: string;
}
