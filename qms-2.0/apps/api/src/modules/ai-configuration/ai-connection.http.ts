import { lookup } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { request as httpRequest } from 'node:http';
import { isIP, type LookupFunction } from 'node:net';
import { HttpException } from '@nestjs/common';
import type { AiDescriptionOutput } from '../../common/ai-description.js';
import { aiConnectionError, isDisposableAiLoopback, normalizeAiBaseUrl, normalizeAiOutput, normalizeAiProtocol, pinAiAddresses, type AiConnectionProtocol } from './ai-connection.policy.js';
import { aiProtocolRequest, aiProtocolText } from './ai-connection.protocol.js';

export type AiMessage = { role: 'system' | 'user'; content: string };
const maximumResponseBytes = 65536;
const requestDeadlineMs = 4000;

export async function resolveAiDestination(baseUrl: string) {
  const url = new URL(normalizeAiBaseUrl(baseUrl));
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isDisposableAiLoopback(url)) return { url, hostname, address: hostname === 'localhost' ? '127.0.0.1' : hostname, family: hostname === '::1' ? 6 : 4 };
  try {
    const answers = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
      const timer = setTimeout(() => {
        try { aiConnectionError('AI_CONNECTION_TIMEOUT', 504); } catch (error) { reject(error); }
      }, requestDeadlineMs);
      lookup(hostname, { all: true, verbatim: true }).then(addresses => { clearTimeout(timer); resolve(addresses); }, () => {
        clearTimeout(timer);
        try { aiConnectionError('AI_CONNECTION_TARGET_DENIED', 400); } catch (error) { reject(error); }
      });
    });
    return { url, ...pinAiAddresses(hostname, answers) };
  } catch (error) {
    if (error instanceof HttpException) throw error;
    aiConnectionError('AI_CONNECTION_TARGET_DENIED', 400);
  }
}

export async function requestAiText(baseUrl: string, apiKey: string, model: string, messages: AiMessage[], output?: AiDescriptionOutput, protocol?: AiConnectionProtocol): Promise<string> {
  const format = normalizeAiOutput(output);
  const adapter = normalizeAiProtocol(protocol);
  const request = aiProtocolRequest(adapter, apiKey, model, messages, format);
  const target = await resolveAiDestination(baseUrl);
  const body = JSON.stringify(request.body);
  if (Buffer.byteLength(body) > 65536 || !apiKey || /[\r\n\u0000]/.test(apiKey)) aiConnectionError('AI_CONNECTION_INVALID', 400);
  const url = new URL(`${target.url.toString().replace(/\/+$/, '')}/${request.path}`);
  const pinnedLookup: LookupFunction = (hostname, options, callback) => {
    if (hostname !== target.hostname) { callback(new Error('AI_CONNECTION_TARGET_DENIED'), '', 0); return; }
    if (options.all) callback(null, [{ address: target.address, family: target.family }]);
    else callback(null, target.address, target.family);
  };
  const raw = await new Promise<string>((resolve, reject) => {
    let completed = false;
    let deadline: ReturnType<typeof setTimeout>;
    const fail = (code: 'AI_CONNECTION_REQUEST_FAILED' | 'AI_CONNECTION_TIMEOUT' | 'AI_CONNECTION_RESPONSE_TOO_LARGE') => {
      if (completed) return;
      completed = true;
      clearTimeout(deadline);
      try { aiConnectionError(code, code === 'AI_CONNECTION_TIMEOUT' ? 504 : 502); } catch (error) { reject(error); }
      outbound.destroy();
    };
    const requestOptions: RequestOptions & { autoSelectFamily: false } = {
      method: 'POST', agent: false, lookup: pinnedLookup, autoSelectFamily: false,
      ...(url.protocol === 'https:' && !isIP(target.hostname) ? { servername: target.hostname } : {}),
      maxHeaderSize: 8192,
      headers: { ...request.headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), accept: 'application/json' },
    };
    const outbound = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, requestOptions, response => {
      if (response.statusCode !== 200) { fail('AI_CONNECTION_REQUEST_FAILED'); response.destroy(); return; }
      const declared = response.headers['content-length'];
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumResponseBytes)) { fail('AI_CONNECTION_RESPONSE_TOO_LARGE'); response.destroy(); return; }
      let bytes = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maximumResponseBytes) { fail('AI_CONNECTION_RESPONSE_TOO_LARGE'); response.destroy(); return; }
        chunks.push(chunk);
      });
      response.on('aborted', () => fail('AI_CONNECTION_REQUEST_FAILED'));
      response.on('error', () => fail('AI_CONNECTION_REQUEST_FAILED'));
      response.on('end', () => {
        if (completed) return;
        completed = true;
        clearTimeout(deadline);
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    deadline = setTimeout(() => fail('AI_CONNECTION_TIMEOUT'), requestDeadlineMs);
    outbound.on('error', () => fail('AI_CONNECTION_REQUEST_FAILED'));
    outbound.end(body);
  });
  try {
    const parsed: unknown = JSON.parse(raw);
    const content = aiProtocolText(adapter, parsed);
    let selected: unknown = content;
    if (format.mode === 'JSON') {
      const structured: unknown = JSON.parse(content);
      if (!structured || typeof structured !== 'object' || Array.isArray(structured) || !Object.hasOwn(structured, format.field)) throw new Error();
      selected = (structured as Record<string, unknown>)[format.field];
    }
    if (typeof selected !== 'string') throw new Error();
    const text = selected.trim();
    if (!text || text.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || /<\/?[a-z][^>]*>/i.test(text) || text.includes(apiKey)) throw new Error();
    return text;
  } catch { aiConnectionError('AI_CONNECTION_RESPONSE_INVALID', 502); }
}
