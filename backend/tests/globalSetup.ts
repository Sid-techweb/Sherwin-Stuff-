import dotenv from 'dotenv';
import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

// Rebuilds the TEST database schema from the real migration files before the suite runs.
export default async function setup() {
  dotenv.config();
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://bmw:bmw_dev_password@localhost:5440/bmw_test';
  if (!/_test(\?|$)/.test(url)) throw new Error(`Refusing to reset a database whose name does not end in _test: ${url}`);
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const dir = path.resolve(__dirname, '../../database/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  await client.end();
}
