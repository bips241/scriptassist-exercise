import { IsString, IsUUID, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @IsUUID()
  userId: string;

  @IsString()
  @MinLength(10)
  refreshToken: string;
}
