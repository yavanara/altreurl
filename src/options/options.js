import {
  PATTERN_TYPES,
  CREDENTIAL_MODES,
  CREDENTIAL_SOURCES,
  STORAGE_AREAS,
  convertPatternFormat,
  createBlankRule,
  getGeneratedDynamicRuleCount,
  getRuleSetIssuesByRuleId,
  hasSyncEnabled,
  isRegexPatternValid,
  isRegexSubstitutionValid,
  isWaitingForSyncCapture
} from "../shared/rules.js";
import {
  appendDiagnosticLog,
  clearDiagnosticLogs,
  getDiagnosticLogs,
  getRedirectRules,
  STORAGE_KEYS
} from "../shared/storage.js";
import { applyFavicons } from "../shared/favicon.js";
import { applyThemedIcons, getThemedIconPath } from "../shared/icon.js";
import { initThemeControl } from "../shared/theme.js";
import { createNotifier } from "../shared/notifications.js";
import { applyTranslations, initI18n, t } from "../shared/i18n.js";

const rulesList = document.querySelector("#rulesList");
const editorPanel = document.querySelector("#editorPanel");
const ruleCount = document.querySelector("#ruleCount");
const ruleSearch = document.querySelector("#ruleSearch");
const statusFilter = document.querySelector("#statusFilter");
const groupFilter = document.querySelector("#groupFilter");
const credentialFilter = document.querySelector("#credentialFilter");
const bulkToolbar = document.querySelector("#bulkToolbar");
const selectVisibleRules = document.querySelector("#selectVisibleRules");
const selectedRuleCount = document.querySelector("#selectedRuleCount");
const bulkEnable = document.querySelector("#bulkEnable");
const bulkDisable = document.querySelector("#bulkDisable");
const bulkGroupName = document.querySelector("#bulkGroupName");
const bulkMoveGroup = document.querySelector("#bulkMoveGroup");
const bulkDuplicate = document.querySelector("#bulkDuplicate");
const bulkExport = document.querySelector("#bulkExport");
const bulkRemove = document.querySelector("#bulkRemove");
const bulkActions = document.querySelector('[data-role="bulkActions"]');
const toggleRuleControls = document.querySelector("#toggleRuleControls");
const filterToggleLabel = toggleRuleControls.querySelector('[data-role="filterToggleLabel"]');
const filterToggleStateIcon = toggleRuleControls.querySelector('[data-role="filterToggleStateIcon"]');
const ruleListControls = document.querySelector("#ruleListControls");
const ruleListItemTemplate = document.querySelector("#ruleListItemTemplate");
const emptyEditorTemplate = document.querySelector("#emptyEditorTemplate");
const ruleTemplate = document.querySelector("#ruleTemplate");
const headerTemplate = document.querySelector("#headerTemplate");
const cookieTemplate = document.querySelector("#cookieTemplate");
const addRuleButton = document.querySelector("#addRule");
const importRulesButton = document.querySelector("#importRules");
const copyDiagnosticsButton = document.querySelector("#copyDiagnostics");
const importRulesFile = document.querySelector("#importRulesFile");
const importDialog = document.querySelector("#importDialog");
const importMode = document.querySelector("#importMode");
const importConflictMode = document.querySelector("#importConflictMode");
const importStats = document.querySelector("#importStats");
const importWarnings = document.querySelector("#importWarnings");
const importRulePreview = document.querySelector("#importRulePreview");
const importApply = document.querySelector("#importApply");
const importCancel = document.querySelector("#importCancel");
const importClose = document.querySelector("#importClose");
const exportDialog = document.querySelector("#exportDialog");
const exportScope = document.querySelector("#exportScope");
const exportCredentialMode = document.querySelector("#exportCredentialMode");
const exportGroupField = document.querySelector("#exportGroupField");
const exportGroup = document.querySelector("#exportGroup");
const exportStats = document.querySelector("#exportStats");
const exportWarnings = document.querySelector("#exportWarnings");
const exportRulePreview = document.querySelector("#exportRulePreview");
const exportCancel = document.querySelector("#exportCancel");
const exportClose = document.querySelector("#exportClose");
const exportCopy = document.querySelector("#exportCopy");
const exportDownload = document.querySelector("#exportDownload");
const diagnosticsDialog = document.querySelector("#diagnosticsDialog");
const diagnosticsStats = document.querySelector("#diagnosticsStats");
const diagnosticsErrors = document.querySelector("#diagnosticsErrors");
const diagnosticsLogs = document.querySelector("#diagnosticsLogs");
const diagnosticsCloseTop = document.querySelector("#diagnosticsCloseTop");
const diagnosticsClose = document.querySelector("#diagnosticsClose");
const diagnosticsCopy = document.querySelector("#diagnosticsCopy");
const diagnosticsCopyLogs = document.querySelector("#diagnosticsCopyLogs");
const diagnosticsClearLogs = document.querySelector("#diagnosticsClearLogs");
const themePreference = document.querySelector("#themePreference");
const notifications = document.querySelector("#notifications");
const notify = createNotifier(notifications, { scope: "options" });
const bulkExportLabel = bulkExport.querySelector('[data-role="bulkExportLabel"]');

await initI18n();

const appVersionEl = document.querySelector("#appVersion");
if (appVersionEl) {
  appVersionEl.textContent = `v${chrome.runtime.getManifest().version}`;
}
let rules = await getRedirectRules();
let selectedRuleId = "";
let isSavingRule = false;
let isRemovingRule = false;
let isUpdatingSelectedRules = false;
let isSavingRulesToStorage = false;
let pendingImport = null;
let pendingExport = null;
let pendingSavedRulesSignatures = new Set();
let savedRuleIds = new Set(rules.map((rule) => rule.id));
let dirtyRuleIds = new Set();
let selectedRuleIds = new Set();
const BACKGROUND_SYNC_FIELDS = [
  "syncedHeaders",
  "syncedAuthorization",
  "syncedCookieHeader",
  "lastSyncedAt"
];
const IMPORT_MODES = {
  draft: "draft",
  saveValid: "saveValid",
  merge: "merge",
  replace: "replace"
};
const IMPORT_CONFLICT_MODES = {
  draft: "draft",
  skip: "skip",
  disable: "disable",
  replace: "replace"
};
const EXPORT_SCOPES = {
  selected: "selected",
  all: "all",
  enabled: "enabled",
  group: "group"
};
const EXPORT_CREDENTIAL_MODES = {
  include: "include",
  redact: "redact",
  remove: "remove"
};
const REDACTED_VALUE = "REDACTED";

applyTranslations();
applyFavicons();
await initThemeControl(themePreference, { controlType: "toggle" });

function getSelectedRule() {
  return rules.find((rule) => rule.id === selectedRuleId);
}

function getDraftRules(persistedRules = []) {
  const persistedRuleIds = new Set(persistedRules.map((rule) => rule.id));
  return rules.filter((rule) => !savedRuleIds.has(rule.id) && !persistedRuleIds.has(rule.id));
}

function mergePersistedRulesWithDrafts(persistedRules = [], options = {}) {
  const committedRuleIds = options.committedRuleIds || new Set();
  const localRulesById = new Map(rules.map((rule) => [rule.id, rule]));
  const mergedPersistedRules = persistedRules.map((persistedRule) => {
    const localRule = localRulesById.get(persistedRule.id);

    if (!localRule || committedRuleIds.has(persistedRule.id)) {
      return persistedRule;
    }

    return mergeLocalRuleWithBackgroundSync(localRule, persistedRule);
  });

  return [...mergedPersistedRules, ...getDraftRules(persistedRules)];
}

function mergeLocalRuleWithBackgroundSync(localRule, persistedRule) {
  const nextRule = { ...persistedRule, ...localRule };

  BACKGROUND_SYNC_FIELDS.forEach((field) => {
    nextRule[field] = persistedRule[field];
  });

  return nextRule;
}

function isDraftRule(rule) {
  return !savedRuleIds.has(rule.id) || dirtyRuleIds.has(rule.id);
}

function createRuleId() {
  return crypto.randomUUID();
}

function timestampNow() {
  return new Date().toISOString();
}

function cloneRuleAsDraft(rule, suffix = t("options.rules.copySuffix")) {
  const now = timestampNow();

  return {
    ...rule,
    id: createRuleId(),
    name: `${rule.name || t("options.rules.unnamed")} ${suffix}`.trim(),
    enabled: false,
    createdAt: now,
    modifiedAt: now
  };
}

function normalizeImportedRule(rule) {
  if (!rule || typeof rule !== "object") {
    return null;
  }

  const blankRule = createBlankRule();

  return {
    ...blankRule,
    ...rule,
    id: createRuleId(),
    createdAt: timestampNow(),
    modifiedAt: timestampNow(),
    enabled: Boolean(rule.enabled),
    name: String(rule.name || blankRule.name).trim() || blankRule.name,
    group: String(rule.group || "").trim()
  };
}

function migrateImportedRule(rawRule, fileVersion = 1) {
  if (!rawRule || typeof rawRule !== "object") {
    return null;
  }

  return {
    ...rawRule,
    patternType: rawRule.patternType || PATTERN_TYPES.wildcard,
    credentialMode: rawRule.credentialMode || (
      rawRule.syncHeaders || rawRule.syncAuthorization || rawRule.syncCookies
        ? CREDENTIAL_MODES.sync
        : CREDENTIAL_MODES.manual
    ),
    credentialSource: rawRule.credentialSource || CREDENTIAL_SOURCES.request,
    storageArea: rawRule.storageArea || STORAGE_AREAS.localStorage,
    _importVersion: fileVersion
  };
}

function getSelectedRules() {
  return rules.filter((rule) => selectedRuleIds.has(rule.id));
}

function getPersistedRulesFromMemory() {
  return rules.filter((rule) => savedRuleIds.has(rule.id));
}

function getRuleGroup(rule) {
  return String(rule.group || "").trim() || t("options.rules.ungrouped");
}

