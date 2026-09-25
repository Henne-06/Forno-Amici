import 'dotenv/config';
import { cpSync, existsSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const server = new URL('.next/standalone/server.js', root);
if (!existsSync(server)) throw new Error('Bitte zuerst npm run build ausführen.');
cpSync(new URL('.next/static', root), new URL('.next/standalone/.next/static', root), {
  recursive: true,
});
cpSync(new URL('public', root), new URL('.next/standalone/public', root), { recursive: true });
process.env.HOSTNAME = process.env.HOSTNAME || '0.0.0.0';
await import(server.href);
