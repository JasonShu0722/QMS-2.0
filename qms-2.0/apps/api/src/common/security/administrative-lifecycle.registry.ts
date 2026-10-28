import { Injectable, Module } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AdminActor } from './admin-mutation.service.js';
import type { AdministrativeLifecycleEffect, AdministrativeLifecycleImpact } from './administrative-lifecycle.types.js';

@Injectable()
export class AdministrativeLifecycleRegistry {
  private readonly effects = new Map<string, AdministrativeLifecycleEffect>();
  private frozen = false;

  register(effect: AdministrativeLifecycleEffect) {
    if (this.frozen) throw new Error('ADMIN_LIFECYCLE_EFFECTS_FROZEN');
    if (this.effects.has(effect.module)) throw new Error('ADMIN_LIFECYCLE_EFFECT_DUPLICATE');
    this.effects.set(effect.module, effect);
  }

  seal() {
    if (['workflow', 'platform-configuration', 'identity'].some(module => !this.effects.has(module))) {
      throw new Error('ADMIN_LIFECYCLE_EFFECTS_INCOMPLETE');
    }
    this.frozen = true;
  }

  async apply(tx: Prisma.TransactionClient, actor: AdminActor, impact: AdministrativeLifecycleImpact) {
    if (!this.frozen) throw new Error('ADMIN_LIFECYCLE_EFFECTS_INCOMPLETE');
    const results = [];
    // Cancel pending responsibilities before revoking the identities used to authorize their snapshots.
    for (const module of ['workflow', 'platform-configuration', 'identity']) results.push(await this.effects.get(module)!.apply(tx, actor, impact));
    return results;
  }
}

@Module({ providers: [AdministrativeLifecycleRegistry], exports: [AdministrativeLifecycleRegistry] })
export class AdministrativeLifecycleModule {}
