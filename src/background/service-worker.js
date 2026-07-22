import { appendDiagnosticLog, getRedirectRules, STORAGE_KEYS, getSuccessNotificationsEnabled } from "../shared/storage.js";
import { initI18n, t } from "../shared/i18n.js";
import {
  applyDynamicRules,
  buildSourceMatcher,
  CREDENTIAL_SOURCES,
  hasSyncEnabled,
  isSyncableHeaderName,
  isWaitingForSyncCapture,
  normalizeCredentialSource,
  normalizeHeaderRows
} from "../shared/rules.js";

const CAPTURE_FILTER = { urls: ["<all_urls>"] };
const CAPTURE_OPTIONS = ["requestHeaders", "extraHeaders"];
const pendingRedirects = new Map();
const TOAST_AUTO_DISMISS_MS = 5000;
const TOAST_Z_INDEX = 2147483647;
const HYDRATION_TIMEOUT_MS = 5000;
const COOKIE_TIMEOUT_MS = 3000;

let appliedRuleWriteSignature = "";
let i18nReady = null;

function withTimeout(promise, ms, label = "Operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    )
  ]);
}

// --- WebRequest Listeners (synchronous wrappers with error catching) ---

chrome.webRequest.onBeforeSendHeaders.addListener((details) => {
  captureSourceRequest(details).catch((error) => {
    console.warn("captureSourceRequest error:", error?.message || error);
  });
}, CAPTURE_FILTER, CAPTURE_OPTIONS);

chrome.webRequest.onBeforeRedirect.addListener((details) => {
  handleBeforeRedirect(details).catch((error) => {
    console.warn("onBeforeRedirect error:", error?.message || error);
  });
}, CAPTURE_FILTER);

chrome.webRequest.onCompleted.addListener((details) => {
  handleCompleted(details).catch((error) => {
    console.warn("onCompleted error:", error?.message || error);
  });
}, CAPTURE_FILTER);

chrome.webRequest.onErrorOccurred.addListener((details) => {
  handleErrorOccurred(details).catch((error) => {
    console.warn("onErrorOccurred error:", error?.message || error);
  });
}, CAPTURE_FILTER);

// --- Core async handlers ---

async function handleBeforeRedirect(details) {
  if (!details.redirectUrl) return;

  await ensureI18nReady();
  const rules = await getRedirectRules();
  const candidateRules = rules.filter((rule) => {
    if (!rule.enabled || !rule.sourcePattern || !rule.targetUrl) return false;
    try {
      return buildSourceMatcher(rule.sourcePattern, rule.patternType)(details.url);
    } catch (_error) {
      return false;
    }
  });

  if (candidateRules.length === 0) return;

  let isIncognito = false;
  if (details.tabId !== -1) {
    try {
      const tab = await chrome.tabs.get(details.tabId);
      isIncognito = Boolean(tab?.incognito);
    } catch (_e) {
      // Ignore if tab is not found
    }
  }

  const matchedRule = candidateRules.find((rule) => {
    if (!hasSyncEnabled(rule)) return true;
    return isIncognito ? Boolean(rule.incognitoLastSyncedAt) : Boolean(rule.lastSyncedAt);
  });

  if (matchedRule) {
    pendingRedirects.set(details.requestId, {
      ruleId: matchedRule.id,
      ruleName: matchedRule.name || t("options.rules.unnamed"),
      originalUrl: details.url,
      redirectUrl: details.redirectUrl,
      tabId: details.tabId
    });
  }
}

