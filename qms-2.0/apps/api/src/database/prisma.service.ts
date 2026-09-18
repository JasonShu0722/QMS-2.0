import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(@Optional() databaseUrl = process.env.DATABASE_URL) {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required; SQLite fallback is forbidden');
    }
    if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
      throw new Error('DATABASE_URL must use PostgreSQL');
    }
    super({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
