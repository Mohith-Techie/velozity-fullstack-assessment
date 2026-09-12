import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { isLocalDatabase } from '../src/lib/databaseUrl.js';

const HOSTED_URL = 'postgresql://owner:secret@db.example.com:5432/production?sslmode=require';

test('the seed refuses to wipe a non-local database', () => {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: HOSTED_URL };
  delete env.SEED_ALLOW_REMOTE;
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], { env, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Refusing to wipe the database at "db\.example\.com"/);
});

test('only databases on this machine count as local', () => {
  assert.equal(isLocalDatabase('postgresql://postgres:postgres@localhost:5432/pm_dashboard'), true);
  assert.equal(isLocalDatabase('postgres://postgres:postgres@127.0.0.1:51214/template1?sslmode=disable'), true);
  assert.equal(isLocalDatabase(HOSTED_URL), false);
  assert.equal(isLocalDatabase('not a url'), false);
});
