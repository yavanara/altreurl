export const STORAGE_KEYS = {
  rules: "redirectRules",
  theme: "themePreference",
  applyError: "altreurlApplyError",
  logs: "altreurlLogs",
  successNotificationsEnabled: "successNotificationsEnabled",
  globalBypass: "globalBypass",
  domainBypassList: "domainBypassList"
};

const MAX_LOG_ENTRIES = 100;

export function hasChromeStorageApi() {
  return typeof chrome !== "undefined" && Boolean(chrome?.storage?.local?.get);
}

export async function getRedirectRules() {
  if (!hasChromeStorageApi()) {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.rules) || "[]"); } catch { return []; }
  }
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.rules]: [] });
  return Array.isArray(result[STORAGE_KEYS.rules]) ? result[STORAGE_KEYS.rules] : [];
}

export async function getThemePreference() {
  if (!hasChromeStorageApi()) {
    return localStorage.getItem(STORAGE_KEYS.theme) || "system";
  }
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.theme]: "system" });
  return ["system", "light", "dark"].includes(result[STORAGE_KEYS.theme]) ? result[STORAGE_KEYS.theme] : "system";
}

export async function saveThemePreference(themePreference) {
  const nextThemePreference = ["system", "light", "dark"].includes(themePreference) ? themePreference : "system";
  if (!hasChromeStorageApi()) {
    localStorage.setItem(STORAGE_KEYS.theme, nextThemePreference);
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.theme]: nextThemePreference });
}

export async function getSuccessNotificationsEnabled() {
  if (!hasChromeStorageApi()) return true;
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.successNotificationsEnabled]: true });
  return Boolean(result[STORAGE_KEYS.successNotificationsEnabled]);
}

export async function saveSuccessNotificationsEnabled(enabled) {
  await chrome.storage.local.set({ [STORAGE_KEYS.successNotificationsEnabled]: Boolean(enabled) });
}

export async function appendDiagnosticLog(event, severity = "info", details = {}) {
  try {
    const result = await chrome.storage.local.get({ [STORAGE_KEYS.logs]: [] });
    const logs = Array.isArray(result[STORAGE_KEYS.logs]) ? result[STORAGE_KEYS.logs] : [];
    const nextLogs = [
      ...logs,
      {
        id: createLogId(),
        occurredAt: new Date().toISOString(),
        event: String(event || "unknown"),
        severity: ["info", "warn", "error"].includes(severity) ? severity : "info",
        details: sanitizeLogDetails(details)
      }
    ].slice(-MAX_LOG_ENTRIES);

    await chrome.storage.local.set({ [STORAGE_KEYS.logs]: nextLogs });
  } catch (_error) {
    // Diagnostics must never break the actual extension workflow.
  }
}

export async function getDiagnosticLogs() {
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.logs]: [] });
  return Array.isArray(result[STORAGE_KEYS.logs]) ? result[STORAGE_KEYS.logs] : [];
}

export async function clearDiagnosticLogs() {
  await chrome.storage.local.set({ [STORAGE_KEYS.logs]: [] });
}

export function sanitizeLogDetails(details) {
  if (!details || typeof details !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !/(authorization|token|cookie|headerValue|synced|secret|password|bearer)/i.test(key))
      .map(([key, value]) => [key, sanitizeLogValue(value, key)])
  );
}

function createLogId() {
  return globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeLogValue(value, keyName = "") {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, keyName));
  }

  if (value && typeof value === "object") {
    const nameStr = String(value.name || "").toLowerCase();
    if (/(authorization|cookie|token|secret|password)/i.test(nameStr)) {
      return {
        name: value.name,
        value: "[REDACTED]"
      };
    }
    return sanitizeLogDetails(value);
  }

  if (typeof value === "string") {
    const valTrimmed = value.trim();
    if (
      /^(bearer\s|eyj|sessionid=|token=|auth=)/i.test(valTrimmed) ||
      /(authorization|token|cookie|secret|password)/i.test(String(keyName || ""))
    ) {
      return "[REDACTED]";
    }
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  }

  return value;
}

export async function getGlobalBypass() {
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.globalBypass]: false });
  return Boolean(result[STORAGE_KEYS.globalBypass]);
}

export async function saveGlobalBypass(bypass) {
  await chrome.storage.local.set({ [STORAGE_KEYS.globalBypass]: Boolean(bypass) });
}

export async function getDomainBypassList() {
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.domainBypassList]: [] });
  return Array.isArray(result[STORAGE_KEYS.domainBypassList]) ? result[STORAGE_KEYS.domainBypassList] : [];
}

export async function saveDomainBypassList(list) {
  const nextList = Array.isArray(list) ? list : [];
  const uniqueList = [...new Set(nextList.map(d => String(d || "").toLowerCase().trim()).filter(Boolean))];
  await chrome.storage.local.set({ [STORAGE_KEYS.domainBypassList]: uniqueList });
}