async function handleCompleted(details) {
  const info = pendingRedirects.get(details.requestId);

  if (!info) return;
  pendingRedirects.delete(details.requestId);

  if (details.method === "OPTIONS") return;

  await ensureI18nReady();

  await appendDiagnosticLog("network_redirect_success", "info", {
    ruleName: info.ruleName,
    originalUrl: info.originalUrl,
    redirectUrl: info.redirectUrl,
    statusCode: details.statusCode
  });

  if (details.statusCode === 401) {
    await resetRuleSync(info.ruleId, info.ruleName, info.tabId);
  } else {
    const successNotificationsEnabled = await getSuccessNotificationsEnabled();
    if (successNotificationsEnabled) {
      showToastInTab(info.tabId, "success", `Altreurl: ${info.ruleName}`, `Redirected to ${info.redirectUrl} (${details.statusCode})`);
    }
  }
}

async function handleErrorOccurred(details) {
  const info = pendingRedirects.get(details.requestId);

  if (!info) return;
  pendingRedirects.delete(details.requestId);

  await ensureI18nReady();

  await appendDiagnosticLog("network_redirect_error", "error", {
    ruleName: info.ruleName,
    originalUrl: info.originalUrl,
    redirectUrl: info.redirectUrl,
    error: details.error
  });

  showToastInTab(info.tabId, "error", `Altreurl Error: ${info.ruleName}`, `${details.error} for ${info.redirectUrl}`);
}

// --- Service Worker lifecycle ---

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await ensureI18nReady();
    const rules = await getRedirectRules();
    await prepareAndApplyRules(rules, { persistHydratedRules: true });
  } catch (error) {
    console.warn("onInstalled error:", error?.message || error);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await ensureI18nReady();
    const rules = await getRedirectRules();
    await prepareAndApplyRules(rules, { persistHydratedRules: true });
  } catch (error) {
    console.warn("onStartup error:", error?.message || error);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.url) {
    try {
      const rules = await getRedirectRules();
      const hasAutoSyncRules = rules.some((rule) => {
        if (!rule.enabled || !hasSyncEnabled(rule) || ![CREDENTIAL_SOURCES.storage, CREDENTIAL_SOURCES.cookie].includes(normalizeCredentialSource(rule))) {
          return false;
        }
        try {
          const sourceUrl = getRepresentativeSourceUrl(rule.sourcePattern);
          if (!sourceUrl) return false;
          return new URL(tab.url).origin === new URL(sourceUrl).origin;
        } catch (_error) {
          return false;
        }
      });

      if (hasAutoSyncRules) {
        await prepareAndApplyRules(rules, { persistHydratedRules: true });
      }
    } catch (_error) {
      // Ignore background tab queries/injection warnings for unsupported URLs
    }
  }
});

chrome.tabs.onCreated.addListener(async () => {
  try {
    const rules = await getRedirectRules();
    await prepareAndApplyRules(rules);
  } catch (_e) {
    // Ignore tab listener errors
  }
});

chrome.tabs.onRemoved.addListener(async () => {
  try {
    const rules = await getRedirectRules();
    await prepareAndApplyRules(rules);
  } catch (_e) {
    // Ignore tab listener errors
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SAVE_RULES") {
    return false;
  }

  saveAndApplyRules(message.rules || [])
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

// --- Storage change listener ---

let pendingStorageChangeTimer = null;

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  const hasRulesChange = Boolean(changes[STORAGE_KEYS.rules]);
  const hasBypassChange = Boolean(changes.globalBypass || changes.domainBypassList);

  if (!hasRulesChange && !hasBypassChange) {
    return;
  }

  // Debounce: only process storage changes every 500ms
  if (pendingStorageChangeTimer !== null) {
    clearTimeout(pendingStorageChangeTimer);
  }

  pendingStorageChangeTimer = setTimeout(async () => {
    pendingStorageChangeTimer = null;
    try {
      const rules = await getRedirectRules();
      if (hasRulesChange) {
        const nextRules = changes[STORAGE_KEYS.rules].newValue || [];
        if (!shouldSkipAppliedRuleWrite(nextRules)) {
          await awaitI18nAndApplyRules(nextRules);
        }
      } else {
        await awaitI18nAndApplyRules(rules);
      }
    } catch (error) {
      await ensureI18nReady();
      console.warn("Storage change handler error:", error?.message || error);
      try {
        await chrome.storage.local.set({
          [STORAGE_KEYS.applyError]: {
            message: error.message || t("runtime.error.storedRules"),
            occurredAt: new Date().toISOString()
          }
        });
      } catch (_e) {
        // Storage write failed, cannot record error
      }
    }
  }, 500);
});

