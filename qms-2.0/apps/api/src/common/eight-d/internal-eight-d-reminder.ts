import { Prisma } from '../../generated/prisma/client.js';
import type { AtomicOutboxHandler } from '../../modules/task-notification/outbox-worker.service.js';
import { assertInternalEightDDomain, INTERNAL_EIGHT_D_DOMAINS, type InternalEightDDomainDescriptor } from './internal-eight-d-domain.js';

export function internalEightDReminderConfiguration(domain: InternalEightDDomainDescriptor) {
  assertInternalEightDDomain(domain);
  const process = domain === INTERNAL_EIGHT_D_DOMAINS.PROCESS;
  return {
    notifications: Prisma.raw(`${domain.storagePrefix}_notifications`),
    slots: Prisma.raw(`${domain.storagePrefix}_reminder_slots`),
    eventType: `${domain.storagePrefix.toUpperCase()}_REMINDER_DUE`,
    aggregateType: domain.revisionType.replace(/Revision$/, 'Reminder'),
    eventKeyPrefix: process ? 'eight-d' : domain.resourceType,
    invalidEvent: `${domain.storagePrefix.toUpperCase()}_REMINDER_EVENT_INVALID`,
    handlingSubject: process ? '过程8D办理催办' : domain === INTERNAL_EIGHT_D_DOMAINS.CUSTOMER ? '客户8D办理催办' : '新品8D办理催办',
  };
}

export function internalEightDReminderHandler(handlers: readonly AtomicOutboxHandler[]): AtomicOutboxHandler {
  return {
    eventTypes: [...new Set(handlers.flatMap(handler => handler.eventTypes))],
    async handle(tx, event) {
      for (const handler of handlers) {
        if (handler.eventTypes.includes(event.eventType) && await handler.handle(tx, event) !== 'deferred') return;
      }
      return 'deferred';
    },
  };
}
