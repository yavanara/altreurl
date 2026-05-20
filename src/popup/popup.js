import { buildDynamicRules, getRuleSetIssuesByRuleId, normalizePatternType, PATTERN_TYPES } from "../shared/rules.js";
import { appendDiagnosticLog, getRedirectRules, STORAGE_KEYS, getSuccessNotificationsEnabled, saveSuccessNotificationsEnabled } from "../shared/storage.js";
import { applyFavicons } from "../shared/favicon.js";
import { getThemedIconPath } from "../shared/icon.js";
import { initThemeControl } from "../shared/theme.js";
import { createNotifier } from "../shared/notifications.js";
import { applyTranslations, initI18n, t } from "../shared/i18n.js";

const summary = document.querySelector("#summary");
const activeRules = document.querySelector("#activeRules");
const ruleSearch = document.querySelector("#ruleSearch");
const openOptions = document.querySelector("#openOptions");
const notifications = document.querySelector("#notifications");
const toggleNotifications = document.querySelector("#toggleNotifications");
const notify = createNotifier(notifications, { scope: "popup" });

await initI18n();
let rules = await getRedirectRules();
let activeTabContext = await getActiveTabContext();

applyTranslations();
applyFavicons();
await initThemeControl();

// Initialize notification toggle state
if (toggleNotifications) {
  toggleNotifications.checked = await getSuccessNotificationsEnabled();
  toggleNotifications.addEventListener("change", async () => {
    await saveSuccessNotificationsEnabled(toggleNotifications.checked);
  });
}

function renderPopup() {
  const attentionIds = getRuleAttentionIds(rules);
  const applicableRules = activeTabContext.isSupported
    ? rules.filter((rule) => isRuleApplicableToTab(rule, activeTabContext))
    : [];
  const enabledRuleCount = applicableRules.filter((rule) => rule.enabled).length;
  const blockedRuleCount = applicableRules.filter((rule) => rule.enabled && attentionIds.has(rule.id)).length;
  const waitingRuleCount = getWaitingRuleCount(applicableRules, attentionIds);
  const query = ruleSearch.value.trim().toLowerCase();
  const visibleRules = applicableRules.filter((rule) => !query || [
    rule.name,
    rule.sourcePattern,
    rule.targetUrl
  ].some((value) => String(value || "").toLowerCase().includes(query)));

  const activeSummary = !activeTabContext.isSupported
    ? t("popup.unsupportedPage")
    : applicableRules.length === 0
      ? t("popup.noRulesFor", { host: activeTabContext.hostLabel })
      : t("popup.enabledForHost", {
          enabled: enabledRuleCount,
          total: applicableRules.length,
          host: activeTabContext.hostLabel
        });
  summary.textContent = blockedRuleCount > 0
    ? t("popup.needsAttentionSuffix", { summary: activeSummary, count: blockedRuleCount })
    : activeSummary;

  if (visibleRules.length === 0) {
    activeRules.replaceChildren(renderEmptyState({
      totalRuleCount: rules.length,
      contextualRuleCount: applicableRules.length,
      enabledRuleCount,
      blockedRuleCount,
      waitingRuleCount,
      hasQuery: Boolean(query),
      activeTabContext
    }));
    return;
  }

  activeRules.replaceChildren(...visibleRules.map((rule) => {
    const item = document.createElement("div");
    const detail = document.createElement("div");
    const name = document.createElement("strong");
    const toggleButton = document.createElement("button");
    const toggleIcon = document.createElement("img");
    const isEnabled = rule.enabled;
    const ruleTooltip = getRuleTooltip(rule, isEnabled);
    const ruleName = rule.name || t("options.rules.unnamed");
    const actionLabel = t(isEnabled ? "popup.action.disable" : "popup.action.enable", { name: ruleName });

    item.className = "popup-rule";
    item.title = ruleTooltip;
    item.dataset.enabled = String(isEnabled);
    name.textContent = ruleName;
    toggleButton.type = "button";
    toggleButton.className = "icon-button";
    toggleButton.setAttribute("aria-label", actionLabel);
    toggleButton.title = `${actionLabel}\n\n${ruleTooltip}`;
    toggleIcon.dataset.icon = isEnabled ? "icons8-checkbox-checked-32.png" : "icons8-checkbox-32.png";
    toggleIcon.src = getThemedIconPath(toggleIcon.dataset.icon);
    toggleIcon.alt = "";
    toggleIcon.width = 16;
    toggleIcon.height = 16;
    toggleButton.append(toggleIcon);
    toggleButton.addEventListener("click", async () => {
      const previousRules = rules;

      try {
        toggleButton.disabled = true;
        const latestRules = await getRedirectRules();
        const ruleStillExists = latestRules.some((currentRule) => currentRule.id === rule.id);

        if (!ruleStillExists) {
          rules = latestRules;
          throw new Error(t("popup.toast.ruleMissing"));
        }

        const nextRules = latestRules.map((currentRule) => currentRule.id === rule.id
          ? { ...currentRule, enabled: !isEnabled, modifiedAt: new Date().toISOString() }
          : currentRule);
        rules = nextRules;
        renderPopup();
        rules = await saveRules(nextRules);
        await appendDiagnosticLog(isEnabled ? "rule_disabled" : "rule_enabled", "info", {
          ruleId: rule.id,
          ruleName: ruleName
        });
        notify(t(isEnabled ? "popup.toast.disabled" : "popup.toast.enabled"), "success");
        renderPopup();
      } catch (error) {
        rules = previousRules;
        renderPopup();
        notify(error.message, "error");
      }
    });

    detail.append(name);
    item.append(detail, toggleButton);
    return item;
  }));
}