// --- I18n ---

function ensureI18nReady() {
  if (!i18nReady) {
    i18nReady = initI18n();
  }

  return i18nReady;
}

async function awaitI18nAndApplyRules(rules) {
  await ensureI18nReady();
  await prepareAndApplyRules(rules);
}

// --- Credential capture ---

async function captureSourceRequest(details) {
  if (details.method === "OPTIONS") return;

  await ensureI18nReady();

  const { globalBypass, domainBypassList } = await chrome.storage.local.get({
    globalBypass: false,
    domainBypassList: []
  });
  if (globalBypass) return;

  const rules = await getRedirectRules();
  const matchingRules = rules.filter((rule) => {
    if (!rule.enabled ||
      !hasSyncEnabled(rule) ||
      normalizeCredentialSource(rule) !== CREDENTIAL_SOURCES.request ||
      !rule.sourcePattern ||
      !rule.targetUrl) {
      return false;
    }

    if (Array.isArray(domainBypassList) && domainBypassList.length > 0) {
      const domain = getRuleDomain(rule);
      if (domain && domainBypassList.map((d) => d.toLowerCase()).includes(domain)) {
        return false;
      }
    }

    try {
      return buildSourceMatcher(rule.sourcePattern, rule.patternType)(details.url);
    } catch (_error) {
      return false;
    }
  });

  if (matchingRules.length === 0) return;

  // Use Promise.allSettled so one failure doesn't kill all captures
  const capturedResults = await Promise.allSettled(
    matchingRules.map((rule) => buildCapturedRule(rule, details))
  );

  const capturedRules = capturedResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  const readyCapturedRulesById = new Map(
    capturedRules
      .filter((rule) => !isWaitingForSyncCapture(rule))
      .map((rule) => [rule.id, rule])
  );

  if (readyCapturedRulesById.size === 0) return;

  const nextRules = rules.map((rule) => readyCapturedRulesById.get(rule.id) || rule);

  await prepareAndApplyRules(nextRules);

  try {
    rememberAppliedRuleWrite(nextRules);
    await chrome.storage.local.set({ [STORAGE_KEYS.rules]: nextRules });
    await appendDiagnosticLog("sync_captured", "info", {
      ruleCount: readyCapturedRulesById.size
    });
  } catch (error) {
    await applyDynamicRules(rules);
    throw error;
  }
}

// --- Rule preparation and application ---

async function prepareAndApplyRules(rules, options = {}) {
  await ensureI18nReady();
  const hydratedRules = await hydrateCredentialSourceRules(rules);

  const normalTabIds = [];
  const incognitoTabIds = [];
  try {
    const tabs = await chrome.tabs.query({ windowType: "normal" });
    tabs.forEach((tab) => {
      if (tab.id) {
        if (tab.incognito) {
          incognitoTabIds.push(tab.id);
        } else {
          normalTabIds.push(tab.id);
        }
      }
    });
  } catch (_e) {
    // Fail silently if tab querying is restricted
  }

  const tabGroups = { normalTabIds, incognitoTabIds };

  const { globalBypass, domainBypassList } = await chrome.storage.local.get({
    globalBypass: false,
    domainBypassList: []
  });

  let rulesToRegister = hydratedRules;
  if (globalBypass) {
    rulesToRegister = [];
  } else if (Array.isArray(domainBypassList) && domainBypassList.length > 0) {
    const bypassSet = new Set(domainBypassList.map((d) => d.toLowerCase()));
    rulesToRegister = hydratedRules.filter((r) => {
      const domain = getRuleDomain(r);
      return !domain || !bypassSet.has(domain);
    });
  }

  await applyDynamicRules(rulesToRegister, tabGroups);
  await clearApplyError();
  await appendDiagnosticLog("dynamic_rules_applied", "info", {
    ruleCount: rulesToRegister.length,
    enabledRuleCount: rulesToRegister.filter((rule) => rule.enabled).length
  });

  if (options.persistHydratedRules && JSON.stringify(hydratedRules) !== JSON.stringify(rules)) {
    rememberAppliedRuleWrite(hydratedRules);
    await chrome.storage.local.set({ [STORAGE_KEYS.rules]: hydratedRules });
  }

  return hydratedRules;
}

