import { IsIn, IsString, Matches, MinLength } from 'class-validator';
import type { Workspace } from '@ledgerread/contracts';

export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  @MinLength(10)
  @Matches(/^(?=.*[0-9])(?=.*[^A-Za-z0-9]).{10,}$/)
  password!: string;

  @IsString()
  @IsIn(['app', 'pos', 'mod', 'admin', 'finance'])
  workspace!: Workspace;
}
