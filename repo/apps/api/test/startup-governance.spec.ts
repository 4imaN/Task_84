import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client, Pool } from 'pg';

const DEFAULT_ADMIN_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ledgerread';
const seedMarkerKey = 'baseline_seed_version';
const seedMarkerVersion = 'ledgerread_baseline_v1';
const apiRoot = resolve(__dirname, '..');
const fallbackEncryptionKey = randomBytes(32).toString('hex');

const resolveEncryptionKey = () => {
  return process.env.APP_ENCRYPTION_KEY?.trim() || fallbackEncryptionKey;
};

const toMaintenanceDatabaseUrl = (connectionString: string) => {
  const parsed = new URL(connectionString);
  parsed.pathname = '/postgres';
  return parsed.toString();
};

const toDatabaseUrl = (connectionString: string, databaseName: string) => {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
};

const runApiScript = async (
  script: 'migrate' | 'seed',
  databaseUrl: string,
  extraEnv: NodeJS.ProcessEnv = {},
) => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_ADMIN_URL: databaseUrl,
    DATABASE_URL: databaseUrl,
    APP_DATABASE_URL: databaseUrl,
    APP_ENCRYPTION_KEY: resolveEncryptionKey(),
    NODE_ENV: 'test',
    ...extraEnv,
  };

  return await new Promise<{ code: number; stdout: string; stderr: string }>((resolveRun, reject) => {
    const child = spawn('npm', ['run', script], {
      cwd: apiRoot,
      env,
      shell: false,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      resolveRun({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
};

const createIsolatedDatabase = async (adminDatabaseUrl: string) => {
  const databaseName = `ledgerread_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const maintenanceClient = new Client({
    connectionString: toMaintenanceDatabaseUrl(adminDatabaseUrl),
  });
  await maintenanceClient.connect();
  try {
    await maintenanceClient.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await maintenanceClient.end();
  }

  return {
    databaseName,
    databaseUrl: toDatabaseUrl(adminDatabaseUrl, databaseName),
  };
};

const dropIsolatedDatabase = async (adminDatabaseUrl: string, databaseName: string) => {
  const maintenanceClient = new Client({
    connectionString: toMaintenanceDatabaseUrl(adminDatabaseUrl),
  });
  await maintenanceClient.connect();
  try {
    await maintenanceClient.query(
      `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()
      `,
      [databaseName],
    );
    await maintenanceClient.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await maintenanceClient.end();
  }
};

describe('Startup and governance robustness', () => {
  const adminDatabaseUrl =
    process.env.DATABASE_ADMIN_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    DEFAULT_ADMIN_DATABASE_URL;

  it(
    'initializes empty databases, skips complete baselines, and fails fast on partial seed state',
    async () => {
      const isolated = await createIsolatedDatabase(adminDatabaseUrl);
      const pool = new Pool({ connectionString: isolated.databaseUrl });

      try {
        const migrate = await runApiScript('migrate', isolated.databaseUrl);
        expect(migrate.code).toBe(0);

        const firstSeed = await runApiScript('seed', isolated.databaseUrl);
        expect(firstSeed.code).toBe(0);
        expect(firstSeed.stdout).not.toContain('Seed skipped:');

        const marker = await pool.query<{ seed_value: string }>(
          'SELECT seed_value FROM seed_metadata WHERE seed_key = $1',
          [seedMarkerKey],
        );
        expect(marker.rows[0]!.seed_value).toBe(seedMarkerVersion);

        const commentsBeforeSkip = await pool.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM comments',
        );
        expect(Number(commentsBeforeSkip.rows[0]!.count)).toBeGreaterThan(0);

        const secondSeed = await runApiScript('seed', isolated.databaseUrl);
        expect(secondSeed.code).toBe(0);
        expect(secondSeed.stdout).toContain('Seed skipped: database baseline is complete.');

        const commentsAfterSkip = await pool.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM comments',
        );
        expect(commentsAfterSkip.rows[0]!.count).toBe(commentsBeforeSkip.rows[0]!.count);

        await pool.query('DELETE FROM seed_metadata WHERE seed_key = $1', [seedMarkerKey]);
        await pool.query(
          `
          DELETE FROM rule_versions
          WHERE rule_key = 'evidence-file-mismatch'
            AND version = 1
          `,
        );

        const partialSeed = await runApiScript('seed', isolated.databaseUrl);
        expect(partialSeed.code).not.toBe(0);
        expect(`${partialSeed.stdout}\n${partialSeed.stderr}`).toContain('Partial seed initialization detected');

        const missingRule = await pool.query<{ count: string }>(
          `
          SELECT COUNT(*)::text AS count
          FROM rule_versions
          WHERE rule_key = 'evidence-file-mismatch'
            AND version = 1
          `,
        );
        expect(Number(missingRule.rows[0]!.count)).toBe(0);
      } finally {
        await pool.end();
        await dropIsolatedDatabase(adminDatabaseUrl, isolated.databaseName);
      }
    },
    180_000,
  );

  it(
    'normalizes legacy migration versions and keeps rule_versions unique across repeated seeds',
    async () => {
      const isolated = await createIsolatedDatabase(adminDatabaseUrl);
      const pool = new Pool({ connectionString: isolated.databaseUrl });

      try {
        const migrate = await runApiScript('migrate', isolated.databaseUrl);
        expect(migrate.code).toBe(0);
        const seed = await runApiScript('seed', isolated.databaseUrl);
        expect(seed.code).toBe(0);

        await pool.query(
          `
          UPDATE schema_migrations
          SET version = '005'
          WHERE version = '005_reconciliation_workflow_cleanup'
          `,
        );
        await pool.query("DELETE FROM schema_migrations WHERE version = '007_rule_versions_uniqueness'");
        await pool.query('ALTER TABLE rule_versions DROP CONSTRAINT IF EXISTS rule_versions_rule_key_version_key');

        await pool.query(
          `
          INSERT INTO rule_versions (rule_key, version, definition)
          VALUES ('missing-clock-out', 1, $1::jsonb)
          `,
          [JSON.stringify({ thresholdHours: 6, description: 'duplicate rule version entry' })],
        );

        const duplicatesBefore = await pool.query<{ count: string }>(
          `
          SELECT COUNT(*)::text AS count
          FROM rule_versions
          WHERE rule_key = 'missing-clock-out'
            AND version = 1
          `,
        );
        expect(Number(duplicatesBefore.rows[0]!.count)).toBeGreaterThan(1);

        const rerunMigrate = await runApiScript('migrate', isolated.databaseUrl);
        expect(rerunMigrate.code).toBe(0);

        const migrationVersions = await pool.query<{ version: string }>(
          `
          SELECT version
          FROM schema_migrations
          WHERE version IN ('005', '005_reconciliation_workflow_cleanup', '007_rule_versions_uniqueness')
          ORDER BY version
          `,
        );
        const versionList = migrationVersions.rows.map((row) => row.version);
        expect(versionList).toContain('005_reconciliation_workflow_cleanup');
        expect(versionList).toContain('007_rule_versions_uniqueness');
        expect(versionList).not.toContain('005');

        const uniquenessConstraint = await pool.query<{ exists: boolean }>(
          `
          SELECT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'rule_versions_rule_key_version_key'
              AND conrelid = 'rule_versions'::regclass
          ) AS exists
          `,
        );
        expect(uniquenessConstraint.rows[0]!.exists).toBe(true);

        const duplicatesAfter = await pool.query<{ count: string }>(
          `
          SELECT COUNT(*)::text AS count
          FROM rule_versions
          WHERE rule_key = 'missing-clock-out'
            AND version = 1
          `,
        );
        expect(Number(duplicatesAfter.rows[0]!.count)).toBe(1);

        const firstReset = await runApiScript('seed', isolated.databaseUrl, {
          LEDGERREAD_SEED_RESET: '1',
        });
        expect(firstReset.code).toBe(0);
        const secondReset = await runApiScript('seed', isolated.databaseUrl, {
          LEDGERREAD_SEED_RESET: '1',
        });
        expect(secondReset.code).toBe(0);

        const perRuleVersionCounts = await pool.query<{
          rule_key: string;
          version: number;
          count: string;
        }>(
          `
          SELECT rule_key, version, COUNT(*)::text AS count
          FROM rule_versions
          WHERE (rule_key = 'missing-clock-out' AND version = 1)
             OR (rule_key = 'evidence-file-mismatch' AND version = 1)
          GROUP BY rule_key, version
          ORDER BY rule_key ASC
          `,
        );
        expect(perRuleVersionCounts.rows).toHaveLength(2);
        expect(perRuleVersionCounts.rows.every((row) => Number(row.count) === 1)).toBe(true);
      } finally {
        await pool.end();
        await dropIsolatedDatabase(adminDatabaseUrl, isolated.databaseName);
      }
    },
    180_000,
  );

  it(
    'rejects non-compliant seed/bootstrap passwords before creating accounts',
    async () => {
      const isolated = await createIsolatedDatabase(adminDatabaseUrl);
      const pool = new Pool({ connectionString: isolated.databaseUrl });

      try {
        const migrate = await runApiScript('migrate', isolated.databaseUrl);
        expect(migrate.code).toBe(0);

        const invalidSeed = await runApiScript('seed', isolated.databaseUrl, {
          LEDGERREAD_SEED_PASSWORD_OVERRIDES: JSON.stringify({
            'reader.ada': 'short',
          }),
        });

        expect(invalidSeed.code).not.toBe(0);
        expect(`${invalidSeed.stdout}\n${invalidSeed.stderr}`).toContain(
          'Seed password for reader.ada must be at least 10 characters and include at least one number and one symbol.',
        );

        const userCount = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
        expect(Number(userCount.rows[0]!.count)).toBe(0);
      } finally {
        await pool.end();
        await dropIsolatedDatabase(adminDatabaseUrl, isolated.databaseName);
      }
    },
    180_000,
  );
});