function getRuleStatus(rule) {
  rule = normalizeRuleCredentialCapabilities(rule);
  const ruleSetIssue = getRuleSetIssue(rule);

  if (isDraftRule(rule)) {
    if (ruleSetIssue) {
      return {
        key: "draft",
        htmlLabel: `<span class="draft-tag">${t("common.draft")}</span> ${t("options.status.draftConflict")}`,
        description: t("options.status.draftConflict.description", { issue: ruleSetIssue })
      };
    }

    if (!rule.enabled) {
      return { 
        key: "draft-disabled", 
        htmlLabel: `<span class="draft-tag">${t("common.draft")}</span> ${t("common.disabled")}` 
      };
    }
    
    return { 
      key: "draft-ready", 
      htmlLabel: `<span class="draft-tag">${t("common.draft")}</span> ${t("common.ready")}` 
    };
  }

  if (ruleSetIssue) {
    return { key: "conflict", label: t("common.conflict"), description: ruleSetIssue };
  }

  if (!rule.enabled) {
    return { key: "disabled", label: t("common.disabled") };
  }

  if (!isRuleConfigValid(rule)) {
    return { key: "invalid", label: t("common.invalid") };
  }

  if (isWaitingForSyncCapture(rule)) {
    return { key: "waiting", label: t("options.status.waiting") };
  }

  return { key: "ready", label: t("common.ready") };
}

function normalizeRuleCredentialCapabilities(rule) {
  if (rule?.credentialSource !== CREDENTIAL_SOURCES.cookie || !rule.syncHeaders) {
    return rule;
  }

  return {
    ...rule,
    syncHeaders: false,
    syncedHeaders: []
  };
}

function getRuleStatusDescription(ruleStatus) {
  if (ruleStatus.description) {
    return ruleStatus.description;
  }

  const descriptions = {
    conflict: t("options.status.conflict.description"),
    draft: t("options.status.draft.description"),
    disabled: t("options.status.disabled.description"),
    invalid: t("options.status.invalid.description"),
    waiting: t("options.status.waiting.description"),
    ready: t("options.status.ready.description")
  };

  return descriptions[ruleStatus.key] || t("options.status.label");
}

function getRuleSetIssue(rule) {
  try {
    const persistedRules = getPersistedRulesFromMemory();
    const candidateRules = persistedRules.some((persistedRule) => persistedRule.id === rule.id)
      ? persistedRules.map((persistedRule) => persistedRule.id === rule.id ? rule : persistedRule)
      : [...persistedRules, rule];

    return getRuleSetIssuesByRuleId(candidateRules).get(rule.id) || "";
  } catch (_error) {
    return "";
  }
}

function getDynamicRuleCountLabel(rule) {
  try {
    const count = getGeneratedDynamicRuleCount([rule]);
    return t("options.rules.dynamicCount", { count, noun: count === 1 ? t("common.rule") : t("common.rules") });
  } catch (_error) {
    return t("options.rules.dynamicInvalid");
  }
}

function isRuleConfigValid(rule) {
  return getRuleValidationMessages(rule).length === 0;
}

function getRuleValidationMessages(rule) {
  const messages = [];

  if (!rule.sourcePattern || !rule.targetUrl) {
    if (!rule.sourcePattern) {
      messages.push({ field: "sourcePattern", message: t("options.validation.sourceRequired") });
    }

    if (!rule.targetUrl) {
      messages.push({ field: "targetUrl", message: t("options.validation.targetRequired") });
    }

    return messages;
  }

  if (rule.sourcePattern.includes("#")) {
    messages.push({ field: "sourcePattern", message: t("options.validation.sourceFragment") });
  }

  if (rule.targetUrl.includes("#")) {
    messages.push({ field: "targetUrl", message: t("options.validation.targetFragment") });
  }

  if (rule.patternType === PATTERN_TYPES.regex) {
    if (!isRegexPatternValid(rule.sourcePattern)) {
      messages.push({ field: "sourcePattern", message: t("options.validation.regexInvalid") });
      return messages;
    }

    if (!isRegexSubstitutionValid(rule.sourcePattern, rule.targetUrl)) {
      messages.push({ field: "targetUrl", message: t("options.validation.missingCaptureGroup") });
    }

    return messages;
  }

  const sourceWildcardCount = countWildcardCharacters(rule.sourcePattern);
  const targetWildcardCount = countWildcardCharacters(rule.targetUrl);

  if (targetWildcardCount > 0 && sourceWildcardCount === 0) {
    messages.push({ field: "targetUrl", message: t("options.validation.targetWildcardWithoutSource") });
    return messages;
  }

  if (sourceWildcardCount > 0 && targetWildcardCount > 0 && sourceWildcardCount !== targetWildcardCount) {
    messages.push({
      field: "targetUrl",
      message: t("options.validation.wildcardCount", {
        targetCount: targetWildcardCount,
        sourceCount: sourceWildcardCount
      })
    });
  }

  return messages;
}

function countWildcardCharacters(value) {
  return [...String(value || "")].filter((character) => character === "*").length;
}

function updateSelectedRuleFromEditor() {
  const card = editorPanel.querySelector(".rule-editor");

  if (!card) {
    return;
  }

  const credentialMode = card.querySelector('input[name="credentialMode"]:checked')?.value || CREDENTIAL_MODES.manual;
  rules = rules.map((rule) => {
    if (rule.id !== selectedRuleId) {
      return rule;
    }

    return normalizeRuleCredentialCapabilities({
      ...rule,
      name: card.querySelector('[data-field="name"]').value.trim(),
      group: card.querySelector('[data-field="group"]').value.trim(),
      enabled: card.querySelector('[data-field="enabled"]').checked,
      patternType: card.querySelector('input[name="patternType"]:checked')?.value || PATTERN_TYPES.wildcard,
      credentialMode,
      syncHeaders: credentialMode === CREDENTIAL_MODES.sync &&
        card.querySelector('[data-field="syncHeaders"]').checked,
      syncAuthorization: credentialMode === CREDENTIAL_MODES.sync &&
        card.querySelector('[data-field="syncAuthorization"]').checked,
      syncCookies: credentialMode === CREDENTIAL_MODES.sync &&
        card.querySelector('[data-field="syncCookies"]').checked,
      credentialSource: card.querySelector('input[data-field="credentialSource"]:checked')?.value || CREDENTIAL_SOURCES.request,
      storageArea: card.querySelector('[data-field="storageArea"]').value,
      authorizationKey: card.querySelector('[data-field="authorizationKey"]').value.trim(),
      authorizationPrefix: card.querySelector('[data-field="authorizationPrefix"]').value,
      headersKey: card.querySelector('[data-field="headersKey"]').value.trim(),
      cookieNames: card.querySelector('[data-field="cookieNames"]').value.trim(),
      sourcePattern: card.querySelector('[data-field="sourcePattern"]').value.trim(),
      targetUrl: card.querySelector('[data-field="targetUrl"]').value.trim(),
      authorization: card.querySelector('[data-field="authorization"]').value.trim(),
      headers: [...card.querySelectorAll('[data-role="headers"] .header-row')].map((row) => ({
        name: row.querySelector('[data-field="headerName"]').value.trim(),
        value: row.querySelector('[data-field="headerValue"]').value.trim()
      })),
      cookies: [...card.querySelectorAll('[data-role="cookies"] .header-row')].map((row) => ({
        name: row.querySelector('[data-field="cookieName"]').value.trim(),
        value: row.querySelector('[data-field="cookieValue"]').value.trim()
      }))
    });
  });

  if (savedRuleIds.has(selectedRuleId)) {
    dirtyRuleIds.add(selectedRuleId);
  }
}

function renderRuleList() {
  renderGroupFilter();
  const filteredRules = getFilteredRules();
  ruleCount.textContent = t("options.rules.count", { shown: filteredRules.length, total: rules.length });
  renderBulkToolbar(filteredRules);

  if (filteredRules.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "rule-list-empty";
    emptyState.textContent = t("options.rules.empty");
    rulesList.replaceChildren(emptyState);
    return;
  }

  rulesList.replaceChildren(...filteredRules.map((rule) => {
    const fragment = ruleListItemTemplate.content.cloneNode(true);
    applyTranslations(fragment);
    applyThemedIcons(fragment);
    const row = fragment.querySelector(".rule-list-row");
    const selector = fragment.querySelector('[data-role="ruleSelect"]');
    const item = fragment.querySelector(".rule-list-item");
    row.dataset.ruleId = rule.id;
    item.dataset.ruleId = rule.id;
    row.classList.toggle("is-selected", rule.id === selectedRuleId);
    selector.checked = selectedRuleIds.has(rule.id);
    selector.addEventListener("change", () => {
      if (selector.checked) {
        selectedRuleIds.add(rule.id);
      } else {
        selectedRuleIds.delete(rule.id);
      }

      renderRuleList();
    });
    const ruleStatus = getRuleStatus(rule);
    item.querySelector('[data-role="ruleName"]').textContent = rule.name || t("options.rules.unnamed");
    const statusBadge = item.querySelector('[data-role="statusBadge"]');
    statusBadge.innerHTML = ruleStatus.htmlLabel || ruleStatus.label;
    statusBadge.dataset.status = ruleStatus.key;
    statusBadge.title = getRuleStatusDescription(ruleStatus);
    item.title = t("options.rules.itemTooltip", {
      source: rule.sourcePattern || t("options.rules.noSource"),
      target: rule.targetUrl || t("options.rules.noTarget")
    });
    item.querySelector('[data-role="ruleGroup"]').textContent = getRuleGroup(rule);
    item.querySelector('[data-role="ruleMeta"]').textContent = `${rule.credentialMode || CREDENTIAL_MODES.manual} · ${rule.patternType || PATTERN_TYPES.wildcard} · ${getDynamicRuleCountLabel(rule)}`;
    item.addEventListener("click", () => {
      updateSelectedRuleFromEditor();
      selectedRuleId = rule.id;
      render();
    });
    return fragment;
  }));
}