async function saveAndApplyRules(rules) {
  await ensureI18nReady();
  const savedRules = Array.isArray(rules) ? rules : [];

  const hydratedRules = await prepareAndApplyRules(savedRules);

  rememberAppliedRuleWrite(hydratedRules);
  await chrome.storage.local.set({ [STORAGE_KEYS.rules]: hydratedRules });
  await appendDiagnosticLog("rules_saved", "info", {
    ruleCount: hydratedRules.length,
    enabledRuleCount: hydratedRules.filter((rule) => rule.enabled).length
  });

  return { rules: hydratedRules };
}

function rememberAppliedRuleWrite(rules) {
  appliedRuleWriteSignature = JSON.stringify(rules || []);
}

function shouldSkipAppliedRuleWrite(rules) {
  const signature = JSON.stringify(rules || []);

  if (!appliedRuleWriteSignature || signature !== appliedRuleWriteSignature) {
    return false;
  }

  appliedRuleWriteSignature = "";
  return true;
}

async function clearApplyError() {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.applyError);
  } catch (_error) {
    // Silent failure on clear
  }
}

// --- Credential hydration ---

async function hydrateCredentialSourceRules(rules) {
  const hydratedRules = [];

  for (const rule of rules) {
    hydratedRules.push(await hydrateCredentialSourceRule(rule));
  }

  return hydratedRules;
}

async function hydrateCredentialSourceRule(rule) {
  const capableRule = normalizeCredentialSourceCapabilities(rule);

  if (!capableRule.enabled || !hasSyncEnabled(capableRule) || !capableRule.sourcePattern || !capableRule.targetUrl) {
    return capableRule;
  }

  const credentialSource = normalizeCredentialSource(capableRule);

  if (credentialSource === CREDENTIAL_SOURCES.request) {
    return capableRule;
  }

  if (credentialSource === CREDENTIAL_SOURCES.storage) {
    return hydrateFromBrowserStorage(capableRule);
  }

  if (credentialSource === CREDENTIAL_SOURCES.cookie) {
    return hydrateFromCookies(capableRule);
  }

  return capableRule;
}

function normalizeCredentialSourceCapabilities(rule) {
  if (normalizeCredentialSource(rule) !== CREDENTIAL_SOURCES.cookie || !rule.syncHeaders) {
    return { ...rule };
  }

  return {
    ...rule,
    syncHeaders: false,
    syncedHeaders: []
  };
}

