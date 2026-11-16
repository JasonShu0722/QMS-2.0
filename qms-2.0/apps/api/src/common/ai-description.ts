import { HttpException } from '@nestjs/common';

export type AiDescriptionField = { path: string; label: string; variable?: string; value: string | number | boolean | null };
export type AiDescriptionOutput = { mode: 'TEXT' | 'JSON'; field: string; target: 'description' };
export type AiDescriptionDisposition = 'APPLIED' | 'SUGGESTED' | 'STALE';

export function renderAiDescriptionPrompt(prompt: string, fields: Pick<AiDescriptionField, 'variable' | 'value'>[]): string {
  const variables = new Map<string, AiDescriptionField['value']>();
  for (const field of fields) {
    if (!field.variable) continue;
    if (variables.has(field.variable)) throw new HttpException({ code: 'AI_CONNECTION_INVALID', message: '提示词变量重复' }, 400);
    variables.set(field.variable, field.value);
  }
  const rendered = prompt.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_match, variable: string) => {
    if (!variables.has(variable.trim())) throw new HttpException({ code: 'AI_CONNECTION_INVALID', message: '提示词变量缺少有效来源' }, 400);
    return JSON.stringify(variables.get(variable.trim()));
  });
  if (rendered.length > 64000) throw new HttpException({ code: 'AI_CONNECTION_INVALID', message: '提示词变量展开超过限制' }, 400);
  return rendered;
}

export function aiDescriptionDisposition(input: { expectedRevision: number; currentRevision: number; expectedDescription: string; currentDescription: string; manualFields: string[]; archived: boolean }): AiDescriptionDisposition {
  if (input.archived || input.expectedRevision !== input.currentRevision) return 'STALE';
  return input.manualFields.includes('description') || input.expectedDescription !== input.currentDescription ? 'SUGGESTED' : 'APPLIED';
}
export function validateAiDescription(text: string): string {
  if (typeof text !== 'string' || !text.trim() || text.length > 10000
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(text) || /<\/?[a-z][^>]*>/iu.test(text)) {
    throw new HttpException({ code: 'AI_CONNECTION_RESPONSE_INVALID', message: 'AI服务未返回有效描述' }, 502);
  }
  return text.trim();
}