function renderBulkToolbar(visibleRules = getFilteredRules()) {
  selectedRuleIds = new Set([...selectedRuleIds].filter((ruleId) => rules.some((rule) => rule.id === ruleId)));
  const selectedVisibleCount = visibleRules.filter((rule) => selectedRuleIds.has(rule.id)).length;
  const selectedCount = selectedRuleIds.size;

  bulkToolbar.hidden = rules.length === 0;
  selectedRuleCount.textContent = selectedCount > 0
    ? t("options.rules.selected", { count: selectedCount })
    : t("options.rules.visible", { count: visibleRules.length });
  selectVisibleRules.checked = visibleRules.length > 0 && selectedVisibleCount === visibleRules.length;
  selectVisibleRules.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleRules.length;
  bulkActions.hidden = selectedCount === 0;

  [bulkEnable, bulkDisable, bulkMoveGroup, bulkDuplicate, bulkRemove].forEach((button) => {
    button.disabled = selectedCount === 0 || isUpdatingSelectedRules;
  });
  bulkGroupName.disabled = selectedCount === 0 || isUpdatingSelectedRules;
  bulkExportLabel.textContent = t(selectedCount > 0 ? "options.actions.exportSelected" : "options.actions.exportAll");
}

function renderGroupFilter() {
  const selectedGroup = groupFilter.value || "all";
  const groups = [...new Set(rules.map((rule) => getRuleGroup(rule)))].sort((leftGroup, rightGroup) => {
    if (leftGroup === t("options.rules.ungrouped")) {
      return 1;
    }

    if (rightGroup === t("options.rules.ungrouped")) {
      return -1;
    }

    return leftGroup.localeCompare(rightGroup);
  });
  const options = [
    new Option(t("options.rules.filter.allGroups"), "all"),
    ...groups.map((group) => new Option(group, group))
  ];

  groupFilter.replaceChildren(...options);
  groupFilter.value = groups.includes(selectedGroup) ? selectedGroup : "all";
}

function getFilteredRules() {
  const query = ruleSearch.value.trim().toLowerCase();
  const status = statusFilter.value;
  const group = groupFilter.value;
  const credentialMode = credentialFilter.value;

  return [...rules]
    .filter((rule) => {
      const normalizedCredentialMode = rule.credentialMode || (hasSyncEnabled(rule) ? CREDENTIAL_MODES.sync : CREDENTIAL_MODES.manual);
      const matchesQuery = !query || [
        rule.name,
        rule.group,
        rule.sourcePattern,
        rule.targetUrl
      ].some((value) => String(value || "").toLowerCase().includes(query));
      const ruleStatus = getRuleStatus(rule);
      const isDraft = ruleStatus.key.startsWith("draft");
      const matchesStatus = status === "all" ||
        ruleStatus.key === status ||
        (status === "draft" && isDraft) ||
        (status === "enabled" && rule.enabled && !isDraft);
      const matchesGroup = group === "all" || getRuleGroup(rule) === group;
      const matchesCredential = credentialMode === "all" || normalizedCredentialMode === credentialMode;

      return matchesQuery && matchesStatus && matchesGroup && matchesCredential;
    })
    .sort((leftRule, rightRule) => getRuleUpdatedAt(rightRule) - getRuleUpdatedAt(leftRule));
}

function getRuleUpdatedAt(rule) {
  const timestamp = Date.parse(rule.modifiedAt || rule.createdAt || "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function renderHeader(header = { name: "", value: "" }) {
  const fragment = headerTemplate.content.cloneNode(true);
  applyTranslations(fragment);
  applyThemedIcons(fragment);
  const row = fragment.querySelector(".header-row");

  row.querySelector('[data-field="headerName"]').value = header.name || "";
  row.querySelector('[data-field="headerValue"]').value = header.value || "";
  row.querySelector('[data-action="removeHeader"]').addEventListener("click", () => {
    row.remove();
    updateSelectedRuleFromEditor();
    renderRuleList();
  });

  return fragment;
}

function renderCookie(cookie = { name: "", value: "" }) {
  const fragment = cookieTemplate.content.cloneNode(true);
  applyTranslations(fragment);
  applyThemedIcons(fragment);
  const row = fragment.querySelector(".header-row");

  row.querySelector('[data-field="cookieName"]').value = cookie.name || "";
  row.querySelector('[data-field="cookieValue"]').value = cookie.value || "";
  row.querySelector('[data-action="removeCookie"]').addEventListener("click", () => {
    row.remove();
    updateSelectedRuleFromEditor();
    renderRuleList();
  });

  return fragment;
}

function renderInlineValidation(rule, card) {
  const messagesByField = new Map();

  getRuleValidationMessages(rule).forEach((validation) => {
    const messages = messagesByField.get(validation.field) || [];
    messages.push(validation.message);
    messagesByField.set(validation.field, messages);
  });

  card.querySelectorAll("[data-feedback-for]").forEach((feedback) => {
    const field = feedback.dataset.feedbackFor;
    const messages = messagesByField.get(field) || [];
    const input = card.querySelector(`[data-field="${field}"]`);

    feedback.textContent = messages.join(" ");
    feedback.hidden = messages.length === 0;
    input?.classList.toggle("is-invalid", messages.length > 0);
    input?.setAttribute("aria-invalid", String(messages.length > 0));
  });
}

function renderEditor() {
  let rule = getSelectedRule();

  if (!rule) {
    const fragment = emptyEditorTemplate.content.cloneNode(true);
    applyTranslations(fragment);
    applyThemedIcons(fragment);
    fragment.querySelectorAll('[data-action="addEmptyRule"]').forEach((button) => {
      button.addEventListener("click", addDraftRule);
    });
    editorPanel.replaceChildren(fragment);
    return;
  }

  const normalizedRule = normalizeRuleCredentialCapabilities(rule);
  if (normalizedRule !== rule) {
    rule = normalizedRule;
    rules = rules.map((currentRule) => currentRule.id === rule.id ? rule : currentRule);
  }

  const fragment = ruleTemplate.content.cloneNode(true);
  applyTranslations(fragment);
  applyThemedIcons(fragment);
  const card = fragment.querySelector(".rule-editor");
  const manualOptions = card.querySelector('[data-role="manualOptions"]');
  const headersContainer = card.querySelector('[data-role="headers"]');
  const cookiesContainer = card.querySelector('[data-role="cookies"]');
  const patternTypeInputs = Array.from(card.querySelectorAll('input[name="patternType"]'));
  const credentialModeInputs = Array.from(card.querySelectorAll('input[name="credentialMode"]'));
  const sourcePatternInput = card.querySelector('[data-field="sourcePattern"]');
  const targetUrlInput = card.querySelector('[data-field="targetUrl"]');
  const credentialSourceInputs = Array.from(card.querySelectorAll('input[data-field="credentialSource"]'));
  const syncHeadersInput = card.querySelector('[data-field="syncHeaders"]');
  const syncAuthorizationInput = card.querySelector('[data-field="syncAuthorization"]');
  const syncCookiesInput = card.querySelector('[data-field="syncCookies"]');
  const syncOptions = card.querySelector('[data-role="syncOptions"]');
  const syncPreview = card.querySelector('[data-role="syncPreview"]');
  const syncTabs = card.querySelector('[data-role="syncTabs"]');
  const syncPreviewContent = card.querySelector('[data-role="syncPreviewContent"]');
  const sourceFields = {
    storageArea: card.querySelector('[data-role="storageAreaField"]'),
    authorizationKey: card.querySelector('[data-role="authorizationKeyField"]'),
    authorizationPrefix: card.querySelector('[data-role="authorizationPrefixField"]'),
    headersKey: card.querySelector('[data-role="headersKeyField"]'),
    cookieNames: card.querySelector('[data-role="cookieNamesField"]')
  };
  const sourceDetailsWrapper = card.querySelector('[data-role="sourceDetailsFields"]');

  card.querySelector('[data-field="enabled"]').checked = Boolean(rule.enabled);
  const editorStatusBadge = card.querySelector('[data-role="editorStatusBadge"]');
  const ruleStatus = getRuleStatus(rule);
  editorStatusBadge.innerHTML = ruleStatus.htmlLabel || ruleStatus.label;
  editorStatusBadge.dataset.status = ruleStatus.key;
  editorStatusBadge.title = getRuleStatusDescription(ruleStatus);
  card.querySelector('[data-field="name"]').value = rule.name || "";
  card.querySelector('[data-field="group"]').value = rule.group || "";
  
  const activePatternType = patternTypeInputs.find(input => input.value === (rule.patternType || PATTERN_TYPES.wildcard));
  if (activePatternType) activePatternType.checked = true;
  
  const activeMode = credentialModeInputs.find(input => input.value === (rule.credentialMode || (hasSyncEnabled(rule) ? CREDENTIAL_MODES.sync : CREDENTIAL_MODES.manual)));
  if (activeMode) activeMode.checked = true;
  
  sourcePatternInput.value = rule.sourcePattern || "";
  targetUrlInput.value = rule.targetUrl || "";
  card.querySelector('[data-field="authorization"]').value = rule.authorization || "";
  syncHeadersInput.checked = Boolean(rule.syncHeaders);
  syncAuthorizationInput.checked = Boolean(rule.syncAuthorization);
  syncCookiesInput.checked = Boolean(rule.syncCookies);
  const activeSourceInput = credentialSourceInputs.find(input => input.value === (rule.credentialSource || CREDENTIAL_SOURCES.request));
  if (activeSourceInput) activeSourceInput.checked = true;
  card.querySelector('[data-field="storageArea"]').value = rule.storageArea || STORAGE_AREAS.localStorage;
  card.querySelector('[data-field="authorizationKey"]').value = rule.authorizationKey || "";
  card.querySelector('[data-field="authorizationPrefix"]').value = rule.authorizationPrefix || "";
  card.querySelector('[data-field="headersKey"]').value = rule.headersKey || "";
  card.querySelector('[data-field="cookieNames"]').value = rule.cookieNames || "";
  card.querySelector('[data-role="syncStatus"]').textContent = getSyncStatus(rule);
  const currentModeValue = card.querySelector('input[name="credentialMode"]:checked')?.value || CREDENTIAL_MODES.manual;
  updateCredentialModeVisibility(currentModeValue, manualOptions, syncOptions);
  const currentSourceValue = card.querySelector('input[data-field="credentialSource"]:checked')?.value || CREDENTIAL_SOURCES.request;
  updateCredentialSourceVisibility(currentSourceValue, sourceFields, sourceDetailsWrapper, syncHeadersInput, syncAuthorizationInput, syncCookiesInput);
  renderInlineValidation(rule, card);
  renderSyncPreview(rule, syncPreview, syncTabs, syncPreviewContent);

  card.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", () => {
      if (patternTypeInputs.includes(input) || credentialModeInputs.includes(input) || credentialSourceInputs.includes(input)) {
        return;
      }

      updateSelectedRuleFromEditor();
      const currentSource = card.querySelector('input[data-field="credentialSource"]:checked')?.value || CREDENTIAL_SOURCES.request;
      updateCredentialSourceVisibility(currentSource, sourceFields, sourceDetailsWrapper, syncHeadersInput, syncAuthorizationInput, syncCookiesInput);
      renderInlineValidation(getSelectedRule(), card);
      renderRuleList();
      const newRuleStatus = getRuleStatus(getSelectedRule());
      editorStatusBadge.innerHTML = newRuleStatus.htmlLabel || newRuleStatus.label;
      editorStatusBadge.dataset.status = newRuleStatus.key;
      editorStatusBadge.title = getRuleStatusDescription(newRuleStatus);
      renderSyncPreview(getSelectedRule(), syncPreview, syncTabs, syncPreviewContent);
    });
    input.addEventListener("change", () => {
      if (patternTypeInputs.includes(input) || credentialModeInputs.includes(input) || credentialSourceInputs.includes(input)) {
        return;
      }

      updateSelectedRuleFromEditor();
      const currentSource = card.querySelector('input[data-field="credentialSource"]:checked')?.value || CREDENTIAL_SOURCES.request;
      updateCredentialSourceVisibility(currentSource, sourceFields, sourceDetailsWrapper, syncHeadersInput, syncAuthorizationInput, syncCookiesInput);
      renderInlineValidation(getSelectedRule(), card);
      renderRuleList();
      const newRuleStatus = getRuleStatus(getSelectedRule());
      editorStatusBadge.innerHTML = newRuleStatus.htmlLabel || newRuleStatus.label;
      editorStatusBadge.dataset.status = newRuleStatus.key;
      editorStatusBadge.title = getRuleStatusDescription(newRuleStatus);
      renderSyncPreview(getSelectedRule(), syncPreview, syncTabs, syncPreviewContent);
    });
  });

  patternTypeInputs.forEach(input => {
    input.addEventListener("change", () => {
      const previousRule = getSelectedRule();
      const fromType = previousRule?.patternType || PATTERN_TYPES.wildcard;
      const toType = input.value;

      if (fromType === toType) {
        return;
      }

      sourcePatternInput.value = convertPatternFormat(sourcePatternInput.value.trim(), fromType, toType, "source");
      targetUrlInput.value = convertPatternFormat(targetUrlInput.value.trim(), fromType, toType, "target");
      updateSelectedRuleFromEditor();
      renderInlineValidation(getSelectedRule(), card);
      renderRuleList();
      notify(t("options.toast.patternConverted", { type: toType }));
    });
  });

  credentialModeInputs.forEach(input => {
    input.addEventListener("change", () => {
      updateCredentialModeVisibility(input.value, manualOptions, syncOptions);
      updateSelectedRuleFromEditor();
      renderInlineValidation(getSelectedRule(), card);
      renderRuleList();
      renderSyncPreview(getSelectedRule(), syncPreview, syncTabs, syncPreviewContent);
    });
  });

  credentialSourceInputs.forEach(input => {
    input.addEventListener("change", () => {
      updateCredentialSourceVisibility(input.value, sourceFields, sourceDetailsWrapper, syncHeadersInput, syncAuthorizationInput, syncCookiesInput);
      updateSelectedRuleFromEditor();
      renderInlineValidation(getSelectedRule(), card);
      renderRuleList();
      renderSyncPreview(getSelectedRule(), syncPreview, syncTabs, syncPreviewContent);
    });
  });

  (rule.headers || []).forEach((header) => {
    headersContainer.append(renderHeader(header));
  });

  card.querySelector('[data-action="addHeader"]').addEventListener("click", () => {
    headersContainer.append(renderHeader());
    updateSelectedRuleFromEditor();
  });

  (rule.cookies || []).forEach((cookie) => {
    cookiesContainer.append(renderCookie(cookie));
  });

  card.querySelector('[data-action="addCookie"]').addEventListener("click", () => {
    cookiesContainer.append(renderCookie());
    updateSelectedRuleFromEditor();
  });

  card.querySelector('[data-action="saveRule"]').addEventListener("click", async (event) => {
    await saveCurrentRule(event.currentTarget);
  });

  card.querySelector('[data-action="removeRule"]').addEventListener("click", async (event) => {
    await removeCurrentRule(event.currentTarget);
  });

  editorPanel.replaceChildren(fragment);
}

