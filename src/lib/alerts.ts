export type AlertScope = "script" | "operator";

const KEY = "cueflow:alertScope";

export function loadAlertScope(): AlertScope {
  if (typeof localStorage === "undefined") return "operator";
  return localStorage.getItem(KEY) === "script" ? "script" : "operator";
}

export function saveAlertScope(scope: AlertScope) {
  localStorage.setItem(KEY, scope);
  window.dispatchEvent(new CustomEvent("cueflow:alert-scope", { detail: scope }));
}
