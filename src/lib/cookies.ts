// Minimal first-party cookie helpers. Necessary local storage and authentication remain functional
// regardless of optional analytics consent.
export const setCookie = (name: string, value: string, days = 365) => {
  const d = new Date(); d.setTime(d.getTime() + days * 864e5);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
};

export const getCookie = (name: string): string | null => {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
};

export type AnalyticsConsent = "unset" | "accepted" | "declined";
export type PerformanceConsent = "accepted" | "declined";
export type ConsentState = { analytics: AnalyticsConsent; performance: PerformanceConsent };
export const CONSENT_COOKIE = "cueflow:consent";

export function getConsent(): ConsentState {
  const raw = getCookie(CONSENT_COOKIE);
  if (!raw) return { analytics: "unset", performance: "accepted" };
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (parsed.analytics === "accepted" || parsed.analytics === "declined") return { analytics: parsed.analytics, performance: parsed.performance === "declined" ? "declined" : "accepted" };
  } catch {
    // Backward compatibility with the previous binary cookie values.
    if (raw === "accepted") return { analytics: "accepted", performance: "accepted" };
    if (raw === "declined") return { analytics: "declined", performance: "accepted" };
  }
  return { analytics: "unset", performance: "accepted" };
}

export function saveConsent(state: Partial<ConsentState> & Pick<ConsentState, "analytics">) {
  const next: ConsentState = { analytics: state.analytics, performance: state.performance === "declined" ? "declined" : "accepted" };
  setCookie(CONSENT_COOKIE, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("cueflow:consent", { detail: next }));
}

export const hasConsent = () => getConsent().analytics === "accepted";
export const analyticsAllowed = () => getConsent().analytics === "accepted";
export const performanceAllowed = () => getConsent().performance !== "declined";
