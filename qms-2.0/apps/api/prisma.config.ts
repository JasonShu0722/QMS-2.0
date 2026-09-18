import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const databaseUrl = process.env.DATABASE_URL;
const staticCommands = new Set(['validate', 'generate', 'format']);
const databaseCommands = new Set(['migrate', 'db', 'studio', 'introspect']);
// Prisma can load configuration through CLI wrappers with different argv offsets.
// Require one unambiguous static command and reject all database command tokens.
const staticTokens = process.argv.filter((argument) => staticCommands.has(argument));
const staticCommand = staticTokens.length === 1 &&
  !process.argv.some((argument) => databaseCommands.has(argument));
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
