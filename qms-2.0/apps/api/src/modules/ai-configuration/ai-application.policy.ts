import { HttpException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { normalizeAiGeneration, normalizeAiOutput } from './ai-connection.policy.js';
import type { AiApplicationSettingsDto, AiApplicationSampleDto } from './ai-application.dto.js';

const messages = {
  AI_APPLICATION_INVALID: '提示词应用配置无效',
  AI_APPLICATION_NOT_FOUND: '提示词应用或已发布版本不存在',
  AI_APPLICATION_UNAVAILABLE: '提示词应用未启用',
  AI_APPLICATION_VERSION_CONFLICT: '提示词应用已变化，请刷新后重试',
} as const;
export function aiApplicationError(code: keyof typeof messages, status = 400): never { throw new HttpException({ code, message: messages[code] }, status); }
export function applicationVersion(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) aiApplicationError('AI_APPLICATION_INVALID');
}
export function applicationIdentifiers(...values: string[]) { if (values.some(value => typeof value !== 'string' || !isUUID(value))) aiApplicationError('AI_APPLICATION_INVALID'); }

export function normalizeAiApplication(input: unknown): AiApplicationSettingsDto {
  if (!input || typeof input !== 'object' || Array.isArray(input)) aiApplicationError('AI_APPLICATION_INVALID');
  const value = input as AiApplicationSettingsDto;
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || /[\u0000]/u.test(value.name)
    || value.domain !== 'PROCESS_QUALITY' || value.scene !== 'PROCESS_DEFECT_DESCRIPTION' || typeof value.enabled !== 'boolean' || value.fallback !== 'DIRECT'
    || !Array.isArray(value.variables) || !value.variables.length || value.variables.length > 20
    || value.variables.some(item => !item || typeof item.variable !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(item.variable)
      || typeof item.label !== 'string' || item.label.length > 100 || /[\u0000]/u.test(item.label))
    || new Set(value.variables.map(item => item.variable)).size !== value.variables.length) aiApplicationError('AI_APPLICATION_INVALID');
  applicationIdentifiers(value.connectionId);
  const variables = value.variables.map(item => ({ variable: item.variable, label: item.label }));
  try {
    const generation = normalizeAiGeneration({ model: value.model, prompt: value.prompt, output: value.output, selectedData: [{ label: '', value: '校验' }] });
    if ([...generation.prompt.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].some(match => !variables.some(item => item.variable === match[1]!.trim()))) aiApplicationError('AI_APPLICATION_INVALID');
    return { name: value.name.trim(), domain: value.domain, scene: value.scene, enabled: value.enabled, variables,
      connectionId: value.connectionId, model: generation.model, prompt: generation.prompt, output: normalizeAiOutput(value.output), fallback: 'DIRECT' };
  } catch { aiApplicationError('AI_APPLICATION_INVALID'); }
}

export function applicationSamples(configuration: AiApplicationSettingsDto, samples: AiApplicationSampleDto[]) {
  if (!Array.isArray(samples) || samples.length !== configuration.variables.length || samples.some(item => !item || typeof item.variable !== 'string' || typeof item.value !== 'string')
    || new Set(samples.map(item => item.variable)).size !== samples.length) aiApplicationError('AI_APPLICATION_INVALID');
  const selectedData = configuration.variables.map(item => {
    const sample = samples.find(sample => sample.variable === item.variable);
    if (!sample) aiApplicationError('AI_APPLICATION_INVALID');
    return { variable: item.variable, label: item.label, value: sample.value };
  });
  try { return normalizeAiGeneration({ model: configuration.model, prompt: configuration.prompt, selectedData }).selectedData; }
  catch { aiApplicationError('AI_APPLICATION_INVALID'); }
}
