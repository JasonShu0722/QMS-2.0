import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const databaseUrl = process.env.DATABASE_URL;
const staticCommand = ['validate', 'generate', 'format'].includes(process.argv[2] ?? '');
if (!databaseUrl && !staticCommand) {
  throw new Error('DATABASE_URL is required for database commands');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --import tsx prisma/seed.ts',
  },
  datasource: {
    // Static commands never connect; no database command may use this placeholder.
    url: databaseUrl || 'postgresql://localhost:5432/qms_static_only',
  },
});
