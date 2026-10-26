import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { ReferenceObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface.js';

import * as dto from '../../src/modules/process-quality/process-eight-d-document.dto.js';
import * as policy from '../../src/modules/process-quality/process-eight-d-document.js';

const rowTypes = [
  ['temporaryMeasures', dto.ProcessEightDTemporaryMeasureDto],
  ['containment', dto.ProcessEightDContainmentDto],
  ['optionalAffectedContainment', dto.ProcessEightDContainmentDto],
  ['correctiveActions', dto.ProcessEightDCorrectiveActionDto],
  ['horizontalDeployment', dto.ProcessEightDHorizontalDeploymentDto],
  ['standardization', dto.ProcessEightDStandardizationDto],
] as const;

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const transform = (input: unknown): Promise<dto.ProcessEightDDocumentDto> =>
  pipe.transform(input, { type: 'body', metatype: dto.ProcessEightDDocumentDto });

function fieldsFor(section: string) {
  return section === 'root' ? {} : {
    id: 'row',
    ...(section === 'correctiveActions' ? { causeKind: 'OCCURRENCE' } : {}),
    ...(section === 'standardization' ? { key: 'CUSTOM', documentName: 'Custom' } : {}),
  };
}

describe('process eight-d document DTO', () => {
  it('exports the complete Swagger document DTO', () => {
    expect(typeof dto.ProcessEightDDocumentDto).toBe('function');
  });

  it('normalizes a root draft returned by the real transforming ValidationPipe', async () => {
    const document = await transform({});
    expect(Object.getPrototypeOf(document)).toBe(dto.ProcessEightDDocumentDto.prototype);
    expect(policy.normalizeProcessEightDDocument(document)).toEqual(policy.emptyProcessEightDDocument());
  });

  it.each(rowTypes)('normalizes the real ValidationPipe nested %s DTO independently of the root', async (section, Type) => {
    const payload = { [section]: [fieldsFor(section)] };
    const document = await transform(payload);
    expect(Object.getPrototypeOf(document[section][0])).toBe(Type.prototype);
    expect(policy.normalizeProcessEightDDocument({ ...document })).toEqual(policy.normalizeProcessEightDDocument(payload));
  });

  it('normalizes a complete real ValidationPipe DTO tree without mutating it', async () => {
    const payload = {
      temporaryMeasures: [{ id: 'temporary', introducedAt: '2026-10-25' }],
      containment: [{ id: 'stock', quantity: 0 }],
      optionalAffectedContainment: [{ id: 'affected' }],
      correctiveActions: [{ id: 'action', causeKind: 'OCCURRENCE' }],
      horizontalDeployment: [{ id: 'horizontal' }],
      standardization: [{ id: 'custom', key: 'CUSTOM', documentName: 'Custom' }],
    };
    const document = await transform(payload);
    const before = structuredClone(document);
    expect(Object.getPrototypeOf(document)).toBe(dto.ProcessEightDDocumentDto.prototype);
    for (const [section, Type] of rowTypes) expect(Object.getPrototypeOf(document[section][0])).toBe(Type.prototype);
    expect(policy.normalizeProcessEightDDocument(document)).toEqual(policy.normalizeProcessEightDDocument(payload));
    expect(structuredClone(document)).toEqual(before);
  });

  it.each([
    ['root', dto.ProcessEightDDocumentDto], ...rowTypes,
  ] as const)('rejects foreign, derived and wrong DTO instances at %s', (section, Type) => {
    class Foreign {}
    class Derived extends Type {}
    const wrap = (value: object) => section === 'root' ? value : { [section]: [value] };
    for (const type of [Foreign, Derived, section === 'root' ? dto.ProcessEightDContainmentDto : dto.ProcessEightDDocumentDto]) {
      const value = Object.setPrototypeOf(Object.assign(new Type(), fieldsFor(section)), type.prototype);
      expect(() => policy.normalizeProcessEightDDocument(wrap(value))).toThrow(policy.ProcessEightDDocumentError);
    }
  });

  it.each([
    ['root', dto.ProcessEightDDocumentDto], ...rowTypes,
  ] as const)('keeps unknown-field, symbol and accessor rejection on exact %s DTO instances', (section, Type) => {
    const wrap = (value: object) => section === 'root' ? value : { [section]: [value] };
    const instance = () => Object.assign(new Type(), fieldsFor(section));
    expect(() => policy.normalizeProcessEightDDocument(wrap(Object.assign(instance(), { unknown: true })))).toThrow(policy.ProcessEightDDocumentError);
    expect(() => policy.normalizeProcessEightDDocument(wrap(Object.assign(instance(), { [Symbol('unknown')]: true })))).toThrow(policy.ProcessEightDDocumentError);
    let reads = 0;
    const accessor = Object.defineProperty(instance(), section === 'root' ? 'description' : 'id', { get: () => { reads++; return 'row'; } });
    expect(() => policy.normalizeProcessEightDDocument(wrap(accessor))).toThrow(policy.ProcessEightDDocumentError);
    expect(reads).toBe(0);
  });

  it('publishes concrete nested properties, enums and nullable facts instead of opaque JSON', async () => {
    const module = await Test.createTestingModule({}).compile();
    const app = module.createNestApplication();
    try {
      const document = SwaggerModule.createDocument(app, new DocumentBuilder().build(), { extraModels: [dto.ProcessEightDDocumentDto] });
      function schema(value: SchemaObject | ReferenceObject): SchemaObject {
        if ('$ref' in value) return schema(document.components!.schemas![value.$ref.split('/').at(-1)!]!);
        return value;
      }
      const root = schema(document.components!.schemas!.ProcessEightDDocumentDto!);
      expect(Object.keys(root.properties!)).toEqual([
        'description', 'okFileIds', 'ngFileIds', 'temporaryMeasures', 'containment', 'optionalAffectedContainment',
        'analysisProcess', 'analysisFileIds', 'occurrenceCause', 'escapeCause', 'systemCause',
        'correctiveActions', 'horizontalDeployment', 'standardization', 'closureSummary',
      ]);
      for (const name of ['temporaryMeasures', 'containment', 'optionalAffectedContainment', 'correctiveActions', 'horizontalDeployment', 'standardization']) {
        const array = schema(root.properties![name]!);
        expect(array.type).toBe('array');
        expect(Object.keys(schema(array.items!).properties!).length).toBeGreaterThan(4);
      }
      const action = schema(schema(root.properties!.correctiveActions!).items!);
      expect(schema(action.properties!.causeKind!).enum).toEqual(['OCCURRENCE', 'ESCAPE', 'SYSTEM']);
      expect(schema(action.properties!.effective!)).toMatchObject({ type: 'boolean', nullable: true });
      expect(schema(action.properties!.followUpBatchCount!)).toMatchObject({ type: 'integer', nullable: true });
      expect(schema(action.properties!.implementationAt!)).toMatchObject({ type: 'string', nullable: true });
      expect(schema(schema(action.properties!.verificationFileIds!).items!)).toMatchObject({ type: 'string', format: 'uuid' });
    } finally {
      await app.close();
    }
  });

  it('validates nested drafts with the installed ValidationPipe without coercing values', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const transform = (input: unknown) => pipe.transform(input, { type: 'body', metatype: dto.ProcessEightDDocumentDto });
    await expect(transform({ correctiveActions: [{ id: 'a', causeKind: 'OCCURRENCE' }] })).resolves.toMatchObject({ correctiveActions: [{ effective: null, followUpBatchCount: null, plannedAt: null }] });
    await expect(transform({ correctiveActions: [{ id: 'a', causeKind: 'OCCURRENCE', necessary: false }] })).rejects.toMatchObject({ status: 400 });
    await expect(transform({ containment: [{ id: 'c', quantity: '' }] })).rejects.toMatchObject({ status: 400 });
    await expect(transform({ temporaryMeasures: [{ id: 't', introducedAt: '2026-02-30' }] })).rejects.toMatchObject({ status: 400 });
  });
});
