import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, raw } from 'express';

export function configureHttpBodyParser(app: NestExpressApplication): void {
  app.use(/^\/api\/v1\/integrations\/inbound\/[0-9a-f-]+\/messages\/?$/i, raw({ type: () => true, limit: '1mb', inflate: false }));
  app.use('/api/v1/customer-quality/complaints/import', json({ limit: '6mb' }));
  // Up to 100 raw rows of 64000 bytes plus row metadata; ordinary writes retain the 100 kB limit.
  app.use(['/api/v1/customer-quality/ledger/import/preview', '/api/v1/customer-quality/ledger/import/commit'], json({ limit: '7mb' }));
  app.use('/api/v1/admin/configuration/component-project-mappings/import', json({ limit: '512kb' }));
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '100kb' });
}
