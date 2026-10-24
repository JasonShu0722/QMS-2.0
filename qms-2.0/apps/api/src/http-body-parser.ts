import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';

export function configureHttpBodyParser(app: NestExpressApplication): void {
  app.use('/api/v1/customer-quality/complaints/import', json({ limit: '6mb' }));
  app.use('/api/v1/admin/configuration/component-project-mappings/import', json({ limit: '512kb' }));
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '100kb' });
}
