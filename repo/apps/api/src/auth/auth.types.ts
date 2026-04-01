import type { Role, Workspace } from '@ledgerread/contracts';

export interface AuthenticatedUserRecord {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isSuspended: boolean;
}

export interface SessionRecord extends AuthenticatedUserRecord {
  workspace: Workspace;
  tokenHash: string;
  lastActivityAt: string;
  expiresAt: string;
}

