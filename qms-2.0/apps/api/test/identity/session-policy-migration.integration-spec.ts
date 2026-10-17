import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).port === '55440') {
  throw new Error('Session migration acceptance requires a disposable PostgreSQL database.');
}

it('preserves existing session expiry and authenticator binding when adding lifetime and preference defaults', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const schema = `identity_upgrade_${randomUUID().replaceAll('-', '')}`;
  const expiresAt = new Date('2030-01-01T12:00:00.000Z');
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}";
      CREATE TABLE sessions (id integer PRIMARY KEY, expires_at timestamptz NOT NULL);
      CREATE TABLE mfa_challenges (id integer PRIMARY KEY);
      CREATE TABLE password_change_challenges (id integer PRIMARY KEY);
      CREATE TABLE users (id integer PRIMARY KEY, mfa_enabled boolean NOT NULL);
      INSERT INTO mfa_challenges VALUES (1);
      INSERT INTO password_change_challenges VALUES (1);
      INSERT INTO users VALUES (1, true), (2, false);`);
    await client.query('INSERT INTO sessions VALUES (1, $1)', [expiresAt]);
    for (const directory of ['20261017100000_remember_login', '20261017110000_mfa_preference']) {
      await client.query(await readFile(`prisma/migrations/${directory}/migration.sql`, 'utf8'));
    }
    expect((await client.query('SELECT expires_at, lifetime_type::text FROM sessions')).rows).toEqual([
      { expires_at: expiresAt, lifetime_type: 'STANDARD' },
    ]);
    expect((await client.query('SELECT remember_me FROM mfa_challenges')).rows).toEqual([{ remember_me: false }]);
    expect((await client.query('SELECT remember_me FROM password_change_challenges')).rows).toEqual([{ remember_me: false }]);
    expect((await client.query('SELECT id, mfa_enabled, mfa_preference::text FROM users ORDER BY id')).rows).toEqual([
      { id: 1, mfa_enabled: true, mfa_preference: 'DEFAULT' },
      { id: 2, mfa_enabled: false, mfa_preference: 'DEFAULT' },
    ]);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