async function hydrateFromBrowserStorage(rule) {
  try {
    const sourceUrl = getRepresentativeSourceUrl(rule.sourcePattern);

    if (!sourceUrl) return rule;

    const sourceOrigin = new URL(sourceUrl).origin;
    const sourceTabs = await chrome.tabs.query({ url: `${sourceOrigin}/*` });

    if (sourceTabs.length === 0) return rule;

    let nextRule = { ...rule };

    for (const sourceTab of sourceTabs) {
      if (!sourceTab.id || !sourceTab.url) continue;
      try {
        const tabProtocol = new URL(sourceTab.url).protocol;
        if (!["http:", "https:"].includes(tabProtocol)) continue;
      } catch (_e) {
        continue;
      }

      try {
        const [result] = await withTimeout(
          chrome.scripting.executeScript({
            target: { tabId: sourceTab.id },
            args: [{
              area: rule.storageArea || "localStorage",
              authorizationKey: rule.authorizationKey || "",
              headersKey: rule.headersKey || ""
            }],
            func: ({ area, authorizationKey, headersKey }) => {
              const storage = area === "sessionStorage" ? window.sessionStorage : window.localStorage;

              return {
                authorization: authorizationKey ? storage.getItem(authorizationKey) || "" : "",
                headers: headersKey ? storage.getItem(headersKey) || "" : ""
              };
            }
          }),
          HYDRATION_TIMEOUT_MS,
          "Browser storage read"
        );

        const storageValues = result?.result || {};
        const isIncognito = sourceTab.incognito;

        const authValue = rule.syncAuthorization && storageValues.authorization
          ? formatAuthorizationValue(storageValues.authorization, rule.authorizationPrefix)
          : (isIncognito ? nextRule.incognitoSyncedAuthorization : nextRule.syncedAuthorization) || "";

        const headersValue = rule.syncHeaders && storageValues.headers
          ? parseHeaderValue(storageValues.headers)
          : (isIncognito ? nextRule.incognitoSyncedHeaders : nextRule.syncedHeaders) || [];

        const cookiesValue = rule.syncCookies
          ? await withTimeout(buildCookieHeaderFromRule(nextRule, sourceUrl, sourceTab.cookieStoreId), COOKIE_TIMEOUT_MS, "Cookie read")
          : (isIncognito ? nextRule.incognitoSyncedCookieHeader : nextRule.syncedCookieHeader) || "";

        if (isIncognito) {
          nextRule.incognitoSyncedAuthorization = authValue;
          nextRule.incognitoSyncedHeaders = headersValue;
          nextRule.incognitoSyncedCookieHeader = cookiesValue;
          nextRule.incognitoLastSyncedAt = new Date().toISOString();
        } else {
          nextRule.syncedAuthorization = authValue;
          nextRule.syncedHeaders = headersValue;
          nextRule.syncedCookieHeader = cookiesValue;
          nextRule.lastSyncedAt = new Date().toISOString();
        }
      } catch (_tabError) {
        // Tab might be restricted or loading, skip
      }
    }

    return nextRule;
  } catch (_error) {
    return rule;
  }
}

async function hydrateFromCookies(rule) {
  const sourceUrl = getRepresentativeSourceUrl(rule.sourcePattern);

  if (!sourceUrl) return rule;

  const sourceOrigin = new URL(sourceUrl).origin;
  const sourceTabs = await chrome.tabs.query({ url: `${sourceOrigin}/*` });

  if (sourceTabs.length === 0) {
    return hydrateFromCookiesForStore(rule, sourceUrl, null, false);
  }

  let nextRule = { ...rule };

  for (const sourceTab of sourceTabs) {
    nextRule = await hydrateFromCookiesForStore(nextRule, sourceUrl, sourceTab.cookieStoreId, sourceTab.incognito);
  }

  return nextRule;
}

async function hydrateFromCookiesForStore(rule, sourceUrl, storeId, isIncognito) {
  if (!sourceUrl) return rule;

  try {
    const queryDetails = { url: sourceUrl };
    if (storeId) {
      queryDetails.storeId = storeId;
    }
    const cookies = await withTimeout(chrome.cookies.getAll(queryDetails), COOKIE_TIMEOUT_MS, "Cookie query");
    const cookieNames = parseCsv(rule.cookieNames);
    const selectedCookies = cookieNames.length > 0
      ? cookies.filter((cookie) => cookieNames.includes(cookie.name))
      : cookies;
    const authorizationCookie = rule.authorizationKey
      ? cookies.find((cookie) => cookie.name === rule.authorizationKey)
      : null;

    const authValue = rule.syncAuthorization && authorizationCookie?.value
      ? formatAuthorizationValue(authorizationCookie.value, rule.authorizationPrefix)
      : (isIncognito ? rule.incognitoSyncedAuthorization : rule.syncedAuthorization) || "";

    const cookiesValue = rule.syncCookies
      ? selectedCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
      : (isIncognito ? rule.incognitoSyncedCookieHeader : rule.syncedCookieHeader) || "";

    if (isIncognito) {
      return {
        ...rule,
        incognitoSyncedAuthorization: authValue,
        incognitoSyncedCookieHeader: cookiesValue,
        incognitoLastSyncedAt: new Date().toISOString()
      };
    }

    return {
      ...rule,
      syncedAuthorization: authValue,
      syncedCookieHeader: cookiesValue,
      lastSyncedAt: new Date().toISOString()
    };
  } catch (_error) {
    return rule;
  }
}

