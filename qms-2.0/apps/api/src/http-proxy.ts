import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureHttpProxy(app: NestExpressApplication): void {
  app.set('trust proxy', process.env.QMS_TRUST_PROXY_HOPS === '1' ? 1 : false);
}
