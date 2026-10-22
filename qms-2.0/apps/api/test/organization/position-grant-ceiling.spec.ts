import { PositionGrantCeilingDenied } from '../../src/modules/organization/position-onboarding.service.js';

it('distinguishes an authorized actor exceeding a position grant ceiling from actor-wide permission loss', () => {
  const denied = new PositionGrantCeilingDenied();
  expect(denied.getStatus()).toBe(403);
  expect(denied.getResponse()).toMatchObject({ code: 'POSITION_GRANT_CEILING_DENIED' });
});
