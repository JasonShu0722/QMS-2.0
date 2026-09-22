import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import { connect } from 'node:tls';

for (const key of ['QMS_ACCEPTANCE_TLS_URL', 'QMS_ACCEPTANCE_TLS_HTTP_URL', 'QMS_ACCEPTANCE_TLS_CA', 'QMS_SEED_SUPPLIER_PASSWORD']) if (!process.env[key]) throw new Error(`${key} is required`);
const origin = new URL(process.env.QMS_ACCEPTANCE_TLS_URL);
if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'https:') throw new Error('An isolated loopback TLS gateway is required');
const ca = await readFile(process.env.QMS_ACCEPTANCE_TLS_CA);
function call(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const connection = request(new URL(path, origin), { ca, method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) } }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    connection.on('error', reject); connection.end(body ? JSON.stringify(body) : undefined);
  });
}
function protocol(version) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: origin.hostname, port: Number(origin.port), ca, minVersion: version, maxVersion: version }, () => { const result = socket.getProtocol(); socket.end(); resolve(result); });
    socket.on('error', reject);
  });
}

await test('real TLS termination and production session protections', async (suite) => {
  await suite.test('redirects HTTP to the configured public TLS port and preserves the path', async () => {
    const response = await fetch(new URL('/login?from=tls', process.env.QMS_ACCEPTANCE_TLS_HTTP_URL), { redirect: 'manual' });
    assert.equal(response.status, 308); assert.equal(response.headers.get('location'), new URL('/login?from=tls', origin).href);
  });
  await suite.test('verifies the certificate and negotiates TLS 1.2 and 1.3', async () => {
    assert.equal(await protocol('TLSv1.2'), 'TLSv1.2'); assert.equal(await protocol('TLSv1.3'), 'TLSv1.3');
    const page = await call('/login'); assert.equal(page.status, 200);
    assert.equal(page.headers['strict-transport-security'], 'max-age=31536000');
    assert.equal(page.headers['x-content-type-options'], 'nosniff'); assert.equal(page.headers['referrer-policy'], 'no-referrer');
  });
  await suite.test('authenticates through TLS with secure HttpOnly cookies and revokes the session', async () => {
    const csrf = await call('/api/v1/auth/csrf'); assert.equal(csrf.status, 200);
    const csrfToken = JSON.parse(csrf.body).csrfToken;
    const csrfCookie = csrf.headers['set-cookie'].find((entry) => entry.startsWith('qms_csrf='));
    assert.match(csrfCookie, /; Secure/);
    const cookie = csrfCookie.split(';')[0];
    const login = await call('/api/v1/auth/login', { method: 'POST', headers: { cookie, 'x-csrf-token': csrfToken }, body: { identifier: 'local.supplier', password: process.env.QMS_SEED_SUPPLIER_PASSWORD } });
    assert.equal(login.status, 200); assert.equal(JSON.parse(login.body).securityState, 'AUTHENTICATED');
    const sessionCookie = login.headers['set-cookie'].find((entry) => entry.startsWith('qms_session='));
    assert.ok(sessionCookie && /; Secure/.test(sessionCookie) && /; HttpOnly/.test(sessionCookie) && /; SameSite=Lax/.test(sessionCookie));
    const authenticated = `${cookie}; ${sessionCookie.split(';')[0]}`;
    assert.equal((await call('/api/v1/auth/session', { headers: { cookie: authenticated } })).status, 200);
    assert.equal((await call('/api/v1/auth/logout', { method: 'POST', headers: { cookie: authenticated, 'x-csrf-token': csrfToken } })).status, 204);
    assert.equal((await call('/api/v1/auth/session', { headers: { cookie: authenticated } })).status, 401);
  });
});
