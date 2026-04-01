import { SetMetadata } from '@nestjs/common';
import type { Role } from '@ledgerread/contracts';

export const ALLOWED_ROLES_KEY = 'allowedRoles';
export const AllowedRoles = (...roles: Role[]) => SetMetadata(ALLOWED_ROLES_KEY, roles);

