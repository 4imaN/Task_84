export const parseCookieValue = (cookieHeader: string | undefined, cookieName: string) => {
  if (!cookieHeader) {
    return undefined;
  }

  const match = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${cookieName}=`));

  if (!match) {
    return undefined;
  }

  try {
    return decodeURIComponent(match.slice(cookieName.length + 1));
  } catch {
    return undefined;
  }
};
