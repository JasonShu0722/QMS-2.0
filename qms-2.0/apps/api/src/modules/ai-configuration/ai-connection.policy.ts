import { HttpException } from '@nestjs/common';
import { BlockList, isIP } from 'node:net';
import type { AiDescriptionOutput } from '../../common/ai-description.js';

const messages = {
  AI_CONNECTION_INVALID: 'AI连接配置无效',
  AI_CONNECTION_NOT_FOUND: 'AI连接不存在',
  AI_CONNECTION_UNAVAILABLE: 'AI连接未启用或未配置密钥',
  AI_CONNECTION_VERSION_CONFLICT: 'AI连接已变化，请刷新后重试',
  AI_CONNECTION_TARGET_DENIED: 'AI服务地址不符合安全要求',
  AI_CONNECTION_REQUEST_FAILED: 'AI服务请求失败',
  AI_CONNECTION_TIMEOUT: 'AI服务请求超时',
  AI_CONNECTION_RESPONSE_INVALID: 'AI服务未返回有效描述',
  AI_CONNECTION_RESPONSE_TOO_LARGE: 'AI服务响应超过限制',
} as const;
export type AiFailureCode = keyof typeof messages;
export function aiConnectionError(code: AiFailureCode, status: number): never { throw new HttpException({ code, message: messages[code] }, status); }

const denied = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) denied.addSubnet(address, prefix, 'ipv4');
denied.addSubnet('2001::', 23, 'ipv6');
denied.addSubnet('2001:db8::', 32, 'ipv6');
denied.addSubnet('2002::', 16, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicAiAddress(value: string): boolean {
  const family = isIP(value);
  if (family === 4) return !denied.check(value, 'ipv4');
  return family === 6 && globalV6.check(value, 'ipv6') && !denied.check(value, 'ipv6');
}

export function isDisposableAiLoopback(url: URL): boolean {
  return process.env.NODE_ENV === 'test' && process.env.QMS_DISPOSABLE_TEST_DB === 'true'
    && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}

export function normalizeAiBaseUrl(value: string): string {
  try {
    if (typeof value !== 'string' || value.length > 500 || value !== value.trim() || /[\\?#\u0000-\u0020\u007f]/.test(value)
      || !/^https?:\/\/[^/]+(?:\/|$)/i.test(value) || /^https?:\/\/[^/]*@/i.test(value)) throw new Error();
    const url = new URL(value);
    const localTest = isDisposableAiLoopback(url);
    const address = url.hostname.replace(/^\[|\]$/g, '');
    if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:' && !localTest
      || !localTest && (url.hostname.toLowerCase() === 'localhost' || isIP(address) !== 0 && !isPublicAiAddress(address))) throw new Error();
    return url.toString().replace(/\/+$/, '');
  } catch { aiConnectionError('AI_CONNECTION_TARGET_DENIED', 400); }
}

export function pinAiAddresses(hostname: string, addresses: Array<{ address: string; family: number }>): { hostname: string; address: string; family: number } {
  if (!addresses.length || addresses.some(value => !isPublicAiAddress(value.address) || isIP(value.address) !== value.family)) aiConnectionError('AI_CONNECTION_TARGET_DENIED', 400);
  return { hostname, ...addresses[0]! };
}

function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || !allowEmpty && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) aiConnectionError('AI_CONNECTION_INVALID', 400);
  return value;
}
function modelName(value: unknown): string {
  const result = text(value, 120);
  if (/\s/u.test(result)) aiConnectionError('AI_CONNECTION_INVALID', 400);
  return result;
}
export function normalizeAiSettings(value: unknown): { name: string; baseUrl: string; models: string[]; defaultModel: string; enabled: boolean } {
  if (!value || typeof value !== 'object') aiConnectionError('AI_CONNECTION_INVALID', 400);
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.models) || input.models.length < 1 || input.models.length > 30 || typeof input.enabled !== 'boolean') aiConnectionError('AI_CONNECTION_INVALID', 400);
  const models = input.models.map(modelName);
  const defaultModel = modelName(input.defaultModel);
  if (new Set(models).size !== models.length || !models.includes(defaultModel)) aiConnectionError('AI_CONNECTION_INVALID', 400);
  return { name: text(input.name, 120).trim(), baseUrl: normalizeAiBaseUrl(input.baseUrl as string), models, defaultModel, enabled: input.enabled };
}
export function normalizeAiOutput(value?: unknown): AiDescriptionOutput {
  if (value === undefined) return { mode: 'TEXT', field: 'description', target: 'description' };
  if (!value || typeof value !== 'object') aiConnectionError('AI_CONNECTION_INVALID', 400);
  const input = value as Record<string, unknown>;
  if (!['TEXT', 'JSON'].includes(String(input.mode)) || input.target !== 'description') aiConnectionError('AI_CONNECTION_INVALID', 400);
  const field = text(input.field, 100);
  if (field !== field.trim() || ['__proto__', 'constructor', 'prototype'].includes(field) || /[.\[\]\r\n\t]/.test(field)) aiConnectionError('AI_CONNECTION_INVALID', 400);
  return { mode: input.mode as 'TEXT' | 'JSON', field, target: 'description' };
}
export type AiGenerationInput = { model: string; prompt: string; selectedData: Array<{ label: string; value: string; variable?: string }>; output?: AiDescriptionOutput };
export function normalizeAiGeneration(value: unknown): AiGenerationInput {
  if (!value || typeof value !== 'object') aiConnectionError('AI_CONNECTION_INVALID', 400);
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.selectedData) || input.selectedData.length < 1 || input.selectedData.length > 50) aiConnectionError('AI_CONNECTION_INVALID', 400);
  const selectedData = input.selectedData.map((fact: unknown) => {
    if (!fact || typeof fact !== 'object') aiConnectionError('AI_CONNECTION_INVALID', 400);
    const row = fact as Record<string, unknown>;
    const variable = row.variable === undefined ? undefined : text(row.variable, 64);
    if (variable !== undefined && !/^[a-z][a-z\d_]*$/i.test(variable)) aiConnectionError('AI_CONNECTION_INVALID', 400);
    return { label: text(row.label, 200, true), value: text(row.value, 16000, true), ...(variable === undefined ? {} : { variable }) };
  });
  if (selectedData.reduce((total, fact) => total + fact.label.length + fact.value.length, 0) > 16000 || selectedData.every(fact => !fact.value.trim())) aiConnectionError('AI_CONNECTION_INVALID', 400);
  return { model: modelName(input.model), prompt: text(input.prompt, 4000).trim(), selectedData, ...(input.output === undefined ? {} : { output: normalizeAiOutput(input.output) }) };
}
