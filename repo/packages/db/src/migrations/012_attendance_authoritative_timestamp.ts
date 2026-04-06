import type { VersionedMigration } from '../index';

export const attendanceAuthoritativeTimestampMigration: VersionedMigration = {
  version: '012_attendance_authoritative_timestamp',
  statements: [
    `
    ALTER TABLE attendance_records
      ADD COLUMN IF NOT EXISTS client_occurred_at TIMESTAMPTZ;
    `,
  ],
};
