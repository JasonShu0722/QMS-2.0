import type { AiDescriptionOutput } from '../../common/ai-description.js';
import type { AiMessage } from './ai-connection.http.js';
import type { AiConnectionProtocol } from './ai-connection.policy.js';

export function aiProtocolRequest(protocol: AiConnectionProtocol, apiKey: string, model: string, messages: AiMessage[], format: AiDescriptionOutput) {
  const json = format.mode === 'JSON';
  if (protocol === 'OPENAI_CHAT_COMPLETIONS') return {
    path: 'chat/completions', headers: { authorization: `Bearer ${apiKey}` },
    body: { model, messages, stream: false, max_tokens: 1000, ...(json ? { response_format: { type: 'json_object' } } : {}) },
  };
  if (protocol === 'OPENAI_RESPONSES') return {
    path: 'responses', headers: { authorization: `Bearer ${apiKey}` },
    body: { model, input: messages, stream: false, store: false, max_output_tokens: 1000, ...(json ? { text: { format: { type: 'json_object' } } } : {}) },
  };
  const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
  const user = messages.filter(message => message.role === 'user');
  if (protocol === 'ANTHROPIC_MESSAGES') return {
    path: 'messages', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: { model, ...(system ? { system } : {}), messages: user, stream: false, max_tokens: 1000 },
  };
  return {
    path: `models/${encodeURIComponent(model)}:generateContent`, headers: { 'x-goog-api-key': apiKey },
    body: { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents: user.map(message => ({ role: 'user', parts: [{ text: message.content }] })), generationConfig: { maxOutputTokens: 1000, candidateCount: 1, ...(json ? { responseMimeType: 'application/json' } : {}) } },
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}
function rows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || !value.length) throw new Error();
  return value.map(record);
}
function one(value: unknown): Record<string, unknown> {
  const result = rows(value);
  if (result.length !== 1) throw new Error();
  return result[0]!;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error();
  return value;
}

export function aiProtocolText(protocol: AiConnectionProtocol, value: unknown): string {
  const result = record(value);
  if (result.error) throw new Error();
  if (protocol === 'OPENAI_CHAT_COMPLETIONS') {
    const choice = one(result.choices), message = record(choice.message);
    if (message.tool_calls !== undefined || message.function_call !== undefined || message.refusal
      || choice.finish_reason && !['stop', 'STOP'].includes(String(choice.finish_reason))) throw new Error();
    return text(message.content);
  }
  if (protocol === 'OPENAI_RESPONSES') {
    if (result.status !== 'completed' || result.incomplete_details) throw new Error();
    const output = rows(result.output);
    if (output.some(item => !['message', 'reasoning'].includes(String(item.type)))) throw new Error();
    const message = one(output.filter(item => item.type === 'message'));
    if (message.role !== 'assistant' || message.status !== 'completed') throw new Error();
    return rows(message.content).map(block => {
      if (block.type !== 'output_text') throw new Error();
      return text(block.text);
    }).join('');
  }
  if (protocol === 'ANTHROPIC_MESSAGES') {
    if (result.type !== 'message' || result.role !== 'assistant' || result.stop_reason !== 'end_turn') throw new Error();
    return rows(result.content).map(block => {
      if (block.type === 'thinking' || block.type === 'redacted_thinking') return '';
      if (block.type !== 'text') throw new Error();
      return text(block.text);
    }).join('');
  }
  if (result.promptFeedback && record(result.promptFeedback).blockReason) throw new Error();
  const candidate = one(result.candidates);
  if (candidate.finishReason !== 'STOP' || Array.isArray(candidate.safetyRatings) && candidate.safetyRatings.some(value => record(value).blocked === true)) throw new Error();
  const content = record(candidate.content);
  if (content.role !== undefined && content.role !== 'model') throw new Error();
  return rows(content.parts).map(part => {
    if (Object.keys(part).some(key => !['text', 'thought', 'thoughtSignature'].includes(key))) throw new Error();
    if (part.thought === true) return '';
    if (part.thought !== undefined && part.thought !== false) throw new Error();
    return text(part.text);
  }).join('');
}