function parseHeaderValue(rawHeaders) {
  try {
    const parsedHeaders = JSON.parse(rawHeaders);

    if (Array.isArray(parsedHeaders)) {
      return normalizeHeaderRows(parsedHeaders);
    }

    if (parsedHeaders && typeof parsedHeaders === "object") {
      return normalizeHeaderRows(
        Object.entries(parsedHeaders).map(([name, value]) => ({ name, value: String(value) }))
      );
    }
  } catch (_error) {
    // Fail silently if not parseable
  }

  return [];
}

function formatAuthorizationValue(value, prefix) {
  const trimmedValue = String(value || "").trim();
  const trimmedPrefix = String(prefix || "").trim();

  if (!trimmedValue || !trimmedPrefix || trimmedValue.toLowerCase().startsWith(`${trimmedPrefix.toLowerCase()} `)) {
    return trimmedValue;
  }

  return `${trimmedPrefix} ${trimmedValue}`;
}

function parseCsv(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function buildCookieHeaderFromRule(rule, sourceUrl, storeId = null) {
  const cookieNames = parseCsv(rule.cookieNames);
  const queryDetails = { url: sourceUrl };
  if (storeId) {
    queryDetails.storeId = storeId;
  }
  const cookies = await withTimeout(chrome.cookies.getAll(queryDetails), COOKIE_TIMEOUT_MS, "Cookie query");
  const selectedCookies = cookieNames.length > 0
    ? cookies.filter((cookie) => cookieNames.includes(cookie.name))
    : cookies;

  return selectedCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

// --- Utility ---

function getRepresentativeSourceUrl(sourcePattern) {
  let patternStr = String(sourcePattern || "");
  if (patternStr.startsWith("*://")) {
    patternStr = "http://" + patternStr.substring(4);
  }
  let normalizedPattern = patternStr
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\\./g, ".")
    .replace(/\(\.\*\??\)/g, "")
    .replace(/\(\[\^[^\]]+\]\*\??\)/g, "")
    .replace(/https?:\/\/(\*\.)+/i, (match) => match.toLowerCase().startsWith("https") ? "https://" : "http://")
    .replace(/\*/g, "");

  const urlMatch = normalizedPattern.match(/https?:\/\/[^/\\\s]+(?:\/[^\\\s]*)?/);

  if (!urlMatch) return "";

  let candidateUrl = urlMatch[0].replace(/^(https?:\/\/)\.+/, "$1");

  try {
    return new URL(candidateUrl).href;
  } catch (_error) {
    return "";
  }
}

function getRuleDomain(rule) {
  if (!rule || !rule.sourcePattern) return "";
  const repUrl = getRepresentativeSourceUrl(rule.sourcePattern);
  if (!repUrl) return "";
  try {
    return new URL(repUrl).hostname.toLowerCase();
  } catch (_e) {
    return "";
  }
}