function getSyncPreviewTabs(rule) {
  const tabs = [];

  if (rule.syncHeaders) {
    const headers = normalizeSyncedHeadersForPreview(rule.syncedHeaders);
    tabs.push({
      key: "headers",
      label: t("common.headers"),
      title: t("options.sync.headers.title"),
      emptyText: t("options.sync.headers.empty"),
      rows: headers
    });
  }

  if (rule.syncAuthorization) {
    tabs.push({
      key: "authorization",
      label: t("common.authorization"),
      title: t("options.sync.authorization.title"),
      emptyText: t("options.sync.authorization.empty"),
      rows: rule.syncedAuthorization
        ? [{ name: "Authorization", value: rule.syncedAuthorization }]
        : []
    });
  }

  if (rule.syncCookies) {
    tabs.push({
      key: "cookies",
      label: t("options.editor.sessionCookies"),
      title: t("options.sync.cookies.title"),
      emptyText: t("options.sync.cookies.empty"),
      rows: parseCookieHeaderForPreview(rule.syncedCookieHeader)
    });
  }

  return tabs;
}

function normalizeSyncedHeadersForPreview(headers = []) {
  return (Array.isArray(headers) ? headers : [])
    .map((header) => ({
      name: String(header.name || "").trim(),
      value: String(header.value || "").trim()
    }))
    .filter((header) => header.name && header.value);
}

function parseCookieHeaderForPreview(cookieHeader = "") {
  return String(cookieHeader || "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .map((cookie) => {
      const separatorIndex = cookie.indexOf("=");
      return separatorIndex === -1
        ? { name: cookie, value: "" }
        : {
            name: cookie.slice(0, separatorIndex).trim(),
            value: cookie.slice(separatorIndex + 1).trim()
          };
    })
    .filter((cookie) => cookie.name);
}

function renderSyncPreview(rule, syncPreview, syncTabs, syncPreviewContent) {
  const tabs = getSyncPreviewTabs(rule);
  const credentialMode = rule.credentialMode || (hasSyncEnabled(rule) ? CREDENTIAL_MODES.sync : CREDENTIAL_MODES.manual);

  if (credentialMode !== CREDENTIAL_MODES.sync || tabs.length === 0) {
    syncPreview.hidden = true;
    syncTabs.replaceChildren();
    syncPreviewContent.replaceChildren();
    return;
  }

  syncPreview.hidden = false;
  const activeKey = tabs.some((tab) => tab.key === syncPreview.dataset.activeTab)
    ? syncPreview.dataset.activeTab
    : tabs[0].key;
  syncPreview.dataset.activeTab = activeKey;
  const activeTab = tabs.find((tab) => tab.key === activeKey) || tabs[0];

  syncTabs.replaceChildren(...tabs.map((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sync-tab";
    button.dataset.tab = tab.key;
    button.textContent = tab.label;
    button.title = tab.title;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(tab.key === activeKey));
    button.classList.toggle("is-active", tab.key === activeKey);
    button.addEventListener("click", () => {
      syncPreview.dataset.activeTab = tab.key;
      renderSyncPreview(getSelectedRule(), syncPreview, syncTabs, syncPreviewContent);
    });
    return button;
  }));

  renderSyncPreviewContent(activeTab, syncPreviewContent);
  syncPreviewContent.title = activeTab.title;
}

function renderSyncPreviewContent(tab, syncPreviewContent) {
  const rows = tab.rows || [];

  if (rows.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "sync-preview-empty";
    emptyState.textContent = tab.emptyText;
    syncPreviewContent.replaceChildren(emptyState);
    return;
  }

  const list = document.createElement("div");
  list.className = "sync-preview-list";

  rows.forEach((row) => {
    const rowElement = document.createElement("div");
    rowElement.className = "sync-preview-row";

    const nameElement = document.createElement("span");
    nameElement.className = "sync-preview-row__name";
    nameElement.textContent = row.name;

    const valueElement = document.createElement("code");
    valueElement.className = "sync-preview-row__value";
    valueElement.textContent = row.value;

    rowElement.append(nameElement, valueElement);
    list.append(rowElement);
  });

  syncPreviewContent.replaceChildren(list);
}

function render() {
  renderRuleList();
  renderEditor();
}

function getSyncStatus(rule) {
  if (!hasSyncEnabled(rule)) {
    return t("options.sync.status.disabled");
  }

  if (isWaitingForSyncCapture(rule)) {
    return rule.credentialSource && rule.credentialSource !== CREDENTIAL_SOURCES.request
      ? t("options.sync.status.waitingCredentialSource")
      : t("options.sync.status.waitingSource");
  }

  return rule.lastSyncedAt
    ? t("options.sync.status.lastSynced", { time: new Date(rule.lastSyncedAt).toLocaleString() })
    : t("common.ready");
}

function updateCredentialModeVisibility(credentialMode, manualOptions, syncOptions) {
  const isSyncMode = credentialMode === CREDENTIAL_MODES.sync;

  manualOptions.hidden = isSyncMode;
  syncOptions.hidden = !isSyncMode;
}

