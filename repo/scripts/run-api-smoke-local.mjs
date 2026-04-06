import { spawn } from 'node:child_process';

const DEFAULT_ADMIN_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ledgerread';
const DEFAULT_APP_DATABASE_URL = 'postgresql://ledgerread_app:ledgerread_app@localhost:5432/ledgerread';

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

const requireEnv = (name, helpText) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for local backend smoke verification. ${helpText}`);
  }

  return value;
};

const waitForHttp = async (baseUrl, serverProcess) => {
  let unexpectedExitCode = null;
  serverProcess.once('exit', (code) => {
    unexpectedExitCode = code ?? 0;
  });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (unexpectedExitCode !== null) {
      throw new Error(`API server exited early with code ${unexpectedExitCode}.`);
    }

    try {
      const response = await fetch(`${baseUrl}/auth/session`, {
        redirect: 'manual',
      });

      if (response.status === 401 && response.headers.get('x-trace-id')) {
        return;
      }
    } catch {
      // Wait for the server to start listening.
    }

    await wait(500);
  }

  throw new Error(`Timed out waiting for ${baseUrl}/auth/session to respond.`);
};

const stopServer = async (serverProcess) => {
  if (serverProcess.killed) {
    return;
  }

  await new Promise((resolve) => {
    const forceKillTimer = setTimeout(() => {
      serverProcess.kill('SIGKILL');
    }, 5_000);

    serverProcess.once('exit', () => {
      clearTimeout(forceKillTimer);
      resolve();
    });

    serverProcess.kill('SIGTERM');
  });
};

try {
  const encryptionKey = requireEnv(
    'APP_ENCRYPTION_KEY',
    'Example: export APP_ENCRYPTION_KEY=$(openssl rand -hex 32)',
  );

  const port = process.env.PORT?.trim() || '4100';
  const baseUrl = process.env.APP_BASE_URL?.trim() || `http://localhost:${port}`;
  const adminDatabaseUrl =
    process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
  const appDatabaseUrl = process.env.APP_DATABASE_URL ?? deriveAppDatabaseUrl(adminDatabaseUrl);

  const baseEnv = {
    ...process.env,
    APP_ENCRYPTION_KEY: encryptionKey,
    DATABASE_ADMIN_URL: adminDatabaseUrl,
    APP_DATABASE_URL: appDatabaseUrl,
    PORT: port,
    APP_BASE_URL: baseUrl,
    SESSION_TTL_MINUTES: process.env.SESSION_TTL_MINUTES ?? '30',
    EVIDENCE_STORAGE_ROOT: process.env.EVIDENCE_STORAGE_ROOT ?? '/tmp/ledgerread-evidence',
    ATTENDANCE_EVIDENCE_MAX_BYTES: process.env.ATTENDANCE_EVIDENCE_MAX_BYTES ?? '5242880',
  };
  const migrationEnv = {
    ...baseEnv,
    DATABASE_URL: adminDatabaseUrl,
  };
  const runtimeEnv = {
    ...baseEnv,
    DATABASE_URL: appDatabaseUrl,
  };

  await resetDatabase(adminDatabaseUrl);
  await run('npm', ['run', 'build:api'], migrationEnv);
  await run('npm', ['run', 'migrate', '-w', '@ledgerread/api'], migrationEnv);
  await run('npm', ['run', 'seed', '-w', '@ledgerread/api'], migrationEnv);

  const serverProcess = spawn('npm', ['run', 'start', '-w', '@ledgerread/api'], {
    stdio: 'inherit',
    env: runtimeEnv,
    shell: false,
  });

  try {
    await waitForHttp(baseUrl, serverProcess);
    console.log(`Local backend smoke passed against ${baseUrl}.`);
  } finally {
    await stopServer(serverProcess);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
