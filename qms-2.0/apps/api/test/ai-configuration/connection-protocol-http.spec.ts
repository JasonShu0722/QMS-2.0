import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AiDescriptionOutput } from '../../src/common/ai-description.js';
import { requestAiText, type AiMessage } from '../../src/modules/ai-configuration/ai-connection.http.js';

const protocols = ['OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES', 'GEMINI_GENERATE_CONTENT'] as const;
type Protocol = typeof protocols[number];
const requestProtocolText: (base: string, key: string, model: string, messages: AiMessage[], output: AiDescriptionOutput | undefined, protocol: Protocol) => Promise<string> = requestAiText;

describe('AI protocol adapters through actual bounded HTTP', () => {
  let server: Server;
  let base: string;
  const secret = 'protocol-disposable-secret';
  const original = { node: process.env.NODE_ENV, disposable: process.env.QMS_DISPOSABLE_TEST_DB };
  const received: Array<{ path: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }> = [];
  let payload: unknown;
  const good = (protocol: Protocol, text = '已核实事实。'): unknown => {
    if (protocol === 'OPENAI_CHAT_COMPLETIONS') return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] };
    if (protocol === 'OPENAI_RESPONSES') return { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] };
    if (protocol === 'ANTHROPIC_MESSAGES') return { type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] };
    return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }] };
  };
  const messages: AiMessage[] = [{ role: 'system', content: '只整理事实。' }, { role: 'user', content: '给定质量事实。' }];
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.QMS_DISPOSABLE_TEST_DB = 'true';
    server = createServer((request, response) => {
      let body = '';
      request.on('data', chunk => { body += String(chunk); });
      request.on('end', () => {
        received.push({ path: request.url!, headers: request.headers, body: JSON.parse(body) as Record<string, unknown> });
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(payload));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>(resolve => server?.close(() => resolve()));
    if (original.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.node;
    if (original.disposable === undefined) delete process.env.QMS_DISPOSABLE_TEST_DB; else process.env.QMS_DISPOSABLE_TEST_DB = original.disposable;
  });
  const call = (protocol: Protocol, output?: AiDescriptionOutput) => requestProtocolText(base, secret, 'test-model', messages, output, protocol);

  it.each(protocols)('%s uses its published endpoint, credentials and request shape', async protocol => {
    payload = good(protocol);
    await expect(call(protocol)).resolves.toBe('已核实事实。');
    const actual = received.at(-1)!;
    expect(actual.path).not.toContain(secret);
    expect(JSON.stringify(actual.body)).not.toContain(secret);
    if (protocol === 'OPENAI_CHAT_COMPLETIONS') {
      expect(actual).toMatchObject({ path: '/v1/chat/completions', headers: { authorization: `Bearer ${secret}` }, body: { model: 'test-model', messages, stream: false, max_tokens: 1000 } });
    } else if (protocol === 'OPENAI_RESPONSES') {
      expect(actual).toMatchObject({ path: '/v1/responses', headers: { authorization: `Bearer ${secret}` }, body: { model: 'test-model', input: messages, max_output_tokens: 1000, store: false, stream: false } });
      expect(actual.body).not.toHaveProperty('messages');
    } else if (protocol === 'ANTHROPIC_MESSAGES') {
      expect(actual).toMatchObject({ path: '/v1/messages', headers: { 'x-api-key': secret, 'anthropic-version': '2023-06-01' }, body: { model: 'test-model', system: messages[0]!.content, messages: [messages[1]], max_tokens: 1000, stream: false } });
      expect(actual.headers.authorization).toBeUndefined();
    } else {
      expect(actual).toMatchObject({ path: '/v1/models/test-model:generateContent', headers: { 'x-goog-api-key': secret }, body: { systemInstruction: { parts: [{ text: messages[0]!.content }] }, contents: [{ role: 'user', parts: [{ text: messages[1]!.content }] }], generationConfig: { maxOutputTokens: 1000, candidateCount: 1 } } });
      expect(actual.headers.authorization).toBeUndefined();
    }
  });

  it.each(protocols)('%s extracts the selected JSON field once and requests supported structured output', async protocol => {
    const text = JSON.stringify({ description: '{"description":"literal text retained"}', other: 'ignored' });
    payload = good(protocol, text);
    await expect(call(protocol, { mode: 'JSON', field: 'description', target: 'description' })).resolves.toBe('{"description":"literal text retained"}');
    const body = received.at(-1)!.body;
    if (protocol === 'OPENAI_CHAT_COMPLETIONS') expect(body).toHaveProperty('response_format', { type: 'json_object' });
    if (protocol === 'OPENAI_RESPONSES') expect(body).toHaveProperty('text', { format: { type: 'json_object' } });
    if (protocol === 'GEMINI_GENERATE_CONTENT') expect(body).toHaveProperty('generationConfig.responseMimeType', 'application/json');
  });

  it.each(protocols)('%s refuses HTML, empty output, secret echoes and missing JSON fields', async protocol => {
    for (const value of ['<b>invalid</b>', '', secret]) {
      payload = good(protocol, value);
      await expect(call(protocol)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_RESPONSE_INVALID' }) });
    }
    payload = good(protocol, '{"other":"wrong"}');
    await expect(call(protocol, { mode: 'JSON', field: 'description', target: 'description' })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_RESPONSE_INVALID' }) });
  });

  it('rejects incomplete, refused, blocked, tool, thinking-only and multiple-candidate output', async () => {
    const invalid: Array<[Protocol, unknown]> = [
      ['OPENAI_CHAT_COMPLETIONS', { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }],
      ['OPENAI_CHAT_COMPLETIONS', { choices: [{ finish_reason: 'stop', message: { content: 'hidden refusal', refusal: 'blocked' } }] }],
      ['OPENAI_RESPONSES', { status: 'incomplete', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'partial' }] }] }],
      ['OPENAI_RESPONSES', { status: 'completed', output: [{ type: 'function_call', arguments: '{}' }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'tool result' }] }] }],
      ['OPENAI_RESPONSES', { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'blocked' }] }] }],
      ['ANTHROPIC_MESSAGES', { type: 'message', role: 'assistant', stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] }],
      ['ANTHROPIC_MESSAGES', { type: 'message', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', input: {} }, { type: 'text', text: 'tool' }] }],
      ['ANTHROPIC_MESSAGES', { type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'hidden' }] }],
      ['GEMINI_GENERATE_CONTENT', { promptFeedback: { blockReason: 'SAFETY' }, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'blocked' }] } }] }],
      ['GEMINI_GENERATE_CONTENT', { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] }],
      ['GEMINI_GENERATE_CONTENT', { candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'act' } }, { text: 'tool' }] } }] }],
      ['GEMINI_GENERATE_CONTENT', { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'private thought' }] } }] }],
      ['GEMINI_GENERATE_CONTENT', { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'first' }] } }, { finishReason: 'STOP', content: { parts: [{ text: 'second' }] } }] }],
    ];
    for (const [protocol, value] of invalid) {
      payload = value;
      await expect(call(protocol)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'AI_CONNECTION_RESPONSE_INVALID' }) });
    }
  });

  it('combines visible text blocks without exposing reasoning', async () => {
    payload = { status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '前半' }, { type: 'output_text', text: '后半' }] }] };
    await expect(call('OPENAI_RESPONSES')).resolves.toBe('前半后半');
    payload = { type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '前半' }, { type: 'text', text: '后半' }] };
    await expect(call('ANTHROPIC_MESSAGES')).resolves.toBe('前半后半');
  });
  it('encodes the entire Gemini model as one path component while retaining the configured base path', async () => {
    payload = good('GEMINI_GENERATE_CONTENT');
    await expect(requestProtocolText(base, secret, 'family/../other?x=1#suffix', messages, undefined, 'GEMINI_GENERATE_CONTENT')).resolves.toBe('已核实事实。');
    expect(received.at(-1)!.path).toBe('/v1/models/family%2F..%2Fother%3Fx%3D1%23suffix:generateContent');
  });
});
