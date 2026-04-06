import { parseCookieValue } from './auth-cookie.util';

describe('parseCookieValue', () => {
  it('returns the decoded cookie value when present', () => {
    expect(parseCookieValue('other=1; ledgerread_session=token%20value', 'ledgerread_session')).toBe(
      'token value',
    );
  });

  it('treats malformed encoded cookie values as missing', () => {
    expect(parseCookieValue('ledgerread_session=%E0%A4%A', 'ledgerread_session')).toBeUndefined();
  });
});
