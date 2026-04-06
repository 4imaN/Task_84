import {
  getPasswordPolicyErrorMessage,
  getPasswordPolicyViolations,
  isPasswordPolicyCompliant,
  PASSWORD_POLICY_MESSAGE,
} from './password-policy';

describe('password policy', () => {
  it('rejects passwords shorter than 10 characters', () => {
    expect(getPasswordPolicyViolations('Ab1!xyz')).toContain('MIN_LENGTH');
    expect(isPasswordPolicyCompliant('Ab1!xyz')).toBe(false);
  });

  it('rejects passwords that do not contain a number', () => {
    expect(getPasswordPolicyViolations('NoNumber!!AA')).toContain('NUMBER');
    expect(isPasswordPolicyCompliant('NoNumber!!AA')).toBe(false);
  });

  it('rejects passwords that do not contain a symbol', () => {
    expect(getPasswordPolicyViolations('NoSymbol1234')).toContain('SYMBOL');
    expect(isPasswordPolicyCompliant('NoSymbol1234')).toBe(false);
  });

  it('accepts valid boundary passwords', () => {
    expect(getPasswordPolicyViolations('Abcdef1!gh')).toEqual([]);
    expect(isPasswordPolicyCompliant('Abcdef1!gh')).toBe(true);
  });

  it('accepts stronger valid passwords', () => {
    expect(getPasswordPolicyViolations('Stronger#Pass2026!')).toEqual([]);
    expect(isPasswordPolicyCompliant('Stronger#Pass2026!')).toBe(true);
  });

  it('returns a deterministic policy message', () => {
    expect(PASSWORD_POLICY_MESSAGE).toBe(
      'Password must be at least 10 characters and include at least one number and one symbol.',
    );
    expect(getPasswordPolicyErrorMessage()).toBe(PASSWORD_POLICY_MESSAGE);
    expect(getPasswordPolicyErrorMessage('Seed password for reader.ada')).toBe(
      'Seed password for reader.ada must be at least 10 characters and include at least one number and one symbol.',
    );
  });
});
