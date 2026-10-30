import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { OBSERVATION_ORGANIZATION } from '../../common/observability/http-observation-scope.js';
import { ApiObservationCollectorService } from './api-observation-collector.service.js';

const installed = new WeakSet<INestApplication>();
const excluded = /^\/api\/v1\/admin\/console\/(?:api-observations|data-exchanges|services)(?:\/|$)/;
export function apiObservationMiddleware(collector: ApiObservationCollectorService) {
  return (request: Request & { [OBSERVATION_ORGANIZATION]?: string }, response: Response, next: NextFunction): void => {
    if (!/^\/api\/v1(?:\/|$)/.test(request.path) || excluded.test(request.path)) { next(); return; }
    const start = performance.now();
    let settled = false;
    const complete = (aborted: boolean) => {
      if (settled) return;
      settled = true;
      const route: unknown = request.route?.path;
      collector.record({ method: request.method, route: typeof route === 'string' ? route : undefined, scopeKey: request[OBSERVATION_ORGANIZATION], statusCode: aborted ? 499 : response.statusCode, duration: performance.now() - start });
    };
    response.once('finish', () => complete(false));
    response.once('close', () => complete(!response.writableFinished));
    next();
  };
}
export function installApiObservation(app: INestApplication): void {
  if (installed.has(app)) return;
  installed.add(app);
  const collector = app.get(ApiObservationCollectorService);
  app.use(apiObservationMiddleware(collector));
  collector.start();
}
