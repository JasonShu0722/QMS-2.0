import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { ReferenceObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface.js';
import { WorkflowController } from '../../src/modules/workflow/workflow.controller.js';
import { WorkflowDefinitionService } from '../../src/modules/workflow/workflow-definition.service.js';
import { WorkflowGraphDto } from '../../src/modules/workflow/workflow.dto.js';

const editableTypes = ['ACTION', 'APPROVAL', 'VERIFICATION', 'CC', 'CLOSE'];
const historicalTypes = ['ACTION', 'APPROVAL', 'VERIFICATION', 'CC', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'];

describe('workflow request and historical response contracts', () => {
  let app: INestApplication;
  let document: OpenAPIObject;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [WorkflowController], providers: [{ provide: WorkflowDefinitionService, useValue: {} }] }).compile();
    app = module.createNestApplication();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });
  afterAll(() => app.close());

  function schema(value: SchemaObject | ReferenceObject): SchemaObject {
    if ('$ref' in value) return schema(document.components!.schemas![value.$ref.split('/').at(-1)!]!);
    if (value.allOf?.length === 1) return schema(value.allOf[0]!);
    return value;
  }

  function nodeTypes(graph: SchemaObject | ReferenceObject) {
    const nodes = schema(schema(graph).properties!.nodes!);
    const node = schema(nodes.items!);
    return schema(node.properties!.type!).enum;
  }

  it.each([
    ['/api/v1/workflows', 'post'],
    ['/api/v1/workflows/{id}/draft', 'patch'],
    ['/api/v1/workflows/validate', 'post'],
  ] as const)('advertises only executable node types for %s %s', (path, method) => {
    const request = document.paths[path]![method]!.requestBody!;
    if ('$ref' in request) throw new Error('Unexpected request body reference');
    expect(nodeTypes(request.content['application/json']!.schema!)).toEqual(editableTypes);
  });

  it('preserves every historical node type in exact version responses', () => {
    const response = document.paths['/api/v1/workflows/{id}/versions/{versionId}']!.get!.responses['200']!;
    if ('$ref' in response) throw new Error('Unexpected response reference');
    const definition = schema(response.content!['application/json']!.schema!);
    const version = schema(definition.properties!.version!);
    expect(nodeTypes(version.properties!.structureSnapshot!)).toEqual(historicalTypes);
  });

  it.each(historicalTypes)('validates request node %s consistently with the editable contract', async (type) => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const result = pipe.transform({ nodes: [{ id: 'node', name: 'Node', type }], transitions: [] }, { type: 'body', metatype: WorkflowGraphDto });
    if (editableTypes.includes(type)) await expect(result).resolves.toMatchObject({ nodes: [{ type }] });
    else await expect(result).rejects.toMatchObject({ status: 400 });
  });
});
