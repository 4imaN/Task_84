import type { ReadingPreferences, Role } from '@ledgerread/contracts';
import { versionedMigrations } from './migrations';

export interface SeedUser {
  username: string;
  displayName: string;
  role: Role;
  password: string;
  externalIdentifier: string;
}

export interface VersionedMigration {
  version: string;
  statements: string[];
}

export const defaultReadingPreferences: ReadingPreferences = {
  fontFamily: 'Merriweather',
  fontSize: 18,
  lineSpacing: 1.5,
  readerMode: 'PAGINATION',
  theme: 'paper',
  nightMode: false,
  chineseMode: 'SIMPLIFIED',
  updatedAt: '2026-03-28T00:00:00.000Z',
};

export { versionedMigrations };

export const migrations = versionedMigrations.flatMap((migration) => migration.statements);

export const seedUsers: SeedUser[] = [
  {
    username: 'reader.ada',
    displayName: 'Ada Reader',
    role: 'CUSTOMER',
    password: 'Reader!2026',
    externalIdentifier: 'CUSTOMER-0001',
  },
  {
    username: 'reader.mei',
    displayName: 'Mei Reader',
    role: 'CUSTOMER',
    password: 'Reader!2026',
    externalIdentifier: 'CUSTOMER-0002',
  },
  {
    username: 'clerk.emma',
    displayName: 'Emma Clerk',
    role: 'CLERK',
    password: 'Clerk!2026',
    externalIdentifier: 'CLERK-0001',
  },
  {
    username: 'mod.noah',
    displayName: 'Noah Moderator',
    role: 'MODERATOR',
    password: 'Moderator!2026',
    externalIdentifier: 'MOD-0001',
  },
  {
    username: 'manager.li',
    displayName: 'Li Manager',
    role: 'MANAGER',
    password: 'Manager!2026',
    externalIdentifier: 'MGR-0001',
  },
  {
    username: 'finance.zoe',
    displayName: 'Zoe Finance',
    role: 'FINANCE',
    password: 'Finance!2026',
    externalIdentifier: 'FIN-0001',
  },
  {
    username: 'inventory.ivan',
    displayName: 'Ivan Inventory',
    role: 'INVENTORY_MANAGER',
    password: 'Inventory!2026',
    externalIdentifier: 'INV-0001',
  },
];
