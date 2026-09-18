import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';

@Module({ imports: [DatabaseModule, IdentityModule, AuthorizationModule] })
export class AppModule {}
