import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HEADERS_METADATA } from '@nestjs/common/constants.js';
import { CreateAiConnectionDto, UpdateAiConnectionDto } from '../../src/modules/ai-configuration/ai-connection.dto.js';
import { AiConnectionController } from '../../src/modules/ai-configuration/ai-connection.controller.js';
import { normalizeAiOutput } from '../../src/modules/ai-configuration/ai-connection.policy.js';

describe('AI connection write-only input DTO', () => {
  const value = { name: '批准的渠道', baseUrl: 'https://model.example/v1', models: ['test-model', 'test-model-2'], defaultModel: 'test-model', enabled: false, apiKey: 'test-only' };
  it('accepts configuration and requires an explicit key at creation', async () => {
    expect(await validate(plainToInstance(CreateAiConnectionDto, value))).toHaveLength(0);
    expect(await validate(plainToInstance(CreateAiConnectionDto, { ...value, apiKey: '' }))).not.toHaveLength(0);
  });
  it('accepts a blank replacement as keep and rejects nulls, stale-shaped versions and extra fields', async () => {
    expect(await validate(plainToInstance(UpdateAiConnectionDto, { ...value, expectedVersion: 1, apiKey: '' }))).toHaveLength(0);
    for (const invalid of [{ apiKey: null }, { name: null }, { expectedVersion: 0 }, { expectedVersion: 2147483648 }, { enabled: 'true' }, { models: [] }, { models: ['same', 'same'] }, { defaultModel: '' }, { secretCiphertext: 'no' }]) {
      expect(await validate(plainToInstance(UpdateAiConnectionDto, { ...value, expectedVersion: 1, ...invalid }), { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
    }
  });
  it('keeps the configured JSON field boundary at the published 100 characters', () => {
    expect(normalizeAiOutput({ mode: 'JSON', field: '字'.repeat(100), target: 'description' }).field).toHaveLength(100);
    expect(() => normalizeAiOutput({ mode: 'JSON', field: '字'.repeat(101), target: 'description' })).toThrow();
  });
  it('marks every channel read and write response as no-store', () => {
    for (const method of ['list', 'create', 'update', 'clear', 'test'] as const) {
      expect(Reflect.getMetadata(HEADERS_METADATA, AiConnectionController.prototype[method])).toEqual(expect.arrayContaining([{ name: 'Cache-Control', value: 'no-store' }]));
    }
  });
});