function renderEmptyState(context) {
  const emptyState = document.createElement("div");
  const title = document.createElement("strong");
  const detail = document.createElement("span");

  emptyState.className = "popup-empty";

  if (!context.activeTabContext?.isSupported) {
    title.textContent = t("popup.empty.unsupported.title");
    detail.textContent = t("popup.empty.unsupported.detail");
  } else if (context.hasQuery && context.contextualRuleCount > 0) {
    title.textContent = t("popup.empty.search.title");
    detail.textContent = t("popup.empty.search.detail");
  } else if (context.totalRuleCount === 0) {
    title.textContent = t("popup.empty.noRules.title");
    detail.textContent = t("popup.empty.noRules.detail");
  } else if (context.contextualRuleCount === 0) {
    title.textContent = t("popup.empty.noContextual.title", { host: context.activeTabContext.hostLabel });
    detail.textContent = t("popup.empty.noContextual.detail");
  } else if (context.enabledRuleCount === 0) {
    title.textContent = t("popup.empty.disabled.title");
    detail.textContent = t("popup.empty.disabled.detail");
  } else if (context.blockedRuleCount > 0 && context.contextualRuleCount > 0) {
    title.textContent = t("popup.empty.attention.title", {
      count: context.blockedRuleCount,
      noun: context.blockedRuleCount === 1 ? t("common.ruleNeeds") : t("common.rulesNeed")
    });
    detail.textContent = t("popup.empty.attention.detail");
  } else if (context.waitingRuleCount > 0) {
    title.textContent = t("popup.empty.waiting.title", {
      count: context.waitingRuleCount,
      verb: context.waitingRuleCount === 1 ? t("common.is") : t("common.are")
    });
    detail.textContent = t("popup.empty.waiting.detail");
  } else {
    title.textContent = t("popup.empty.noEnabled.title");
    detail.textContent = t("popup.empty.noEnabled.detail");
  }

  emptyState.append(title, detail);
  return emptyState;
}

async function getActiveTabContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ? new URL(tab.url) : null;

    if (!url || !["http:", "https:"].includes(url.protocol)) {
      return {
        isSupported: false,
        hostLabel: t("common.thisPage"),
        hostname: "",
        origin: "",
        url: tab?.url || ""
      };
    }

    return {
      isSupported: true,
      hostLabel: url.hostname,
      host: url.host,
      hostname: url.hostname,
      origin: url.origin,
      url: url.href
    };
  } catch (_error) {
    return {
      isSupported: false,
      hostLabel: t("common.thisPage"),
      hostname: "",
      origin: "",
      url: ""
    };
  }
}

