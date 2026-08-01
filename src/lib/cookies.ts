// Minimal cookie helpers (no dependency needed).
export const setCookie = (name: string, value: string, days = 365) => {
  const d = new Date(); d.setTime(d.getTime() + days * 864e5);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
};
export const getCookie = (name: string): string | null => {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
};
export const CONSENT_COOKIE = "cueflow:consent";
export const hasConsent = () => getCookie(CONSENT_COOKIE) === "accepted";
