import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';

@Module({ imports: [DatabaseModule, IdentityModule] })
export class AppModule {}