function updateCredentialSourceVisibility(credentialSource, sourceFields, sourceDetailsWrapper, syncHeadersInput, syncAuthorizationInput, syncCookiesInput) {
  const isRequestSource = credentialSource === CREDENTIAL_SOURCES.request;
  const isStorageSource = credentialSource === CREDENTIAL_SOURCES.storage;
  const isCookieSource = credentialSource === CREDENTIAL_SOURCES.cookie;

  if (syncHeadersInput) {
    syncHeadersInput.disabled = isCookieSource;
    syncHeadersInput.title = isCookieSource ? t("options.sync.cookieSourceHeaders.title") : t("options.sync.headersInput.title");
    if (isCookieSource && syncHeadersInput.checked) syncHeadersInput.checked = false;
  }
  
  if (syncAuthorizationInput) {
    syncAuthorizationInput.disabled = isCookieSource;
    syncAuthorizationInput.title = isCookieSource ? t("options.sync.cookieSourceHeaders.title") : "";
    if (isCookieSource && syncAuthorizationInput.checked) syncAuthorizationInput.checked = false;
  }

  const showStorageArea = isStorageSource && (syncHeadersInput?.checked || syncAuthorizationInput?.checked);
  const showAuthKey = isStorageSource && syncAuthorizationInput?.checked;
  const showHeadersKey = isStorageSource && syncHeadersInput?.checked;
  const showCookieNames = isCookieSource && syncCookiesInput?.checked;

  sourceFields.storageArea.hidden = !showStorageArea;
  sourceFields.authorizationKey.hidden = !showAuthKey;
  sourceFields.authorizationPrefix.hidden = !showAuthKey;
  sourceFields.headersKey.hidden = !showHeadersKey;
  sourceFields.cookieNames.hidden = !showCookieNames;

  if (sourceDetailsWrapper) {
    sourceDetailsWrapper.hidden = !showStorageArea && !showAuthKey && !showHeadersKey && !showCookieNames;
  }
}

async function saveRules(savedRules) {
  isSavingRulesToStorage = true;
  const rulesToSave = Array.isArray(savedRules) ? savedRules : [];

  try {
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

    const responseRules = Array.isArray(response.rules) ? response.rules : rulesToSave;
    pendingSavedRulesSignatures.add(getRulesSignature(responseRules));

    return responseRules;
  } finally {
    isSavingRulesToStorage = false;
  }
}

function getRulesSignature(configRules) {
  return JSON.stringify(configRules || []);
}

async function saveCurrentRule(saveButton) {
  if (isSavingRule) {
    return;
  }

  const saveButtonLabel = saveButton.querySelector('[data-role="saveRuleLabel"]');

  try {
    isSavingRule = true;
    saveButton.disabled = true;
    saveButtonLabel.textContent = t("options.actions.saving");
    updateSelectedRuleFromEditor();
    touchSelectedRule();
    const selectedRule = getSelectedRule();
    const persistedRules = await getRedirectRules();
    const savedRules = upsertRule(persistedRules, selectedRule);
    const appliedRules = await saveRules(savedRules);

    savedRuleIds = new Set(appliedRules.map((rule) => rule.id));
    rules = mergePersistedRulesWithDrafts(appliedRules, { committedRuleIds: new Set([selectedRule.id]) });
    render();
    notify(t("options.toast.ruleSaved"), "success");
  } catch (error) {
    notify(error.message, "error");
  } finally {
    isSavingRule = false;
    saveButton.disabled = false;
    saveButtonLabel.textContent = t("options.actions.saveRule");
  }
}

function upsertRule(savedRules, ruleToSave) {
  const existingRuleIndex = savedRules.findIndex((rule) => rule.id === ruleToSave.id);

  if (existingRuleIndex === -1) {
    return [ruleToSave, ...savedRules];
  }

  return savedRules.map((rule) => rule.id === ruleToSave.id ? ruleToSave : rule);
}

async function removeCurrentRule(removeButton) {
  if (isRemovingRule) {
    return;
  }

  try {
    isRemovingRule = true;
    removeButton.disabled = true;
    const ruleToRemove = getSelectedRule();

    if (!ruleToRemove) {
      return;
    }

    if (isDraftRule(ruleToRemove)) {
      rules = rules.filter((rule) => rule.id !== ruleToRemove.id);
      selectedRuleId = "";
      render();
      notify(t("options.toast.draftRemoved"));
      return;
    }

    const persistedRules = await getRedirectRules();
    const savedRules = persistedRules.filter((rule) => rule.id !== ruleToRemove.id);
    const appliedRules = await saveRules(savedRules);

    savedRuleIds = new Set(appliedRules.map((rule) => rule.id));
    rules = mergePersistedRulesWithDrafts(appliedRules).filter((rule) => rule.id !== ruleToRemove.id);
    selectedRuleId = "";
    render();
    notify(t("options.toast.ruleRemoved"), "success");
  } catch (error) {
    notify(error.message, "error");
    removeButton.disabled = false;
  } finally {
    isRemovingRule = false;
  }
}

async function savePersistedRules(nextRules, committedRuleIds) {
  const persistedRules = await getRedirectRules();
  const nextRulesById = new Map(nextRules.map((rule) => [rule.id, rule]));
  const savedRules = persistedRules.map((rule) => (
    committedRuleIds.has(rule.id) && nextRulesById.has(rule.id)
      ? nextRulesById.get(rule.id)
      : rule
  ));
  const appliedRules = await saveRules(savedRules);

  savedRuleIds = new Set(appliedRules.map((rule) => rule.id));
  committedRuleIds.forEach((id) => dirtyRuleIds.delete(id));
  rules = mergePersistedRulesWithDrafts(appliedRules, {
    committedRuleIds
  });
}

async function updateSelectedRules(mutator, successMessage) {
  if (selectedRuleIds.size === 0 || isUpdatingSelectedRules) {
    return;
  }

  const previousRules = rules;
  const previousSavedRuleIds = new Set(savedRuleIds);

  try {
    isUpdatingSelectedRules = true;
    const modifiedAt = timestampNow();
    const committedRuleIds = new Set([...selectedRuleIds].filter((ruleId) => savedRuleIds.has(ruleId)));
    rules = rules.map((rule) => selectedRuleIds.has(rule.id)
      ? mutator({ ...rule, modifiedAt })
      : rule);
    render();

    if (committedRuleIds.size > 0) {
      await savePersistedRules(rules, committedRuleIds);
    }

    render();
    notify(successMessage, "success");
  } catch (error) {
    rules = previousRules;
    savedRuleIds = previousSavedRuleIds;
    render();
    notify(error.message, "error");
  } finally {
    isUpdatingSelectedRules = false;
    renderRuleList();
  }
}

async function removeSelectedRules() {
  const selectedCount = selectedRuleIds.size;

  if (selectedCount === 0) {
    return;
  }

  const selectedRules = getSelectedRules();
  const savedCount = selectedRules.filter((rule) => savedRuleIds.has(rule.id)).length;
  const draftCount = selectedRules.length - savedCount;
  const confirmMessage = savedCount > 0 && draftCount > 0
    ? t("options.dialog.removeMixedSelected", { savedCount, draftCount })
    : t("options.dialog.removeSelected", {
        count: selectedCount,
        noun: selectedCount === 1 ? t("common.rule") : t("common.rules")
      });

  if (!window.confirm(confirmMessage)) {
    return;
  }

  const previousRules = rules;
  const previousSavedRuleIds = new Set(savedRuleIds);
  const previousSelectedRuleIds = new Set(selectedRuleIds);
  const previousSelectedRuleId = selectedRuleId;

  try {
    const ruleIdsToRemove = new Set(selectedRuleIds);
    const persistedRules = await getRedirectRules();
    rules = rules.filter((rule) => !selectedRuleIds.has(rule.id));
    savedRuleIds = new Set(rules.filter((rule) => savedRuleIds.has(rule.id)).map((rule) => rule.id));
    selectedRuleIds = new Set();
    selectedRuleId = rules.some((rule) => rule.id === selectedRuleId) ? selectedRuleId : "";
    const savedRules = persistedRules.filter((rule) => !ruleIdsToRemove.has(rule.id));
    const appliedRules = await saveRules(savedRules);

    savedRuleIds = new Set(appliedRules.map((rule) => rule.id));
    rules = mergePersistedRulesWithDrafts(appliedRules);
    render();
    notify(t("options.toast.selectedRemoved"), "success");
  } catch (error) {
    rules = previousRules;
    savedRuleIds = previousSavedRuleIds;
    selectedRuleIds = previousSelectedRuleIds;
    selectedRuleId = previousSelectedRuleId;
    render();
    notify(error.message, "error");
  }
}

function duplicateSelectedRules() {
  const selectedRules = getSelectedRules();

  if (selectedRules.length === 0) {
    return;
  }

  const duplicatedRules = selectedRules.map((rule) => cloneRuleAsDraft(rule));
  rules = [...duplicatedRules, ...rules];
  selectedRuleIds = new Set(duplicatedRules.map((rule) => rule.id));
  selectedRuleId = duplicatedRules[0].id;
  render();
  notify(t("options.toast.duplicated", {
    count: duplicatedRules.length,
    noun: duplicatedRules.length === 1 ? t("common.rule") : t("common.rules")
  }));
}

function exportRules() {
  pendingExport = createExportPreview();

  if (pendingExport.rules.length === 0) {
    notify(t("options.toast.noExport"), "error");
    pendingExport = null;
    return;
  }

  renderExportDialog();
  exportDialog.showModal();
}

function createExportPreview() {
  const scope = selectedRuleIds.size > 0 ? EXPORT_SCOPES.selected : EXPORT_SCOPES.all;
  exportScope.value = scope;
  exportCredentialMode.value = EXPORT_CREDENTIAL_MODES.redact;
  renderExportGroups();

  return buildExportPreview();
}

