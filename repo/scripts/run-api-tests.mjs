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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const waitForPostgres = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await run('docker', ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'postgres', '-d', 'ledgerread']);
      return;
    } catch {
      await wait(2000);
    }
  }

  throw new Error('PostgreSQL did not become ready in time.');
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
  await run('docker', ['compose', 'up', '-d', 'postgres']);
  await waitForPostgres();
  await resetDatabase(adminDatabaseUrl);
  await run('npm', ['run', 'build:shared'], migrationEnv);
  await run('npm', ['run', 'migrate', '-w', '@ledgerread/api'], migrationEnv);
  await run('npm', ['run', 'seed', '-w', '@ledgerread/api'], migrationEnv);
  await run('npm', ['run', 'test', '-w', '@ledgerread/api'], testEnv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
