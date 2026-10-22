import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

describe('position onboarding disposable database guard without database connections', () => {
  it.each([
    undefined, '', 'invalid', 'http://localhost:57624/test',
    'postgresql://remote.example:57624/test', 'postgresql://localhost:55440/test',
    'postgresql://localhost:57624/test?port=55440',
    'postgresql://localhost:57624/test?host=remote.example',
    'postgresql://localhost:57624/test#override',
  ])('rejects unsafe connection %s before loading PostgreSQL', (value) => {
    expect(isDisposableLoopbackPostgres(value)).toBe(false);
  });
  it.each(['postgresql://127.0.0.1:57624/test', 'postgres://[::1]:57624/test'])('accepts explicit loopback connection %s', (value) => {
    expect(isDisposableLoopbackPostgres(value)).toBe(true);
  });
});
