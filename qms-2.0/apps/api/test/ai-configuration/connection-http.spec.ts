import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { requestAiText } from '../../src/modules/ai-configuration/ai-connection.http.js';

describe('AI bounded real HTTP transport', () => {
  let server: Server;
  let base: string;
  const secret = 'disposable-test-only-ai-secret';
  const original = { node: process.env.NODE_ENV, disposable: process.env.QMS_DISPOSABLE_TEST_DB };
  const received: Array<{ path: string; authorization: string | undefined; body: unknown }> = [];
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.QMS_DISPOSABLE_TEST_DB = 'true';
    server = createServer((request, response) => {
      let body = '';
      request.on('data', chunk => { body += String(chunk); });
      request.on('end', () => {
        received.push({ path: request.url!, authorization: request.headers.authorization, body: JSON.parse(body) });
        if (request.url === '/failure/chat/completions') { response.writeHead(401, { 'x-secret': secret }); response.end(secret); }
        else if (request.url === '/redirect/chat/completions') { response.writeHead(302, { location: `${base}/success` }); response.end(); }
        else if (request.url === '/oversize/chat/completions') { response.writeHead(200, { 'transfer-encoding': 'chunked' }); response.write('x'.repeat(40000)); response.end('x'.repeat(40000)); }
        else if (request.url === '/timeout/chat/completions') { response.writeHead(200, { 'content-type': 'application/json' }); response.flushHeaders(); return; }
        else if (request.url === '/echo/chat/completions') { response.end(JSON.stringify({ choices: [{ message: { content: secret } }] })); }
        else if (request.url === '/invalid/chat/completions') { response.end(JSON.stringify({ choices: [{ message: { content: '<script>hidden()</script>', tool_calls: [{}] } }] })); }
        else if (request.url === '/json/chat/completions') { response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ '不良摘要': '只提取指定不良描述。', other: '不能当作描述' }) } }] })); }
        else { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: '焊接异常，已给事实。' } }] })); }
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>(resolve => server?.close(() => resolve()));
    if (original.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.node;
    if (original.disposable === undefined) delete process.env.QMS_DISPOSABLE_TEST_DB; else process.env.QMS_DISPOSABLE_TEST_DB = original.disposable;
  });

  const call = (path: string) => requestAiText(`${base}/${path}`, secret, 'test-model', [{ role: 'user', content: '仅测试连通性。' }]);
  it('sends a real bounded POST to the configured model path and validates plain text', async () => {
    await expect(call('success')).resolves.toBe('焊接异常，已给事实。');
    expect(received.at(-1)).toMatchObject({ path: '/success/chat/completions', authorization: `Bearer ${secret}`, body: { model: 'test-model', stream: false, messages: [{ role: 'user', content: '仅测试连通性。' }] } });
  });
  it('never propagates vendor error bodies, headers or credentials', async () => {
    const failure = await call('failure').catch(error => error);
    expect(failure.getResponse()).toMatchObject({ code: 'AI_CONNECTION_REQUEST_FAILED' });
    expect(JSON.stringify(failure.getResponse())).not.toContain(secret);
    expect(String(failure)).not.toContain(secret);
    const echoed = await call('echo').catch(error => error);
    expect(echoed.getResponse()).toMatchObject({ code: 'AI_CONNECTION_RESPONSE_INVALID' });
    expect(JSON.stringify(echoed.getResponse())).not.toContain(secret);
  });
  it('refuses redirects instead of following them with the secret', async () => {
    const before = received.length;
    await expect(call('redirect')).rejects.toMatchObject({ message: expect.any(String) });
    expect(received).toHaveLength(before + 1);
  });
  it('bounds response bytes and refuses model actions or HTML', async () => {
    await expect(call('oversize')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_RESPONSE_TOO_LARGE' }) });
    await expect(call('invalid')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_RESPONSE_INVALID' }) });
  });
  it('extracts only the configured own JSON field as validated text', async () => {
    await expect(requestAiText(`${base}/json`, secret, 'test-model', [{ role: 'user', content: '事实' }], { mode: 'JSON', field: '不良摘要', target: 'description' })).resolves.toBe('只提取指定不良描述。');
    await expect(requestAiText(`${base}/json`, secret, 'test-model', [{ role: 'user', content: '事实' }], { mode: 'JSON', field: '__proto__', target: 'description' })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_INVALID' }) });
  });
  it('aborts a real response stall within its fixed deadline', async () => {
    const start = Date.now();
    await expect(call('timeout')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_TIMEOUT' }) });
    expect(Date.now() - start).toBeLessThan(6000);
  }, 7000);
});
