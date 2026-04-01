import type { Role, Workspace } from '@ledgerread/contracts';

export const adminRouteRoleMap: Record<string, Role[]> = {
  '/admin/overview': ['MANAGER', 'INVENTORY_MANAGER'],
  '/admin/finance': ['MANAGER', 'INVENTORY_MANAGER'],
  '/admin/inventory': ['MANAGER', 'INVENTORY_MANAGER'],
  '/admin/audits': ['MANAGER', 'INVENTORY_MANAGER'],
};

export const getWorkspaceLoginPath = (workspace?: Workspace) => {
  switch (workspace) {
    case 'pos':
      return '/pos/login';
    case 'mod':
      return '/mod/login';
    case 'admin':
      return '/admin/login';
    case 'finance':
      return '/finance/login';
    case 'app':
    default:
      return '/login';
  }
};

export const getWorkspaceHomePath = (workspace?: Workspace) => {
  switch (workspace) {
    case 'pos':
      return '/pos/checkout';
    case 'mod':
      return '/mod/queue';
    case 'admin':
      return '/admin/overview';
    case 'finance':
      return '/finance/settlements';
    case 'app':
    default:
      return '/app/library';
  }
};

export const getAllowedAdminNavigation = (role?: Role) =>
  Object.entries(adminRouteRoleMap)
    .filter(([, roles]) => (role ? roles.includes(role) : false))
    .map(([path]) => path);

export const getAdminFallbackPath = (role?: Role) => getAllowedAdminNavigation(role)[0] ?? '/admin/login';

export const isAllowedAdminPath = (role: Role | undefined, path: keyof typeof adminRouteRoleMap) =>
  Boolean(role && (adminRouteRoleMap[path] ?? []).includes(role));
