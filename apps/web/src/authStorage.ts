export const tokenKey = "arewavanta-organizer-token";

export function getStoredToken(): string | null {
  const token = window.localStorage.getItem(tokenKey);
  if (token) return token;

  // Keep an active login created by the older session-only build.
  const previousToken = window.sessionStorage.getItem(tokenKey);
  if (previousToken) {
    window.localStorage.setItem(tokenKey, previousToken);
    window.sessionStorage.removeItem(tokenKey);
  }
  return previousToken;
}

export function storeToken(token: string): void {
  window.localStorage.setItem(tokenKey, token);
  window.sessionStorage.removeItem(tokenKey);
}

export function clearStoredToken(): void {
  window.localStorage.removeItem(tokenKey);
  window.sessionStorage.removeItem(tokenKey);
}