function isRuleApplicableToTab(rule, tabContext) {
  const matcher = getRuleSourceMatcher(rule);

  return Boolean(matcher?.(tabContext));
}

function getRuleSourceMatcher(rule) {
  const patternType = normalizePatternType(rule.patternType);
  const sourcePattern = String(rule.sourcePattern || "").trim();

  if (!sourcePattern) {
    return null;
  }

  return patternType === PATTERN_TYPES.regex
    ? getRegexSourceMatcher(sourcePattern)
    : getWildcardSourceMatcher(sourcePattern);
}

function getWildcardSourceMatcher(sourcePattern) {
  const hostPattern = getWildcardSourceHostPattern(sourcePattern);

  return hostPattern ? buildHostMatcher(hostPattern) : null;
}

function getRegexSourceMatcher(sourcePattern) {
  const readablePattern = sourcePattern
    .replace(/^\^/, "")
    .replace(/\\\//g, "/")
    .replace(/\\\./g, ".")
    .replace(/\\:/g, ":");
  const match = readablePattern.match(/(?:https\?:|https?:)\/\/([A-Za-z0-9.-]+(?::\d+)?)/i);

  return match ? buildHostMatcher(match[1]) : null;
}

function getWildcardSourceHostPattern(sourcePattern) {
  const match = sourcePattern.match(/^(?:https?|\*):\/\/([^/\s]+)/i);

  return match?.[1] || "";
}

function buildHostMatcher(hostPattern) {
  const normalizedHostPattern = String(hostPattern || "").trim().toLowerCase();

  if (!normalizedHostPattern) {
    return null;
  }

  const shouldMatchPort = normalizedHostPattern.includes(":");
  const regex = normalizedHostPattern.includes("*")
    ? new RegExp(`^${escapeRegex(normalizedHostPattern).replace(/\*/g, ".*")}$`, "i")
    : null;

  return (tabContext) => {
    const candidate = String(shouldMatchPort ? tabContext.host : tabContext.hostname || "").toLowerCase();

    return regex ? regex.test(candidate) : candidate === normalizedHostPattern;
  };
}

function escapeRegex(value) {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function getRuleTooltip(rule, isEnabled = rule.enabled) {
  return [
    t("popup.tooltip.status", { status: isEnabled ? t("common.enabled") : t("common.disabled") }),
    t("popup.tooltip.source", { source: rule.sourcePattern || t("popup.value.notSet") }),
    t("popup.tooltip.target", { target: rule.targetUrl || t("popup.value.notSet") })
  ].join("\n");
}

async function saveRules(configRules) {
  const rulesToSave = Array.isArray(configRules) ? configRules : [];
  let response;

  try {
    response = await chrome.runtime.sendMessage({
      type: "SAVE_RULES",
      rules: rulesToSave
    });
  } catch (error) {
    throw new Error(error.message || t("runtime.error.apply"));
  }

  if (!response?.ok) {
    throw new Error(response?.error || t("runtime.error.apply"));
  }

  return Array.isArray(response.rules) ? response.rules : rulesToSave;
}

function getRuleIssueIds(configRules) {
  try {
    return getRuleSetIssuesByRuleId(configRules);
  } catch (_error) {
    return new Map();
  }
}

function getRuleAttentionIds(configRules) {
  const attentionIds = getRuleIssueIds(configRules);

  configRules
    .filter((rule) => rule.enabled)
    .forEach((rule) => {
      try {
        buildDynamicRules([rule]);
      } catch (error) {
        attentionIds.set(rule.id, error.message || t("runtime.error.apply"));
      }
    });

  return attentionIds;
}

function getWaitingRuleCount(configRules, attentionIds) {
  return configRules.filter((rule) => {
    if (!rule.enabled || attentionIds.has(rule.id)) {
      return false;
    }

    try {
      return buildDynamicRules([rule]).length === 0;
    } catch (_error) {
      return false;
    }
  }).length;
}

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

ruleSearch.addEventListener("input", renderPopup);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEYS.rules]) {
    return;
  }

  rules = Array.isArray(changes[STORAGE_KEYS.rules].newValue)
    ? changes[STORAGE_KEYS.rules].newValue
    : [];
  renderPopup();
});

renderPopup();