async function buildCapturedRule(rule, details) {
  const requestHeaders = details.requestHeaders || [];
  const capturedHeaders = requestHeaders
    .filter((header) => rule.syncHeaders && isSyncableHeaderName(header.name))
    .map((header) => ({ name: header.name, value: header.value || "" }));
  const authorizationHeader = requestHeaders.find((header) => header.name.toLowerCase() === "authorization");
  const cookieHeader = requestHeaders.find((header) => header.name.toLowerCase() === "cookie");

  let isIncognito = false;
  let storeId = null;
  if (details.tabId !== -1) {
    try {
      const tab = await chrome.tabs.get(details.tabId);
      isIncognito = Boolean(tab?.incognito);
      storeId = tab?.cookieStoreId || null;
    } catch (_e) {
      // Ignore if tab is not found
    }
  }

  const authValue = rule.syncAuthorization ? authorizationHeader?.value || "" : "";
  const headersValue = rule.syncHeaders ? normalizeHeaderRows(capturedHeaders) : [];
  let cookiesValue = rule.syncCookies ? cookieHeader?.value || "" : "";

  if (rule.syncCookies && !cookiesValue) {
    cookiesValue = await buildCookieHeader(details.url, storeId);
  }

  const nextRule = { ...rule };

  if (isIncognito) {
    nextRule.incognitoSyncedHeaders = headersValue.length > 0 ? headersValue : rule.incognitoSyncedHeaders || [];
    nextRule.incognitoSyncedAuthorization = authValue || rule.incognitoSyncedAuthorization || "";
    nextRule.incognitoSyncedCookieHeader = cookiesValue || rule.incognitoSyncedCookieHeader || "";
    nextRule.incognitoLastSyncedAt = new Date().toISOString();
  } else {
    nextRule.syncedHeaders = headersValue.length > 0 ? headersValue : rule.syncedHeaders || [];
    nextRule.syncedAuthorization = authValue || rule.syncedAuthorization || "";
    nextRule.syncedCookieHeader = cookiesValue || rule.syncedCookieHeader || "";
    nextRule.lastSyncedAt = new Date().toISOString();
  }

  const missingSyncs = [];
  if (rule.syncHeaders && (isIncognito ? nextRule.incognitoSyncedHeaders.length === 0 : nextRule.syncedHeaders.length === 0)) missingSyncs.push("headers");
  if (rule.syncAuthorization && !(isIncognito ? nextRule.incognitoSyncedAuthorization : nextRule.syncedAuthorization)) missingSyncs.push("authorization");
  if (rule.syncCookies && !(isIncognito ? nextRule.incognitoSyncedCookieHeader : nextRule.syncedCookieHeader)) missingSyncs.push("cookies");

  if (missingSyncs.length > 0) {
    await appendDiagnosticLog("sync_missing_credentials", "warn", {
      ruleId: nextRule.id,
      ruleName: nextRule.name || t("options.rules.unnamed"),
      missing: missingSyncs,
      source: "request"
    });

    showToastInTab(details.tabId, "warn", `Altreurl Warning: ${nextRule.name || "Unnamed"}`, `Missing requested credentials: ${missingSyncs.join(", ")}`);
  }

  return nextRule;
}

