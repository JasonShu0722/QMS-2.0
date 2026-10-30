import { BadRequestException, Injectable, ServiceUnavailableException, type OnApplicationBootstrap } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { adminError } from '../../common/security/admin-mutation.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export type DataExchangeDirection = 'INBOUND' | 'OUTBOUND';
export type DataExchangeSourceHandle = object;
export type TrustedExchangeScope = object;
export type DataExchangeIdentity = { direction: DataExchangeDirection; objectType: string; level: 'BATCH' | 'RECORD'; correlationId: string; batchId?: string; recordId?: string; attemptNumber: number };
export type DataExchangeSourceDefinition = {
  key: string; label: string; directions: DataExchangeDirection[]; objectTypes: string[];
  // Source owners revalidate trusted business ownership; transaction callbacks must only read database facts.
  authorizeScope: (scopeKey: string, identity?: DataExchangeIdentity, transaction?: Prisma.TransactionClient) => Promise<boolean>;
};

@Injectable()
export class DataExchangeRegistryService implements OnApplicationBootstrap {
  private sealed = false;
  private readonly definitions = new Map<DataExchangeSourceHandle, DataExchangeSourceDefinition>();
  private readonly scopes = new WeakMap<TrustedExchangeScope, { handle: DataExchangeSourceHandle; scopeKey: string }>();

  register(definition: DataExchangeSourceDefinition): DataExchangeSourceHandle {
    if (this.sealed || this.definitions.size >= 32 || !/^[A-Z][A-Z0-9_]{0,63}$/.test(definition.key)
      || [...this.definitions.values()].some(source => source.key === definition.key)
      || !/^[\p{L}\p{N} _.-]{1,80}$/u.test(definition.label)
      || !definition.directions.length || definition.directions.length > 2 || definition.directions.some(direction => !['INBOUND', 'OUTBOUND'].includes(direction))
      || !definition.objectTypes.length || definition.objectTypes.length > 16 || definition.objectTypes.some(type => !/^[A-Z][A-Z0-9_]{0,47}$/.test(type))
      || typeof definition.authorizeScope !== 'function') throw new BadRequestException('Invalid internal exchange source registration.');
    const handle = Object.freeze({});
    this.definitions.set(handle, Object.freeze({ ...definition, directions: [...new Set(definition.directions)], objectTypes: [...new Set(definition.objectTypes)] }));
    return handle;
  }

  onApplicationBootstrap(): void { this.sealed = true; }

  async bindScope(handle: DataExchangeSourceHandle, scopeKey: string): Promise<TrustedExchangeScope> {
    const definition = this.definitions.get(handle);
    if (!definition || !isUUID(scopeKey)) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    scopeKey = scopeKey.toLowerCase();
    if (!await this.allowed(definition, scopeKey)) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    const scope = Object.freeze({});
    this.scopes.set(scope, { handle, scopeKey });
    return scope;
  }

  resolve(handle: DataExchangeSourceHandle, scope: TrustedExchangeScope, direction: string, objectType: string) {
    const definition = this.definitions.get(handle);
    const bound = this.scopes.get(scope);
    if (!definition || !bound || bound.handle !== handle || !definition.directions.includes(direction as DataExchangeDirection) || !definition.objectTypes.includes(objectType)) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    return { sourceKey: definition.key, scopeKey: bound.scopeKey };
  }

  async verify(handle: DataExchangeSourceHandle, scope: TrustedExchangeScope, identity: DataExchangeIdentity, transaction?: Prisma.TransactionClient) {
    const resolved = this.resolve(handle, scope, identity.direction, identity.objectType);
    if (!await this.allowed(this.definitions.get(handle)!, resolved.scopeKey, identity, transaction)) adminError('ORGANIZATION_SCOPE_DENIED', 403);
    return resolved;
  }

  async sources(scopeKey?: string) {
    const visible = [];
    for (const definition of this.definitions.values()) {
      if (scopeKey !== undefined && !await this.allowed(definition, scopeKey)) continue;
      visible.push({ key: definition.key, label: definition.label, directions: [...definition.directions], objectTypes: [...definition.objectTypes] });
    }
    return visible.sort((first, second) => first.key.localeCompare(second.key));
  }

  private async allowed(definition: DataExchangeSourceDefinition, scopeKey: string, identity?: DataExchangeIdentity, transaction?: Prisma.TransactionClient): Promise<boolean> {
    try { return await definition.authorizeScope(scopeKey, identity, transaction) === true; }
    catch { throw new ServiceUnavailableException('Exchange source authorization is unavailable.'); }
  }
}
