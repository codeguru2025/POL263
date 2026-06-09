import { describe, it, expect } from 'vitest';
import { isAgentScoped } from '@shared/roles';

/**
 * Regression coverage for the "Access Denied when adding dependants" bug:
 * an administrator who ALSO carries the "agent" role (e.g. for a referral code)
 * must NOT be scoped down to only their own policies. enforceAgentPolicyAccess()
 * relies on isAgentScoped() to make this call.
 */
describe('isAgentScoped', () => {
  it('scopes a pure agent', () => {
    expect(isAgentScoped([{ name: 'agent' }])).toBe(true);
  });

  it('does NOT scope a user without the agent role', () => {
    expect(isAgentScoped([{ name: 'administrator' }])).toBe(false);
    expect(isAgentScoped([{ name: 'manager' }])).toBe(false);
  });

  it('does NOT scope an administrator who also holds the agent role', () => {
    expect(isAgentScoped([{ name: 'agent' }, { name: 'administrator' }])).toBe(false);
  });

  it('does NOT scope a manager who also holds the agent role', () => {
    expect(isAgentScoped([{ name: 'manager' }, { name: 'agent' }])).toBe(false);
  });

  it('does NOT scope a superuser who also holds the agent role', () => {
    expect(isAgentScoped([{ name: 'agent' }, { name: 'superuser' }])).toBe(false);
  });

  it('scopes an agent paired only with non-superior roles', () => {
    expect(isAgentScoped([{ name: 'agent' }, { name: 'cashier' }])).toBe(true);
  });
});
