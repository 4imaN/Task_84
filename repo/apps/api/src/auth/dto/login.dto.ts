import { IsIn, IsString } from 'class-validator';
import type { Workspace } from '@ledgerread/contracts';

export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;

  @IsString()
  @IsIn(['app', 'pos', 'mod', 'admin', 'finance'])
  workspace!: Workspace;
}