function buildExportPreview() {
  const scope = exportScope.value || EXPORT_SCOPES.all;
  const credentialMode = exportCredentialMode.value || EXPORT_CREDENTIAL_MODES.redact;
  const selectedGroup = exportGroup.value;
  const rulesToExport = getRulesForExportScope(scope, selectedGroup);
  const statusCounts = rulesToExport.reduce((counts, rule) => {
    const status = getRuleStatus(rule).key;
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const sensitiveCount = rulesToExport.filter((rule) => hasExportableCredentials([rule])).length;
  const transformed = transformRulesForExport(rulesToExport, credentialMode);

  return {
    scope,
    credentialMode,
    selectedGroup,
    rules: rulesToExport,
    exportedRules: transformed.rules,
    credentialChangeCount: transformed.credentialChangeCount,
    statusCounts,
    sensitiveCount,
    payload: buildExportPayload(transformed.rules, {
      scope,
      credentialMode,
      selectedGroup,
      sensitiveCount,
      credentialChangeCount: transformed.credentialChangeCount
    })
  };
}

function getRulesForExportScope(scope, selectedGroup) {
  if (scope === EXPORT_SCOPES.selected) {
    return getSelectedRules();
  }

  const persistedRules = getPersistedRulesFromMemory();

  if (scope === EXPORT_SCOPES.enabled) {
    return persistedRules.filter((rule) => rule.enabled);
  }

  if (scope === EXPORT_SCOPES.group) {
    return persistedRules.filter((rule) => getRuleGroup(rule) === selectedGroup);
  }

  return persistedRules;
}

function transformRulesForExport(rulesToExport, credentialMode) {
  let credentialChangeCount = 0;
  const rulesForExport = rulesToExport.map((rule) => {
    const clonedRule = structuredClone(rule);

    if (credentialMode === EXPORT_CREDENTIAL_MODES.include) {
      return clonedRule;
    }

    ["authorization", "syncedAuthorization", "syncedCookieHeader"].forEach((field) => {
      if (!clonedRule[field]) {
        return;
      }

      credentialChangeCount += 1;
      clonedRule[field] = credentialMode === EXPORT_CREDENTIAL_MODES.redact ? REDACTED_VALUE : "";
    });

    ["headers", "syncedHeaders"].forEach((field) => {
      if (!Array.isArray(clonedRule[field]) || clonedRule[field].length === 0) {
        return;
      }

      credentialChangeCount += clonedRule[field].filter((header) => header?.value).length;
      clonedRule[field] = credentialMode === EXPORT_CREDENTIAL_MODES.redact
        ? clonedRule[field].map((header) => ({ ...header, value: header.value ? REDACTED_VALUE : "" }))
        : [];
    });

    return clonedRule;
  });

  return { rules: rulesForExport, credentialChangeCount };
}

function buildExportPayload(rulesToExport, metadata) {
  const manifest = chrome.runtime.getManifest();

  return {
    version: 2,
    metadata: {
      app: manifest.name,
      extensionVersion: manifest.version,
      exportedAt: new Date().toISOString(),
      scope: metadata.scope,
      group: metadata.selectedGroup || "",
      credentialMode: metadata.credentialMode,
      ruleCount: rulesToExport.length,
      sensitiveRuleCount: metadata.sensitiveCount,
      credentialChangeCount: metadata.credentialChangeCount,
      warning: metadata.sensitiveCount > 0
        ? t("options.export.metadata.sensitiveWarning")
        : ""
    },
    rules: rulesToExport
  };
}

function renderExportGroups() {
  const groups = [...new Set(getPersistedRulesFromMemory().map((rule) => getRuleGroup(rule)))].sort();
  const options = groups.length > 0
    ? groups.map((group) => new Option(group, group))
    : [new Option(t("options.rules.ungrouped"), t("options.rules.ungrouped"))];

  exportGroup.replaceChildren(...options);
}

function renderExportDialog() {
  pendingExport = buildExportPreview();
  exportGroupField.hidden = pendingExport.scope !== EXPORT_SCOPES.group;

  exportStats.replaceChildren(...[
    createImportStat(t("options.export.stat.total"), pendingExport.rules.length),
    createImportStat(t("common.enabled"), pendingExport.rules.filter((rule) => rule.enabled).length),
    createImportStat(t("common.disabled"), pendingExport.rules.filter((rule) => !rule.enabled).length),
    createImportStat(t("common.conflict"), pendingExport.statusCounts.conflict || 0),
    createImportStat(t("common.invalid"), pendingExport.statusCounts.invalid || 0),
    createImportStat(t("options.export.stat.sensitive"), pendingExport.sensitiveCount)
  ]);

  const warnings = [];
  if (pendingExport.sensitiveCount > 0) {
    warnings.push(t("options.export.warning.sensitive", { count: pendingExport.sensitiveCount }));
  }
  if ((pendingExport.statusCounts.conflict || 0) > 0 || (pendingExport.statusCounts.invalid || 0) > 0) {
    warnings.push(t("options.export.warning.status"));
  }
  if (pendingExport.credentialMode === EXPORT_CREDENTIAL_MODES.include && pendingExport.sensitiveCount > 0) {
    warnings.push(t("options.export.warning.includeCredentials"));
  }

  exportWarnings.replaceChildren(...warnings.map((warning) => {
    const item = document.createElement("p");
    item.textContent = warning;
    return item;
  }));

  exportRulePreview.replaceChildren(...pendingExport.rules.slice(0, 12).map(renderExportPreviewRule));
  if (pendingExport.rules.length > 12) {
    const overflow = document.createElement("p");
    overflow.className = "import-rule-preview__overflow";
    overflow.textContent = t("options.import.preview.more", { count: pendingExport.rules.length - 12 });
    exportRulePreview.append(overflow);
  }
}

function renderExportPreviewRule(rule) {
  const item = document.createElement("div");
  const name = document.createElement("strong");
  const meta = document.createElement("span");
  const issue = document.createElement("small");
  const status = getRuleStatus(rule);

  item.className = "import-preview-rule";
  item.dataset.issue = String(["conflict", "invalid", "waiting"].includes(status.key));
  name.textContent = rule.name || t("options.rules.unnamed");
  meta.textContent = `${status.label} · ${rule.patternType || PATTERN_TYPES.wildcard} · ${rule.credentialMode || CREDENTIAL_MODES.manual}`;
  issue.textContent = status.description || (hasExportableCredentials([rule])
    ? t("options.export.preview.sensitive")
    : t("common.ready"));
  item.append(name, meta, issue);
  return item;
}

function downloadPendingExport() {
  if (!pendingExport || pendingExport.rules.length === 0) {
    notify(t("options.toast.noExport"), "error");
    return;
  }

  const exportBlob = new Blob([JSON.stringify(pendingExport.payload, null, 2)], {
    type: "application/json"
  });
  const exportUrl = URL.createObjectURL(exportBlob);
  const downloadLink = document.createElement("a");

  downloadLink.href = exportUrl;
  downloadLink.download = getExportFileName(pendingExport);
  downloadLink.click();
  URL.revokeObjectURL(exportUrl);
  notifyExportReport();
  appendDiagnosticLog("export_downloaded", "info", {
    scope: pendingExport.scope,
    credentialMode: pendingExport.credentialMode,
    ruleCount: pendingExport.rules.length
  });
  closeExportDialog();
}

async function copyPendingExportJson() {
  if (!pendingExport || pendingExport.rules.length === 0) {
    notify(t("options.toast.noExport"), "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(pendingExport.payload, null, 2));
    await appendDiagnosticLog("export_copied", "info", {
      scope: pendingExport.scope,
      credentialMode: pendingExport.credentialMode,
      ruleCount: pendingExport.rules.length
    });
    notify(t("options.export.toast.copied"), "success");
  } catch (error) {
    notify(error.message || t("options.export.toast.copyFailed"), "error");
  }
}

function notifyExportReport() {
  notify(t("options.export.report", {
    count: pendingExport.rules.length,
    noun: pendingExport.rules.length === 1 ? t("common.rule") : t("common.rules"),
    credentials: pendingExport.credentialChangeCount,
    invalid: (pendingExport.statusCounts.invalid || 0) + (pendingExport.statusCounts.conflict || 0)
  }), "success");
}

function getExportFileName(exportPreview) {
  const date = new Date().toISOString().slice(0, 10);
  const group = exportPreview.scope === EXPORT_SCOPES.group
    ? `-${sanitizeFileName(exportPreview.selectedGroup)}`
    : "";
  const safety = exportPreview.credentialMode === EXPORT_CREDENTIAL_MODES.include ? "rules" : "safe-export";

  return `altreurl-${safety}${group}-${date}.json`;
}

function sanitizeFileName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "group";
}

function closeExportDialog() {
  pendingExport = null;
  exportDialog.close();
  exportStats.replaceChildren();
  exportWarnings.replaceChildren();
  exportRulePreview.replaceChildren();
}

async function openDiagnostics() {
  await renderDiagnosticsDialog();
  diagnosticsDialog.showModal();
  await appendDiagnosticLog("diagnostics_opened", "info", {
    totalRules: rules.length
  });
}

async function renderDiagnosticsDialog() {
  const diagnostics = await buildDiagnosticsPayload({ includeLogs: true });
  const errorLogs = diagnostics.logs.filter((log) => log.severity === "error");

  diagnosticsStats.replaceChildren(...[
    createImportStat(t("options.diagnostics.stat.rules"), diagnostics.summary.totalRules),
    createImportStat(t("common.enabled"), diagnostics.summary.enabledRules),
    createImportStat(t("common.disabled"), diagnostics.summary.disabledRules),
    createImportStat(t("options.diagnostics.stat.dynamicRules"), diagnostics.summary.dynamicRuleCount),
    createImportStat(t("options.diagnostics.stat.logs"), diagnostics.logs.length),
    createImportStat(t("options.diagnostics.stat.errors"), errorLogs.length)
  ]);

  diagnosticsErrors.replaceChildren(...[
    diagnostics.lastApplyError?.message
      ? createDiagnosticsMessage(diagnostics.lastApplyError.message)
      : createDiagnosticsMessage(t("options.diagnostics.noApplyError"))
  ]);

  diagnosticsLogs.replaceChildren(...diagnostics.logs.slice(-20).reverse().map(renderDiagnosticLog));
  if (diagnostics.logs.length === 0) {
    diagnosticsLogs.replaceChildren(createDiagnosticsMessage(t("options.diagnostics.noLogs")));
  }
}

function createDiagnosticsMessage(message) {
  const item = document.createElement("p");
  item.textContent = message;
  return item;
}

function renderDiagnosticLog(log) {
  const item = document.createElement("div");
  const title = document.createElement("strong");
  const meta = document.createElement("span");
  const detail = document.createElement("small");

  item.className = "import-preview-rule";
  item.dataset.issue = String(log.severity === "error");
  title.textContent = log.event;
  meta.textContent = `${log.severity} · ${new Date(log.occurredAt).toLocaleString()}`;
  detail.textContent = JSON.stringify(log.details || {});
  item.append(title, meta, detail);
  return item;
}

async function buildDiagnosticsPayload(options = {}) {
  updateSelectedRuleFromEditor();
  const includeLogs = options.includeLogs !== false;
  const [storageResult, dynamicRules, logs] = await Promise.all([
    chrome.storage.local.get({ [STORAGE_KEYS.applyError]: null }),
    chrome.declarativeNetRequest.getSessionRules().catch(() => []),
    includeLogs ? getDiagnosticLogs() : Promise.resolve([])
  ]);
  const manifest = chrome.runtime.getManifest();
  const statusCounts = rules.reduce((counts, rule) => {
    const status = getRuleStatus(rule).key;
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const enabledRules = rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({
      id: rule.id,
      name: rule.name || t("options.rules.unnamed"),
      status: getRuleStatus(rule).key,
      patternType: rule.patternType || PATTERN_TYPES.wildcard,
      credentialMode: rule.credentialMode || CREDENTIAL_MODES.manual
    }));

  return {
    app: manifest.name,
    version: manifest.version,
    generatedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    permissions: manifest.permissions || [],
    hostPermissions: manifest.host_permissions || [],
    summary: {
      totalRules: rules.length,
      savedRules: rules.filter((rule) => savedRuleIds.has(rule.id)).length,
      draftRules: rules.filter((rule) => !savedRuleIds.has(rule.id)).length,
      selectedRules: selectedRuleIds.size,
      enabledRules: rules.filter((rule) => rule.enabled).length,
      disabledRules: rules.filter((rule) => !rule.enabled).length,
      dynamicRuleCount: dynamicRules.length,
      statusCounts
    },
    enabledRules,
    lastApplyError: storageResult[STORAGE_KEYS.applyError] || null,
    logs
  };
}

async function copyDiagnostics() {
  try {
    const diagnostics = await buildDiagnosticsPayload({ includeLogs: true });
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    await appendDiagnosticLog("diagnostics_copied", "info", {
      logCount: diagnostics.logs.length
    });
    notify(t("options.toast.diagnosticsCopied"), "success");
  } catch (error) {
    notify(error.message || t("options.toast.diagnosticsCopyFailed"), "error");
  }
}

async function copyDiagnosticLogs() {
  try {
    const logs = await getDiagnosticLogs();
    await navigator.clipboard.writeText(JSON.stringify(logs, null, 2));
    await appendDiagnosticLog("diagnostic_logs_copied", "info", { logCount: logs.length });
    notify(t("options.diagnostics.logsCopied"), "success");
  } catch (error) {
    notify(error.message || t("options.diagnostics.logsCopyFailed"), "error");
  }
}

async function clearLogsFromDiagnostics() {
  await clearDiagnosticLogs();
  await renderDiagnosticsDialog();
  notify(t("options.diagnostics.logsCleared"), "success");
}

function closeDiagnosticsDialog() {
  diagnosticsDialog.close();
  diagnosticsStats.replaceChildren();
  diagnosticsErrors.replaceChildren();
  diagnosticsLogs.replaceChildren();
}

function hasExportableCredentials(rulesToExport = []) {
  return rulesToExport.some((rule) => Boolean(
    rule.authorization ||
    normalizeExportHeaders(rule.headers).length > 0 ||
    normalizeExportHeaders(rule.syncedHeaders).length > 0 ||
    rule.syncedAuthorization ||
    rule.syncedCookieHeader
  ));
}

function normalizeExportHeaders(headers = []) {
  return Array.isArray(headers)
    ? headers.filter((header) => header?.name || header?.value)
    : [];
}

async function importRules(file) {
  if (!file) {
    return;
  }

  try {
    const parsedData = JSON.parse(await file.text());
    const fileVersion = Number(parsedData?.version || 1);
    const importedRules = Array.isArray(parsedData) ? parsedData : parsedData.rules;
    const draftRules = Array.isArray(importedRules)
      ? importedRules
        .map((rule) => migrateImportedRule(rule, fileVersion))
        .map(normalizeImportedRule)
        .filter(Boolean)
      : [];

    if (draftRules.length === 0) {
      throw new Error(t("options.import.noValidRules"));
    }

    pendingImport = createImportPreview(draftRules, importedRules, fileVersion);
    renderImportDialog();
    importDialog.showModal();
  } catch (error) {
    notify(error.message, "error");
  } finally {
    importRulesFile.value = "";
  }
}

function createImportPreview(importedRules, rawRules, fileVersion) {
  const migratedRules = Array.isArray(rawRules)
    ? rawRules.map((rule) => migrateImportedRule(rule, fileVersion)).filter(Boolean)
    : [];
  const importedRuleDetails = importedRules.map((rule, index) => ({
    rule,
    originalId: migratedRules[index]?.id || "",
    validationMessages: getRuleValidationMessages(rule),
    hasSensitiveData: hasExportableCredentials([rule])
  }));
  const existingRules = getPersistedRulesFromMemory();
  const duplicateSummary = getImportDuplicateSummary(importedRuleDetails, existingRules);
  const candidateRules = [...existingRules, ...importedRules];
  const issuesByRuleId = getRuleSetIssuesByRuleId(candidateRules);

  importedRuleDetails.forEach((detail) => {
    detail.issue = issuesByRuleId.get(detail.rule.id) || "";
    detail.isInvalid = detail.validationMessages.length > 0;
    detail.isDuplicate = duplicateSummary.ruleIds.has(detail.rule.id);
    detail.hasIssue = detail.isInvalid || detail.issue || detail.isDuplicate;
  });

  return {
    fileVersion,
    importedRuleDetails,
    duplicateSummary,
    hasSensitiveData: importedRuleDetails.some((detail) => detail.hasSensitiveData)
  };
}

function getImportDuplicateSummary(importedRuleDetails, existingRules) {
  const ruleIds = new Set();
  const counts = {
    id: 0,
    name: 0,
    source: 0,
    target: 0,
    route: 0
  };
  const importedRules = importedRuleDetails.map((detail) => detail.rule);
  const existingOriginalIds = new Set(existingRules.map((rule) => rule.id));
  const existingSignatures = buildImportSignatureMaps(existingRules);
  const importedSignatures = buildImportSignatureMaps([]);

  importedRuleDetails.forEach((detail) => {
    const { rule, originalId } = detail;
    const signatures = getImportRuleSignatures(rule);
    const duplicateTypes = new Set();

    if (originalId && existingOriginalIds.has(originalId)) {
      duplicateTypes.add("id");
    }

    Object.entries(signatures).forEach(([type, signature]) => {
      if (!signature) {
        return;
      }

      if (existingSignatures[type].has(signature) || importedSignatures[type].has(signature)) {
        duplicateTypes.add(type);
      }

      importedSignatures[type].add(signature);
    });

    duplicateTypes.forEach((type) => {
      counts[type] += 1;
      ruleIds.add(rule.id);
    });
  });

  return {
    ruleIds,
    counts,
    total: importedRules.filter((rule) => ruleIds.has(rule.id)).length
  };
}

function buildImportSignatureMaps(sourceRules) {
  const maps = {
    name: new Set(),
    source: new Set(),
    target: new Set(),
    route: new Set()
  };

  sourceRules.forEach((rule) => {
    const signatures = getImportRuleSignatures(rule);
    Object.entries(signatures).forEach(([type, signature]) => {
      if (signature) {
        maps[type].add(signature);
      }
    });
  });

  return maps;
}

function getImportRuleSignatures(rule) {
  const patternType = rule.patternType || PATTERN_TYPES.wildcard;
  const source = normalizeImportSignatureValue(rule.sourcePattern);
  const target = normalizeImportSignatureValue(rule.targetUrl);

  return {
    name: normalizeImportSignatureValue(rule.name),
    source: source ? `${patternType}:${source}` : "",
    target: target ? `${patternType}:${target}` : "",
    route: source && target ? `${patternType}:${source}->${target}` : ""
  };
}

function normalizeImportSignatureValue(value) {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function renderImportDialog() {
  if (!pendingImport) {
    return;
  }

  const details = pendingImport.importedRuleDetails;
  const invalidCount = details.filter((detail) => detail.isInvalid).length;
  const conflictCount = details.filter((detail) => detail.issue).length;
  const sensitiveCount = details.filter((detail) => detail.hasSensitiveData).length;

  importStats.replaceChildren(...[
    createImportStat(t("options.import.stat.total"), details.length),
    createImportStat(t("options.import.stat.valid"), details.length - invalidCount),
    createImportStat(t("options.import.stat.invalid"), invalidCount),
    createImportStat(t("options.import.stat.conflicts"), conflictCount),
    createImportStat(t("options.import.stat.duplicates"), pendingImport.duplicateSummary.total),
    createImportStat(t("options.import.stat.sensitive"), sensitiveCount)
  ]);

  const warnings = [];
  if (pendingImport.hasSensitiveData) {
    warnings.push(t("options.import.warning.sensitive"));
  }
  if (conflictCount > 0 || pendingImport.duplicateSummary.total > 0) {
    warnings.push(t("options.import.warning.conflicts"));
  }

  importWarnings.replaceChildren(...warnings.map((warning) => {
    const item = document.createElement("p");
    item.textContent = warning;
    return item;
  }));

  importRulePreview.replaceChildren(...details.slice(0, 12).map(renderImportPreviewRule));
  if (details.length > 12) {
    const overflow = document.createElement("p");
    overflow.className = "import-rule-preview__overflow";
    overflow.textContent = t("options.import.preview.more", { count: details.length - 12 });
    importRulePreview.append(overflow);
  }
}

function createImportStat(label, value) {
  const item = document.createElement("div");
  const valueElement = document.createElement("strong");
  const labelElement = document.createElement("span");

  valueElement.textContent = String(value);
  labelElement.textContent = label;
  item.append(valueElement, labelElement);
  return item;
}

function renderImportPreviewRule(detail) {
  const item = document.createElement("div");
  const name = document.createElement("strong");
  const meta = document.createElement("span");
  const issue = document.createElement("small");

  item.className = "import-preview-rule";
  item.dataset.issue = String(detail.hasIssue);
  name.textContent = detail.rule.name || t("options.rules.unnamed");
  meta.textContent = `${detail.rule.patternType || PATTERN_TYPES.wildcard} · ${detail.rule.credentialMode || CREDENTIAL_MODES.manual}`;
  issue.textContent = getImportRulePreviewIssue(detail);
  item.append(name, meta, issue);
  return item;
}

function getImportRulePreviewIssue(detail) {
  if (detail.isInvalid) {
    return detail.validationMessages.map((validation) => validation.message).join(" ");
  }

  if (detail.issue) {
    return detail.issue;
  }

  if (detail.isDuplicate) {
    return t("options.import.preview.duplicate");
  }

  if (detail.hasSensitiveData) {
    return t("options.import.preview.sensitive");
  }

  return t("common.ready");
}

async function applyPendingImport() {
  if (!pendingImport) {
    return;
  }

  try {
    importApply.disabled = true;
    const mode = importMode.value || IMPORT_MODES.draft;
    const conflictMode = importConflictMode.value || IMPORT_CONFLICT_MODES.draft;
    const result = await buildImportResult(mode, conflictMode);
    const appliedRules = result.savedRules ? await saveRules(result.savedRules) : null;

    if (appliedRules) {
      savedRuleIds = new Set(appliedRules.map((rule) => rule.id));
      rules = mergePersistedRulesWithDrafts(appliedRules, {
        committedRuleIds: new Set(result.savedImportIds)
      });
    }

    if (result.draftRules.length > 0) {
      rules = [...result.draftRules, ...rules];
      selectedRuleIds = new Set(result.draftRules.map((rule) => rule.id));
      selectedRuleId = result.draftRules[0].id;
    } else if (result.savedImportIds.length > 0) {
      selectedRuleIds = new Set(result.savedImportIds);
      selectedRuleId = result.savedImportIds[0];
    }

    render();
    notify(t("options.import.report", {
      draft: result.draftRules.length,
      saved: result.savedImportIds.length,
      skipped: result.skippedCount,
      noun: result.draftRules.length + result.savedImportIds.length === 1 ? t("common.rule") : t("common.rules")
    }), "success");
    await appendDiagnosticLog("import_applied", "info", {
      mode,
      conflictMode,
      draftCount: result.draftRules.length,
      savedCount: result.savedImportIds.length,
      skippedCount: result.skippedCount
    });
    closeImportDialog();
  } catch (error) {
    notify(error.message || t("runtime.error.apply"), "error");
  } finally {
    importApply.disabled = false;
  }
}

async function buildImportResult(mode, conflictMode) {
  const existingRules = getPersistedRulesFromMemory();
  const importDetails = pendingImport.importedRuleDetails;
  const draftRules = [];
  const saveCandidates = [];
  let skippedCount = 0;
  let baseRules = mode === IMPORT_MODES.replace ? [] : existingRules;

  importDetails.forEach((detail) => {
    const rule = detail.rule;
    const shouldHandleAsIssue = detail.hasIssue;

    if (detail.isInvalid && mode !== IMPORT_MODES.draft) {
      if (conflictMode === IMPORT_CONFLICT_MODES.skip) {
        skippedCount += 1;
      } else {
        draftRules.push(rule);
      }
      return;
    }

    if (shouldHandleAsIssue && conflictMode === IMPORT_CONFLICT_MODES.skip) {
      skippedCount += 1;
      return;
    }

    if (shouldHandleAsIssue && conflictMode === IMPORT_CONFLICT_MODES.draft) {
      draftRules.push(rule);
      return;
    }

    let nextRule = rule;
    if (shouldHandleAsIssue && conflictMode === IMPORT_CONFLICT_MODES.disable) {
      nextRule = { ...rule, enabled: false };
    }

    if (conflictMode === IMPORT_CONFLICT_MODES.replace || mode === IMPORT_MODES.replace) {
      baseRules = removeMatchingImportRules(baseRules, nextRule);
    }

    if (mode === IMPORT_MODES.draft) {
      draftRules.push(nextRule);
      return;
    }

    saveCandidates.push(nextRule);
  });

  if (mode === IMPORT_MODES.draft) {
    return {
      draftRules,
      savedRules: null,
      savedImportIds: [],
      skippedCount
    };
  }

  const savedRules = [...saveCandidates, ...baseRules];

  return {
    draftRules,
    savedRules,
    savedImportIds: saveCandidates.map((rule) => rule.id),
    skippedCount
  };
}

function removeMatchingImportRules(sourceRules, importedRule) {
  const importedSignatures = getImportRuleSignatures(importedRule);

  return sourceRules.filter((rule) => {
    const signatures = getImportRuleSignatures(rule);
    return !(
      signatures.name === importedSignatures.name ||
      signatures.source === importedSignatures.source ||
      signatures.target === importedSignatures.target ||
      signatures.route === importedSignatures.route
    );
  });
}

function closeImportDialog() {
  pendingImport = null;
  importDialog.close();
  importStats.replaceChildren();
  importWarnings.replaceChildren();
  importRulePreview.replaceChildren();
}

function touchSelectedRule() {
  const modifiedAt = new Date().toISOString();
  rules = rules.map((rule) => rule.id === selectedRuleId ? { ...rule, modifiedAt } : rule);
}

function addDraftRule() {
  updateSelectedRuleFromEditor();
  const blankRule = createBlankRule();
  rules = [blankRule, ...rules];
  selectedRuleId = blankRule.id;
  selectedRuleIds = new Set([blankRule.id]);
  render();
  notify(t("options.toast.ruleAdded"));
}

addRuleButton.addEventListener("click", addDraftRule);

selectVisibleRules.addEventListener("change", () => {
  const visibleRules = getFilteredRules();

  if (selectVisibleRules.checked) {
    visibleRules.forEach((rule) => selectedRuleIds.add(rule.id));
  } else {
    visibleRules.forEach((rule) => selectedRuleIds.delete(rule.id));
  }

  renderRuleList();
});

bulkEnable.addEventListener("click", async () => {
  await updateSelectedRules((rule) => ({ ...rule, enabled: true }), t("options.toast.selectedEnabled"));
});

bulkDisable.addEventListener("click", async () => {
  await updateSelectedRules((rule) => ({ ...rule, enabled: false }), t("options.toast.selectedDisabled"));
});

bulkMoveGroup.addEventListener("click", async () => {
  const group = bulkGroupName.value.trim();

  await updateSelectedRules((rule) => ({ ...rule, group }), t("options.toast.selectedMoved"));
});

bulkDuplicate.addEventListener("click", duplicateSelectedRules);
bulkExport.addEventListener("click", exportRules);
copyDiagnosticsButton.addEventListener("click", openDiagnostics);
bulkRemove.addEventListener("click", removeSelectedRules);

importRulesButton.addEventListener("click", () => {
  importRulesFile.click();
});

importApply.addEventListener("click", applyPendingImport);
importCancel.addEventListener("click", closeImportDialog);
importClose.addEventListener("click", closeImportDialog);
importMode.addEventListener("change", renderImportDialog);
importConflictMode.addEventListener("change", renderImportDialog);
exportCancel.addEventListener("click", closeExportDialog);
exportClose.addEventListener("click", closeExportDialog);
exportCopy.addEventListener("click", copyPendingExportJson);
exportDownload.addEventListener("click", downloadPendingExport);
exportScope.addEventListener("change", renderExportDialog);
exportCredentialMode.addEventListener("change", renderExportDialog);
exportGroup.addEventListener("change", renderExportDialog);
diagnosticsCloseTop.addEventListener("click", closeDiagnosticsDialog);
diagnosticsClose.addEventListener("click", closeDiagnosticsDialog);
diagnosticsCopy.addEventListener("click", copyDiagnostics);
diagnosticsCopyLogs.addEventListener("click", copyDiagnosticLogs);
diagnosticsClearLogs.addEventListener("click", clearLogsFromDiagnostics);

importRulesFile.addEventListener("change", async () => {
  await importRules(importRulesFile.files[0]);
});

[ruleSearch, statusFilter, groupFilter, credentialFilter].forEach((control) => {
  control.addEventListener("input", renderRuleList);
  control.addEventListener("change", renderRuleList);
});

toggleRuleControls.addEventListener("click", () => {
  const isHidden = ruleListControls.hidden;

  ruleListControls.hidden = !isHidden;
  toggleRuleControls.setAttribute("aria-expanded", String(isHidden));
  filterToggleLabel.textContent = t(isHidden ? "options.actions.hideFilters" : "options.actions.showFilters");
  toggleRuleControls.title = t(isHidden ? "options.actions.hideFilters" : "options.actions.showFilters");
  filterToggleStateIcon.src = isHidden
    ? getThemedIconPath("icons8-eye-close-32.png")
    : getThemedIconPath("icons8-eye-32.png");
  filterToggleStateIcon.dataset.icon = isHidden ? "icons8-eye-close-32.png" : "icons8-eye-32.png";
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (!isSavingRulesToStorage && changes[STORAGE_KEYS.applyError]?.newValue?.message) {
    notify(changes[STORAGE_KEYS.applyError].newValue.message, "error");
  }

  if (changes[STORAGE_KEYS.rules]) {
    const persistedRules = Array.isArray(changes[STORAGE_KEYS.rules].newValue)
      ? changes[STORAGE_KEYS.rules].newValue
      : [];
    const persistedRulesSignature = getRulesSignature(persistedRules);

    if (isSavingRulesToStorage || pendingSavedRulesSignatures.has(persistedRulesSignature)) {
      pendingSavedRulesSignatures.delete(persistedRulesSignature);
      return;
    }

    savedRuleIds = new Set(persistedRules.map((rule) => rule.id));
    rules = mergePersistedRulesWithDrafts(persistedRules);
    selectedRuleId = rules.some((rule) => rule.id === selectedRuleId) ? selectedRuleId : "";
    render();
  }
});

render();