async function buildCookieHeader(url, storeId = null) {
  const queryDetails = { url };
  if (storeId) {
    queryDetails.storeId = storeId;
  }
  const cookies = await chrome.cookies.getAll(queryDetails);
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function showToastInTab(tabId, type, message, detail) {
  if (!tabId || tabId === -1) return;

  // Skip restricted URL schemes
  try {
    if (tabId > 0) {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url) {
        const tabUrl = new URL(tab.url);
        if (!["http:", "https:"].includes(tabUrl.protocol)) return;
      }
    }
  } catch (_e) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (toastType, toastMessage, toastDetail) => {
        const containerId = "altreurl-toast-container";
        let container = document.getElementById(containerId);

        if (!container) {
          container = document.createElement("div");
          container.id = containerId;
          Object.assign(container.style, {
            position: "fixed",
            bottom: "24px",
            right: "24px",
            zIndex: "2147483647",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            pointerEvents: "none",
            fontFamily: "system-ui, -apple-system, sans-serif"
          });
          document.body.appendChild(container);
        }

        const toast = document.createElement("div");
        let borderColor = "#10b981";
        let icon = "✅";

        if (toastType === "error") {
          borderColor = "#ef4444";
          icon = "❌";
        } else if (toastType === "warn") {
          borderColor = "#f59e0b";
          icon = "⚠️";
        }

        Object.assign(toast.style, {
          background: "linear-gradient(135deg, rgba(30, 30, 30, 0.95), rgba(15, 15, 15, 0.95))",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderLeft: `4px solid ${borderColor}`,
          borderRadius: "8px",
          padding: "16px",
          color: "#ffffff",
          boxShadow: "0 10px 25px rgba(0, 0, 0, 0.3)",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          width: "340px",
          opacity: "0",
          transform: "translateY(20px)",
          transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
          pointerEvents: "auto"
        });

        const header = document.createElement("div");
        Object.assign(header.style, {
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontWeight: "600",
          fontSize: "14px",
          color: "#f3f4f6",
          lineHeight: "1.2"
        });
        header.textContent = `${icon} ${toastMessage}`;
        toast.appendChild(header);

        if (toastDetail) {
          const body = document.createElement("div");
          Object.assign(body.style, {
            fontSize: "12px",
            color: "#9ca3af",
            lineHeight: "1.4",
            wordBreak: "break-all"
          });
          body.textContent = toastDetail;
          toast.appendChild(body);
        }

        container.appendChild(toast);

        requestAnimationFrame(() => {
          toast.style.opacity = "1";
          toast.style.transform = "translateY(0)";
        });

        setTimeout(() => {
          toast.style.opacity = "0";
          toast.style.transform = "translateY(10px)";
          setTimeout(() => {
            if (toast.parentNode) {
              toast.parentNode.removeChild(toast);
            }
          }, 400);
        }, 5000);
      },
      args: [type, message, detail]
    });
  } catch (_error) {
    // Tab might be closed or restricted
  }
}

async function resetRuleSync(ruleId, ruleName, tabId) {
  const rules = await getRedirectRules();
  const ruleIndex = rules.findIndex((r) => r.id === ruleId);
  if (ruleIndex === -1) return;

  const rule = rules[ruleIndex];

  let isIncognito = false;
  if (tabId !== -1) {
    try {
      const tab = await chrome.tabs.get(tabId);
      isIncognito = Boolean(tab?.incognito);
    } catch (_e) {
      // Ignore if tab is not found
    }
  }

  const updatedRule = { ...rule };
  if (isIncognito) {
    updatedRule.incognitoSyncedHeaders = [];
    updatedRule.incognitoSyncedAuthorization = "";
    updatedRule.incognitoSyncedCookieHeader = "";
    updatedRule.incognitoLastSyncedAt = "";
  } else {
    updatedRule.syncedHeaders = [];
    updatedRule.syncedAuthorization = "";
    updatedRule.syncedCookieHeader = "";
    updatedRule.lastSyncedAt = "";
  }

  const nextRules = [...rules];
  nextRules[ruleIndex] = updatedRule;

  await appendDiagnosticLog("sync_reset_expired", "warn", {
    ruleId: rule.id,
    ruleName: ruleName,
    reason: `401 Unauthorized on redirect target (${isIncognito ? "Incognito" : "Normal"})`
  });

  await prepareAndApplyRules(nextRules);

  try {
    rememberAppliedRuleWrite(nextRules);
    await chrome.storage.local.set({ [STORAGE_KEYS.rules]: nextRules });
  } catch (_error) {
    // Fail silently if saving fails, but let the preparation persist if possible.
  }

  showToastInTab(
    tabId,
    "warn",
    `Altreurl Warning: ${ruleName}`,
    `Synced credentials expired (401) in ${isIncognito ? "Incognito" : "Normal"} tab. Resetting learning mode.`
  );
}
