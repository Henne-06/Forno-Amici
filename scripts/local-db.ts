import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
async function main() {
  const directory = resolve('.local/postgres');
  mkdirSync('.local', { recursive: true });
  const postgres = new EmbeddedPostgres({
    databaseDir: directory,
    port: 55432,
    user: 'forno',
    password: 'local-development-only',
    persistent: true,
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {},
    onError: () => {},
  });
  if (!existsSync(resolve(directory, 'PG_VERSION'))) await postgres.initialise();
  await postgres.start();
  const client = postgres.getPgClient();
  await client.connect();
  for (const name of ['forno', 'forno_test']) {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!result.rowCount) await client.query(`CREATE DATABASE ${name}`);
  }
  await client.end();
  console.log('PostgreSQL läuft auf 127.0.0.1:55432 (forno + forno_test). Beenden mit Ctrl+C.');
  const keepalive = setInterval(() => {}, 60000);
  const stop = async () => {
    clearInterval(keepalive);
    await postgres.stop();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
