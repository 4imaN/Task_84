import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const run = (command, args, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
      shell: false,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });

const runtimeKeyFile = resolve('.ledgerread-runtime/app_encryption_key');
const DEFAULT_ADMIN_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ledgerread';
const DEFAULT_APP_DATABASE_URL = 'postgresql://ledgerread_app:ledgerread_app@localhost:5432/ledgerread';

const resolveEncryptionKey = async () => {
  if (process.env.APP_ENCRYPTION_KEY?.trim()) {
    return process.env.APP_ENCRYPTION_KEY.trim();
  }

  try {
    return (await readFile(runtimeKeyFile, 'utf8')).trim();
  } catch {
    const generated = randomBytes(32).toString('hex');
    await mkdir(dirname(runtimeKeyFile), { recursive: true });
    await writeFile(runtimeKeyFile, generated, 'utf8');
    return generated;
  }
};

const describeDatabaseTarget = (connectionString) => {
  try {
    const parsed = new URL(connectionString);
    return {
      host: parsed.hostname || 'unknown-host',
      port: parsed.port || '5432',
      database: parsed.pathname.replace(/^\//, '') || 'unknown-database',
    };
  } catch {
    return {
      host: 'unparseable',
      port: 'unparseable',
      database: 'unparseable',
    };
  }
};

const deriveAppDatabaseUrl = (adminDatabaseUrl) => {
  try {
    const parsed = new URL(adminDatabaseUrl);
    parsed.username = 'ledgerread_app';
    parsed.password = 'ledgerread_app';
    return parsed.toString();
  } catch {
    return DEFAULT_APP_DATABASE_URL;
  }
};

const logDatabaseFailure = (connectionString, error) => {
  const target = describeDatabaseTarget(connectionString);
  console.error('Local PostgreSQL preflight failed before schema reset.');
  console.error(`DATABASE_URL host: ${target.host}`);
  console.error(`DATABASE_URL port: ${target.port}`);
  console.error(`DATABASE_URL database: ${target.database}`);
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  console.error('Fix hints:');
  console.error('- Confirm PostgreSQL is running and reachable from this machine.');
  console.error('- Confirm DATABASE_URL points at the correct host, port, database, user, and password.');
  console.error('- If you changed APP_ENCRYPTION_KEY previously, run against a disposable database or reset the schema first.');
};

const preflightDatabase = async (connectionString) => {
  const { Client } = await import('pg');
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (error) {
    logDatabaseFailure(connectionString, error);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
};

const resetDatabase = async (connectionString) => {
  const { Client } = await import('pg');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
};

try {
  const adminDatabaseUrl =
    process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
  const appDatabaseUrl = process.env.APP_DATABASE_URL ?? deriveAppDatabaseUrl(adminDatabaseUrl);

  const baseEnv = {
    ...process.env,
    DATABASE_ADMIN_URL: adminDatabaseUrl,
    APP_DATABASE_URL: appDatabaseUrl,
    APP_ENCRYPTION_KEY: await resolveEncryptionKey(),
    SESSION_TTL_MINUTES: process.env.SESSION_TTL_MINUTES ?? '30',
    APP_BASE_URL: process.env.APP_BASE_URL ?? 'http://localhost:4000',
    EVIDENCE_STORAGE_ROOT: process.env.EVIDENCE_STORAGE_ROOT ?? '/tmp/ledgerread-evidence',
    ATTENDANCE_EVIDENCE_MAX_BYTES: process.env.ATTENDANCE_EVIDENCE_MAX_BYTES ?? '5242880',
  };
  const migrationEnv = {
    ...baseEnv,
    DATABASE_URL: adminDatabaseUrl,
  };
  const testEnv = {
    ...baseEnv,
    DATABASE_URL: appDatabaseUrl,
  };

  await preflightDatabase(adminDatabaseUrl);
  await resetDatabase(adminDatabaseUrl);
  await run('npm', ['run', 'build:shared'], migrationEnv);
  await run('npm', ['run', 'migrate', '-w', '@ledgerread/api'], migrationEnv);
  await run('npm', ['run', 'seed', '-w', '@ledgerread/api'], migrationEnv);
  await run('npm', ['run', 'test', '-w', '@ledgerread/api'], testEnv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
