export const STORAGE_KEYS = {
  rules: "redirectRules",
  theme: "themePreference",
  applyError: "altreurlApplyError",
  logs: "altreurlLogs",
  successNotificationsEnabled: "successNotificationsEnabled"
};

const MAX_LOG_ENTRIES = 100;

export async function getRedirectRules() {
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.rules]: [] });
  return Array.isArray(result[STORAGE_KEYS.rules]) ? result[STORAGE_KEYS.rules] : [];
}

export async function getThemePreference() {
  const result = await chrome.storage.local.get({ [STORAGE_KEYS.theme]: "system" });
  return ["system", "light", "dark"].includes(result[STORAGE_KEYS.theme]) ? result[STORAGE_KEYS.theme] : "system";
}

export async function saveThemePreference(themePreference) {
  const nextThemePreference = ["system", "light", "dark"].includes(themePreference) ? themePreference : "system";
  await chrome.storage.local.set({ [STORAGE_KEYS.theme]: nextThemePreference });
}

export async function getSuccessNotificationsEnabled() {
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

function sanitizeLogDetails(details) {
  if (!details || typeof details !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !/(authorization|token|cookie|headerValue|synced)/i.test(key))
      .map(([key, value]) => [key, sanitizeLogValue(value)])
  );
}

function createLogId() {
  return globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeLogValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeLogValue);
  }

  if (value && typeof value === "object") {
    return sanitizeLogDetails(value);
  }

  if (typeof value === "string") {
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  }

  return value;
}
