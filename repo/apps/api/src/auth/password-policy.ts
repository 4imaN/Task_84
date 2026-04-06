export const PASSWORD_POLICY_MIN_LENGTH = 10;
export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 10 characters and include at least one number and one symbol.';

export type PasswordPolicyViolation = 'MIN_LENGTH' | 'NUMBER' | 'SYMBOL';

const PASSWORD_NUMBER_PATTERN = /\d/;
const PASSWORD_SYMBOL_PATTERN = /[^A-Za-z0-9]/;

export const getPasswordPolicyViolations = (password: string): PasswordPolicyViolation[] => {
  const violations: PasswordPolicyViolation[] = [];

  if (password.length < PASSWORD_POLICY_MIN_LENGTH) {
    violations.push('MIN_LENGTH');
  }

  if (!PASSWORD_NUMBER_PATTERN.test(password)) {
    violations.push('NUMBER');
  }

  if (!PASSWORD_SYMBOL_PATTERN.test(password)) {
    violations.push('SYMBOL');
  }

  return violations;
};

export const isPasswordPolicyCompliant = (password: string) =>
  getPasswordPolicyViolations(password).length === 0;

export const getPasswordPolicyErrorMessage = (fieldName = 'Password') =>
  `${fieldName} must be at least 10 characters and include at least one number and one symbol.`;
