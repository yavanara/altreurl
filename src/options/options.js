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
  isWaitingForSyncCapture,
  buildSourceMatcher
} from "../shared/rules.js";
import {
  parseCurlCommand,
  suggestPatterns,
  detectCredentials,
  parseSwaggerSpec,
  escapeRegex
} from "../shared/generator.js";
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
const initialRules = await getRedirectRules();
let persistedRulesCache = initialRules.map(rule => ({ ...rule }));
let rules = initialRules;
let selectedRuleId = "";
let isSavingRule = false;
let isRemovingRule = false;
let isUpdatingSelectedRules = false;
let isSavingRulesToStorage = false;
let pendingImport = null;
let pendingExport = null;
let pendingSavedRulesSignatures = new Set();
let savedRuleIds = new Set(rules.map((rule) => rule.id));
let selectedRuleIds = new Set();
const BACKGROUND_SYNC_FIELDS = [
  "syncedHeaders",
  "syncedAuthorization",
  "syncedCookieHeader",
  "lastSyncedAt",
  "incognitoSyncedHeaders",
  "incognitoSyncedAuthorization",
  "incognitoSyncedCookieHeader",
  "incognitoLastSyncedAt"
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
  return !savedRuleIds.has(rule.id);
}

function isDirtyRule(rule) {
  if (!savedRuleIds.has(rule.id)) {
    return false;
  }
  const persistedRule = persistedRulesCache.find((r) => r.id === rule.id);
  if (!persistedRule) {
    return true;
  }

  const fieldsToCompare = [
    'name', 'group', 'enabled', 'patternType', 'credentialMode', 
    'syncHeaders', 'syncAuthorization', 'syncCookies', 'credentialSource', 
    'storageArea', 'authorizationKey', 'authorizationPrefix', 'headersKey', 
    'cookieNames', 'sourcePattern', 'targetUrl', 'authorization'
  ];

  const serializeFields = (r) => {
    const obj = {};
    fieldsToCompare.forEach((f) => obj[f] = r[f]);
    obj.headers = Array.isArray(r.headers) ? [...r.headers].map(h => ({...h})) : [];
    obj.cookies = Array.isArray(r.cookies) ? [...r.cookies].map(c => ({...c})) : [];
    return JSON.stringify(obj);
  };

  const a = normalizeRuleCredentialCapabilities(rule);
  const b = normalizeRuleCredentialCapabilities(persistedRule);
  return serializeFields(a) !== serializeFields(b);
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
  const now = timestampNow();

  return {
    ...blankRule,
    ...rule,
    id: createRuleId(),
    createdAt: now,
    modifiedAt: now,
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

    if (rule._importVersion) {
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

    return { 
      key: "draft", 
      htmlLabel: `<span class="draft-tag">${t("common.draft")}</span>` 
    };
  }

  if (isDirtyRule(rule)) {
    return { 
      key: "unsaved", 
      htmlLabel: `<span class="draft-tag">${t("common.unsavedChanges")}</span>` 
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
      storageArea: card.querySelector('input[name="storageArea"]:checked')?.value || STORAGE_AREAS.localStorage,
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
      const isUnsaved = ruleStatus.key === "unsaved";
      const isDraft = ruleStatus.key.startsWith("draft");
      const matchesStatus = status === "all" ||
        ruleStatus.key === status ||
        (status === "draft" && isDraft) ||
        (status === "unsaved" && isUnsaved) ||
        (status === "enabled" && rule.enabled && !isDraft && !isUnsaved);
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
  const storageRadio = card.querySelector(`input[name="storageArea"][value="${rule.storageArea || STORAGE_AREAS.localStorage}"]`);
  if (storageRadio) storageRadio.checked = true;
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
      response = await Promise.race([
        chrome.runtime.sendMessage({
          type: "SAVE_RULES",
          rules: rulesToSave
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(t("runtime.error.timeout"))), 30000)
        )
      ]);
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

    persistedRulesCache = appliedRules.map(rule => ({ ...rule }));
    savedRuleIds = new Set(appliedRules.map((rule) => rule.id));
    rules = mergePersistedRulesWithDrafts(appliedRules, { committedRuleIds: new Set([selectedRule.id]) });
    render();
    notify(t("options.toast.ruleSaved"), "success");
  } catch (error) {
    notify(error.message, "error");
  } finally {
    isSavingRule = false;
    // Query fresh DOM — render() may have replaced the original saveButton node
    const freshSaveButton = editorPanel.querySelector('[data-action="saveRule"]');
    if (freshSaveButton) {
      freshSaveButton.disabled = false;
      const freshLabel = freshSaveButton.querySelector('[data-role="saveRuleLabel"]');
      if (freshLabel) freshLabel.textContent = t("options.actions.saveRule");
    }
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

  persistedRulesCache = appliedRules.map(rule => ({ ...rule }));
  savedRuleIds = new Set(appliedRules.map((rule) => rule.id));
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
  meta.textContent = `${status.label || t(`common.${status.key}`) || status.key} · ${rule.patternType || PATTERN_TYPES.wildcard} · ${rule.credentialMode || CREDENTIAL_MODES.manual}`;
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
  selectedRuleIds = new Set([...selectedRuleIds, blankRule.id]);
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

    persistedRulesCache = persistedRules.map(rule => ({ ...rule }));
    savedRuleIds = new Set(persistedRules.map((rule) => rule.id));
    rules = mergePersistedRulesWithDrafts(persistedRules);
    selectedRuleId = rules.some((rule) => rule.id === selectedRuleId) ? selectedRuleId : "";
    render();
  }
});

/* ==========================================
   Generate Rule Feature Logic
   ========================================== */
let generateActiveTab = "curl"; // curl, url, tabs, swagger
let generateParsedCandidates = []; // Array of rule candidates
let generateSingleUrlSelectedPattern = null; // Single url selected suggestion { type, pattern }
let generateDetectedCredentials = null; // Detected auth/cookies
let currentSwaggerSpec = null; // Parsed Swagger JSON Spec

// DOM Bindings
const generateRuleBtn = document.querySelector("#generateRule");
const generateRuleDialog = document.querySelector("#generateRuleDialog");
const generateCancelTop = document.querySelector("#generateCancelTop");
const generateCancel = document.querySelector("#generateCancel");
const generateSaveDraft = document.querySelector("#generateSaveDraft");
const generateSaveEnable = document.querySelector("#generateSaveEnable");

const generateTabBtns = document.querySelectorAll(".generate-tab-btn");
const generateTabContents = document.querySelectorAll(".generate-tab-content");

const generateCurlInput = document.querySelector("#generateCurlInput");
const generateUrlInput = document.querySelector("#generateUrlInput");
const generateUrlPatterns = document.querySelector("#generateUrlPatterns");
const generateUrlPatternsList = document.querySelector("#generateUrlPatternsList");
const generateTabsList = document.querySelector("#generateTabsList");
const generateSwaggerFile = document.querySelector("#generateSwaggerFile");
const generateSwaggerUrl = document.querySelector("#generateSwaggerUrl");
const btnLoadSwaggerUrl = document.querySelector("#btnLoadSwaggerUrl");

const swaggerEndpointsContainer = document.querySelector("#swaggerEndpointsContainer");
const swaggerEndpointsBody = document.querySelector("#swaggerEndpointsBody");
const swaggerEndpointSearch = document.querySelector("#swaggerEndpointSearch");
const swaggerSelectAll = document.querySelector("#swaggerSelectAll");
const swaggerDeselectAll = document.querySelector("#swaggerDeselectAll");
const swaggerHeaderSelectAll = document.querySelector("#swaggerHeaderSelectAll");

const generateBaseProdUrl = document.querySelector("#generateBaseProdUrl");
const generateRedirectUrl = document.querySelector("#generateRedirectUrl");
const generateRedirectHistories = document.querySelector("#generateRedirectHistories");
const generateGlobalGroup = document.querySelector("#generateGlobalGroup");
const generatePatternStyle = document.querySelector("#generatePatternStyle");
const generatePatternStyleContainer = document.querySelector("#generatePatternStyleContainer");
const generateBaseOn = document.querySelector("#generateBaseOn");
const generateBaseOnContainer = document.querySelector("#generateBaseOnContainer");
const generateProdUrlHistories = document.querySelector("#generateProdUrlHistories");

const generateCredentialsWarning = document.querySelector("#generateCredentialsWarning");
const generateCredentialsWarningMsg = document.querySelector("#generateCredentialsWarningMsg");
const generateSyncAuthCheckbox = document.querySelector("#generateSyncAuthCheckbox");
const generateSyncCookieCheckbox = document.querySelector("#generateSyncCookieCheckbox");

const generatePlaygroundInput = document.querySelector("#generatePlaygroundInput");
const generatePlaygroundStatus = document.querySelector("#generatePlaygroundStatus");
const generatePlaygroundRedirectResult = document.querySelector("#generatePlaygroundRedirectResult");
const generateRuleStatsMsg = document.querySelector("#generateRuleStatsMsg");

// 1. Initialize Tabs navigation
generateTabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    generateActiveTab = btn.dataset.tab;
    generateTabBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
    generateTabContents.forEach((c) => c.classList.toggle("is-active", c.dataset.tabContent === generateActiveTab));
    
    // Toggle global configs visibility based on active tab
    generatePatternStyleContainer.hidden = generateActiveTab !== "swagger";
    generateBaseOnContainer.hidden = generateActiveTab !== "swagger" || (document.querySelector('input[name="generatePatternStyleMode"]:checked')?.value || 'specific') !== 'simple';
    
    if (generateActiveTab === "tabs") {
      loadActiveBrowserTabs();
    }
    
    refreshGenerateState();
  });
});

// 2. Open / Close dialog
if (generateRuleBtn) {
  generateRuleBtn.addEventListener("click", () => {
    generateRuleDialog.showModal();
    // Default open tabs query if tabs chosen
    if (generateActiveTab === "tabs") {
      loadActiveBrowserTabs();
    }
    // Initialize presets history
    initializeLocalPresetsHistory();
    initializeProdUrlHistory();
    refreshGenerateState();
  });
}

function closeGenerateDialog() {
  generateRuleDialog.close();
  // Reset states
  generateCurlInput.value = "";
  generateUrlInput.value = "";
  generateSwaggerFile.value = "";
  generateSwaggerUrl.value = "";
  swaggerEndpointSearch.value = "";
  generatePlaygroundInput.value = "";
  generateParsedCandidates = [];
  generateSingleUrlSelectedPattern = null;
  generateDetectedCredentials = null;
  currentSwaggerSpec = null;
  swaggerEndpointsContainer.hidden = true;
  generateUrlPatterns.hidden = true;
  generateCredentialsWarning.hidden = true;
}

[generateCancel, generateCancelTop].forEach((btn) => {
  if (btn) btn.addEventListener("click", closeGenerateDialog);
});

// Presets mapping
if (generateRedirectHistories) {
  generateRedirectHistories.addEventListener("change", () => {
    if (generateRedirectHistories.value) {
      generateRedirectUrl.value = generateRedirectHistories.value;
      generateRedirectHistories.value = ""; // Reset dropdown to placeholder option "History..."
      generateRedirectUrl.dispatchEvent(new Event("input"));
    }
  });
}

[generateBaseProdUrl, generateRedirectUrl, generateGlobalGroup].forEach((ctrl) => {
  if (ctrl) {
    ctrl.addEventListener("input", () => refreshGenerateState(false));
    ctrl.addEventListener("change", () => refreshGenerateState(false));
  }
});

if (generatePatternStyle) {
  generatePatternStyle.addEventListener("change", () => {
    generateBaseOnContainer.hidden = (document.querySelector('input[name="generatePatternStyleMode"]:checked')?.value || 'specific') !== 'simple';
    if (generateActiveTab === "swagger") {
      refreshGenerateState();
    }
  });
}

if (generateBaseOn) {
  generateBaseOn.addEventListener("change", () => {
    if (generateActiveTab === "swagger") {
      refreshGenerateState();
    }
  });
}

if (generateProdUrlHistories) {
  generateProdUrlHistories.addEventListener("change", () => {
    if (generateProdUrlHistories.value) {
      generateBaseProdUrl.value = generateProdUrlHistories.value;
      generateProdUrlHistories.value = ""; // Reset dropdown
      if (generateActiveTab === "swagger") refreshGenerateState();
    }
  });
}

// cURL Parsing listener
if (generateCurlInput) {
  generateCurlInput.addEventListener("input", () => {
    const curl = generateCurlInput.value.trim();
    if (!curl) {
      generateParsedCandidates = [];
      generateDetectedCredentials = null;
      refreshGenerateState();
      return;
    }
    
    const parsed = parseCurlCommand(curl);
    if (parsed) {
      // Auto populate prod host if empty
      try {
        const u = new URL(parsed.url);
        if (!generateBaseProdUrl.value) {
          generateBaseProdUrl.value = u.origin;
        }
      } catch(e) {}
      
      // Detect credentials
      generateDetectedCredentials = detectCredentials(parsed.headers);
      
      // Candidate base
      const pathname = getUrlPathname(parsed.url);
      const host = getUrlHost(parsed.url);
      const baseProd = generateBaseProdUrl.value || `${parsed.url.split('://')[0]}://${host}`;
      const baseLocal = generateRedirectUrl.value || "http://localhost:5000";
      
      const sourcePattern = `*://${host}${pathname}*`;
      const targetUrl = `${baseLocal}${pathname}`;
      const ruleName = `[cURL] ${pathname || '/'}`;
      const groupName = generateGlobalGroup.value.trim() || host;
      
      generateParsedCandidates = [{
        name: ruleName,
        group: groupName,
        patternType: "wildcard",
        sourcePattern,
        targetUrl,
        selected: true,
        method: parsed.method,
        headers: parsed.headers
      }];
    } else {
      generateParsedCandidates = [];
      generateDetectedCredentials = null;
    }
    refreshGenerateState();
  });
}

// Single URL Parsing listener
if (generateUrlInput) {
  generateUrlInput.addEventListener("input", () => {
    const urlVal = generateUrlInput.value.trim();
    if (!urlVal) {
      generateParsedCandidates = [];
      generateSingleUrlSelectedPattern = null;
      refreshGenerateState();
      return;
    }
    
    const suggestions = suggestPatterns(urlVal);
    if (suggestions.length > 0) {
      try {
        const u = new URL(urlVal.startsWith("http") ? urlVal : "https://" + urlVal);
        if (!generateBaseProdUrl.value) {
          generateBaseProdUrl.value = u.origin;
        }
      } catch(e) {}
      
      // If we don't have a selected pattern yet, select the second one (wildcard path) or first
      if (!generateSingleUrlSelectedPattern) {
        generateSingleUrlSelectedPattern = suggestions[1] || suggestions[0];
      }
      
      // Populate candidates
      buildSingleUrlCandidate(urlVal);
    } else {
      generateParsedCandidates = [];
      generateSingleUrlSelectedPattern = null;
    }
    refreshGenerateState();
  });
}

function buildSingleUrlCandidate(urlVal) {
  if (!generateSingleUrlSelectedPattern) return;
  
  const pathname = getUrlPathname(urlVal);
  const host = getUrlHost(urlVal);
  const baseLocal = generateRedirectUrl.value || "http://localhost:5000";
  
  const sourcePattern = generateSingleUrlSelectedPattern.pattern;
  // If Regex, convert target as well
  let targetUrl = `${baseLocal}${pathname}`;
  let patternType = "wildcard";
  
  if (generateSingleUrlSelectedPattern.type === "regex_dynamic") {
    patternType = "regex";
    // For single dynamic URL, suggest group replacement if path matched: e.g. replacing /users/123/profile -> /users/$1/profile
    const segments = pathname.split("/");
    let groupCount = 0;
    const substSegments = segments.map((seg) => {
      const isNumeric = /^\d+$/.test(seg);
      const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(seg);
      if (seg && (isNumeric || isUuid)) {
        groupCount++;
        return `$${groupCount}`;
      }
      return seg;
    });
    targetUrl = `${baseLocal}${substSegments.join("/")}`;
  }
  
  generateParsedCandidates = [{
    name: `[Quick URL] ${pathname || '/'}`,
    group: generateGlobalGroup.value.trim() || host,
    patternType,
    sourcePattern,
    targetUrl,
    selected: true
  }];
}

// Active Tabs loader
async function loadActiveBrowserTabs() {
  if (typeof chrome === "undefined" || !chrome.tabs) {
    generateTabsList.innerHTML = `<div class="chrome-tab-item"><div class="chrome-tab-title">Chrome tabs API not available</div></div>`;
    return;
  }
  
  try {
    const tabs = await chrome.tabs.query({ windowType: "normal" });
    if (tabs.length === 0) {
      generateTabsList.innerHTML = `<div class="chrome-tab-item"><div class="chrome-tab-title">No active tabs found</div></div>`;
      return;
    }
    
    generateTabsList.replaceChildren(...tabs.filter(t => t.url && t.url.startsWith("http")).map((tab) => {
      const item = document.createElement("div");
      item.className = "chrome-tab-item";
      
      const fav = document.createElement("img");
      fav.src = tab.favIconUrl || "../shared/imgs/icons/b/icons8-book-32.png";
      fav.width = 16;
      fav.height = 16;
      
      const title = document.createElement("span");
      title.className = "chrome-tab-title";
      title.textContent = tab.title || "Untitled Tab";
      
      const url = document.createElement("span");
      url.className = "chrome-tab-url";
      url.textContent = tab.url;
      
      item.appendChild(fav);
      item.appendChild(title);
      item.appendChild(url);
      
      item.addEventListener("click", () => {
        // Populate quick URL tab instead!
        generateUrlInput.value = tab.url;
        generateActiveTab = "url";
        
        // Toggle tabs
        generateTabBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.tab === "url"));
        generateTabContents.forEach((c) => c.classList.toggle("is-active", c.dataset.tabContent === "url"));
        
        // Trigger quick URL listener logic
        generateUrlInput.dispatchEvent(new Event("input"));
      });
      
      return item;
    }));
  } catch(err) {
    generateTabsList.innerHTML = `<div class="chrome-tab-item"><div class="chrome-tab-title">Error querying tabs: ${err.message}</div></div>`;
  }
}

// Swagger listeners
if (generateSwaggerFile) {
  generateSwaggerFile.addEventListener("change", async () => {
    const file = generateSwaggerFile.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const spec = JSON.parse(e.target.result);
        handleLoadedSwaggerSpec(spec);
      } catch (err) {
        notify(t("options.generator.swagger.invalidSpec", { message: err.message }), "error");
      }
    };
    reader.readAsText(file);
  });
}

if (btnLoadSwaggerUrl) {
  btnLoadSwaggerUrl.addEventListener("click", async () => {
    const url = generateSwaggerUrl.value.trim();
    if (!url) return;
    
    btnLoadSwaggerUrl.disabled = true;
    btnLoadSwaggerUrl.textContent = t("options.generator.swagger.loading");
    
    try {
      const res = await fetch(url);
      const spec = await res.json();
      handleLoadedSwaggerSpec(spec);
    } catch(err) {
      notify(t("options.generator.swagger.loadFailed", { message: err.message }), "error");
    } finally {
      btnLoadSwaggerUrl.disabled = false;
      btnLoadSwaggerUrl.textContent = t("options.generator.swagger.load");
    }
  });
}

function handleLoadedSwaggerSpec(spec) {
  currentSwaggerSpec = spec;
  
  // Set default group name based on spec title
  if (spec.info?.title) {
    generateGlobalGroup.value = spec.info.title.trim().replace(/\s+/g, "_").toLowerCase();
  }
  
  // Try to find the spec host/basePath or defaults
  if (spec.host) {
    const protocol = spec.schemes ? spec.schemes[0] + "://" : "https://";
    generateBaseProdUrl.value = protocol + spec.host;
  }
  
  // Generate candidates
  generateParsedCandidates = parseSwaggerSpec(
    currentSwaggerSpec,
    generateBaseProdUrl.value || "https://api.production.com",
    generateRedirectUrl.value || "http://localhost:5000",
    document.querySelector('input[name="generatePatternStyleMode"]:checked')?.value || 'specific',
    document.querySelector('input[name="generateBaseOnMode"]:checked')?.value || 'path'
  );
  
  // Mark all selected by default
  generateParsedCandidates.forEach(c => c.selected = true);
  
  swaggerEndpointsContainer.hidden = false;
  refreshGenerateState();
}

// Swagger endpoints actions
if (swaggerEndpointSearch) {
  swaggerEndpointSearch.addEventListener("input", renderSwaggerEndpointsTable);
}

function onCandidateSelectionChange() {
  updateFooterStats();
  renderGeneratedRulesPreview();
  updateGeneratePlayground();
}

if (swaggerSelectAll) {
  swaggerSelectAll.addEventListener("click", () => {
    generateParsedCandidates.forEach(c => c.selected = true);
    swaggerHeaderSelectAll.checked = true;
    renderSwaggerEndpointsTable();
    onCandidateSelectionChange();
  });
}

if (swaggerDeselectAll) {
  swaggerDeselectAll.addEventListener("click", () => {
    generateParsedCandidates.forEach(c => c.selected = false);
    swaggerHeaderSelectAll.checked = false;
    renderSwaggerEndpointsTable();
    onCandidateSelectionChange();
  });
}

if (swaggerHeaderSelectAll) {
  swaggerHeaderSelectAll.addEventListener("change", () => {
    const isChecked = swaggerHeaderSelectAll.checked;
    generateParsedCandidates.forEach(c => c.selected = isChecked);
    renderSwaggerEndpointsTable();
    onCandidateSelectionChange();
  });
}

// Render Swagger endpoints table inline
function renderSwaggerEndpointsTable() {
  const query = swaggerEndpointSearch.value.trim().toLowerCase();
  
  const filtered = generateParsedCandidates.filter((c) => {
    return !query || c.swaggerPath.toLowerCase().includes(query) || c.subgroup.toLowerCase().includes(query) || c.name.toLowerCase().includes(query);
  });
  
  swaggerEndpointsBody.innerHTML = "";
  
  if (filtered.length === 0) {
    swaggerEndpointsBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--muted);" data-i18n="common.noMatches">No matching endpoints found</td></tr>`;
    return;
  }
  
  filtered.forEach((candidate, index) => {
    const row = document.createElement("tr");
    
    // Checkbox col
    const selectTd = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = candidate.selected;
    checkbox.addEventListener("change", () => {
      candidate.selected = checkbox.checked;
      onCandidateSelectionChange();
    });
    selectTd.appendChild(checkbox);
    
    // Method col
    const methodTd = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "method-badge";
    badge.dataset.method = candidate.method;
    badge.textContent = candidate.method;
    methodTd.appendChild(badge);
    
    // Path / Subgroup col
    const pathTd = document.createElement("td");
    const container = document.createElement("div");
    container.className = "swagger-path-container";
    const pathText = document.createElement("span");
    pathText.className = "swagger-path-text";
    pathText.textContent = candidate.swaggerPath;
    const subgroupText = document.createElement("span");
    subgroupText.className = "swagger-subgroup-text";
    subgroupText.textContent = candidate.subgroup;
    container.appendChild(pathText);
    container.appendChild(subgroupText);
    pathTd.appendChild(container);
    
    // Edit Details col
    const editTd = document.createElement("td");
    const editFields = document.createElement("div");
    editFields.className = "swagger-edit-fields";
    
    // Name Row
    const nameRow = document.createElement("div");
    nameRow.className = "swagger-edit-row";
    const nameLabel = document.createElement("span");
    nameLabel.textContent = t("common.name") + ":";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "swagger-inline-input";
    nameInput.value = candidate.name;
    nameInput.addEventListener("input", () => {
      candidate.name = nameInput.value.trim();
      renderGeneratedRulesPreview();
      updateGeneratePlayground();
    });
    nameRow.appendChild(nameLabel);
    nameRow.appendChild(nameInput);
    
    // Group Row
    const groupRow = document.createElement("div");
    groupRow.className = "swagger-edit-row";
    const groupLabel = document.createElement("span");
    groupLabel.textContent = t("common.group") + ":";
    const groupInput = document.createElement("input");
    groupInput.type = "text";
    groupInput.className = "swagger-inline-input";
    groupInput.value = candidate.group;
    groupInput.addEventListener("input", () => {
      candidate.group = groupInput.value.trim();
      renderGeneratedRulesPreview();
    });
    groupRow.appendChild(groupLabel);
    groupRow.appendChild(groupInput);
    
    editFields.appendChild(nameRow);
    editFields.appendChild(groupRow);
    editTd.appendChild(editFields);
    
    // Style select col
    const styleTd = document.createElement("td");
    const select = document.createElement("select");
    select.className = "swagger-style-select";
    
    const optRegex = new Option(t("common.regex"), "regex");
    const optWild = new Option(t("common.wildcard"), "wildcard");
    select.appendChild(optRegex);
    select.appendChild(optWild);
    select.value = candidate.patternType === "regex" ? "regex" : "wildcard";
    
    select.addEventListener("change", () => {
      candidate.patternType = select.value;
      // Re-trigger rule parsing for this individual row based on the select pattern format
      rebuildSwaggerCandidate(candidate, select.value);
      renderGeneratedRulesPreview();
      updateGeneratePlayground();
    });
    styleTd.appendChild(select);
    
    row.appendChild(selectTd);
    row.appendChild(methodTd);
    row.appendChild(pathTd);
    row.appendChild(editTd);
    row.appendChild(styleTd);
    
    swaggerEndpointsBody.appendChild(row);
  });
}

function rebuildSwaggerCandidate(candidate, patternType) {
  if (!currentSwaggerSpec) return;
  // Re-generate this single rule candidate using custom pattern format
  const prodClean = (generateBaseProdUrl.value || "https://api.production.com").replace(/\/$/, "");
  const localClean = (generateRedirectUrl.value || "http://localhost:5000").replace(/\/$/, "");
  const prodHost = prodClean.replace(/^https?:\/\//, "");
  
  const pathKey = candidate.swaggerPath;
  const paramMatches = pathKey.match(/\{[^}]+\}/g) || [];
  const hasParams = paramMatches.length > 0;
  
  let sourcePattern = "";
  let targetUrl = "";
  
  if (patternType === "wildcard") {
    if (hasParams) {
      const firstParamIndex = pathKey.indexOf("{");
      const staticPart = pathKey.substring(0, firstParamIndex);
      sourcePattern = `*://${prodHost}${staticPart}*`;
      targetUrl = `${localClean}${staticPart}`;
    } else {
      sourcePattern = `*://${prodHost}${pathKey}*`;
      targetUrl = `${localClean}${pathKey}`;
    }
    candidate.patternType = "wildcard";
  } else {
    let regexPath = escapeRegex(pathKey);
    paramMatches.forEach((param) => {
      const escapedParam = escapeRegex(param);
      regexPath = regexPath.replace(escapedParam, "([^\\/]+)");
    });
    const escapedProdHost = escapeRegex(prodHost);
    sourcePattern = `^https?:\\/\\/${escapedProdHost}${regexPath}(?:\\?.*)?$`;
    
    let targetPath = pathKey;
    paramMatches.forEach((param, index) => {
      targetPath = targetPath.replace(param, `$${index + 1}`);
    });
    targetUrl = `${localClean}${targetPath}`;
    candidate.patternType = "regex";
  }
  
  candidate.sourcePattern = sourcePattern;
  candidate.targetUrl = targetUrl;
}

// General refresh and UI updates
function refreshGenerateState(rebuildTable = true) {
  // If Swagger active and we have specs loaded, re-generate candidates list if base urls changed
  if (generateActiveTab === "swagger" && currentSwaggerSpec) {
    const previousSelections = new Map(generateParsedCandidates.map(c => [c.swaggerPath + ":" + c.method, c.selected]));
    const previousNames = new Map(generateParsedCandidates.map(c => [c.swaggerPath + ":" + c.method, c.name]));
    const previousGroups = new Map(generateParsedCandidates.map(c => [c.swaggerPath + ":" + c.method, c.group]));
    const previousPatternTypes = new Map(generateParsedCandidates.map(c => [c.swaggerPath + ":" + c.method, c.patternType]));
    
    generateParsedCandidates = parseSwaggerSpec(
      currentSwaggerSpec,
      generateBaseProdUrl.value || "https://api.production.com",
      generateRedirectUrl.value || "http://localhost:5000",
      document.querySelector('input[name="generatePatternStyleMode"]:checked')?.value || 'specific',
      document.querySelector('input[name="generateBaseOnMode"]:checked')?.value || 'path'
    );
    
    // Restore state details and custom manual pattern styles
    generateParsedCandidates.forEach((c) => {
      const key = c.swaggerPath + ":" + c.method;
      
      // Bidirectional selection bridge between Simple (ALL) and Specific (GET/POST) modes
      if (previousSelections.has(key)) {
        c.selected = previousSelections.get(key);
      } else {
        if (c.method === "ALL") {
          let anySelected = false;
          for (const [prevKey, prevVal] of previousSelections.entries()) {
            if (prevKey.startsWith(c.swaggerPath + ":") && prevVal === true) {
              anySelected = true;
              break;
            }
          }
          c.selected = anySelected;
        } else {
          const simpleKey = c.swaggerPath + ":ALL";
          if (previousSelections.has(simpleKey)) {
            c.selected = previousSelections.get(simpleKey);
          }
        }
      }
      
      // Bidirectional name, group, and pattern format restoration
      let prevPatternType = null;
      let prevName = null;
      let prevGroup = null;

      if (previousPatternTypes.has(key)) {
        prevPatternType = previousPatternTypes.get(key);
      } else {
        for (const [pk, pv] of previousPatternTypes.entries()) {
          if (pk.startsWith(c.swaggerPath + ":")) {
            prevPatternType = pv;
            break;
          }
        }
      }

      if (previousNames.has(key)) {
        prevName = previousNames.get(key);
      } else {
        for (const [pk, pv] of previousNames.entries()) {
          if (pk.startsWith(c.swaggerPath + ":")) {
            prevName = pv;
            break;
          }
        }
      }

      if (previousGroups.has(key)) {
        prevGroup = previousGroups.get(key);
      } else {
        for (const [pk, pv] of previousGroups.entries()) {
          if (pk.startsWith(c.swaggerPath + ":")) {
            prevGroup = pv;
            break;
          }
        }
      }

      if (prevPatternType) {
        c.patternType = prevPatternType;
        rebuildSwaggerCandidate(c, c.patternType);
      }
      if (prevName) {
        c.name = prevName;
      }
      if (prevGroup) {
        c.group = prevGroup;
      }
    });
    
    if (rebuildTable) {
      renderSwaggerEndpointsTable();
    }
  }
  
  // If Quick URL active, render pattern lists
  if (generateActiveTab === "url") {
    renderQuickUrlSuggestions();
  }
  
  // Render credentials warning
  renderCredentialsWarningBlock();
  
  // Update Live matching result
  updateGeneratePlayground();
  
  // Render live Rule Preview cards
  renderGeneratedRulesPreview();
  
  // Update footer statistics
  updateFooterStats();
}

function renderQuickUrlSuggestions() {
  const urlVal = generateUrlInput.value.trim();
  if (!urlVal) {
    generateUrlPatterns.hidden = true;
    return;
  }
  
  const suggestions = suggestPatterns(urlVal);
  if (suggestions.length === 0) {
    generateUrlPatterns.hidden = true;
    return;
  }
  
  generateUrlPatterns.hidden = false;
  generateUrlPatternsList.replaceChildren(...suggestions.map((s) => {
    const card = document.createElement("div");
    card.className = "chrome-tab-item";
    if (generateSingleUrlSelectedPattern && generateSingleUrlSelectedPattern.type === s.type) {
      card.className += " is-active";
    }
    
    const title = document.createElement("span");
    title.className = "chrome-tab-title";
    title.style.fontFamily = "monospace";
    title.textContent = s.pattern;
    
    const desc = document.createElement("span");
    desc.className = "chrome-tab-url";
    desc.textContent = t(s.descriptionKey);
    
    card.appendChild(title);
    card.appendChild(desc);
    
    card.addEventListener("click", () => {
      generateSingleUrlSelectedPattern = s;
      buildSingleUrlCandidate(urlVal);
      refreshGenerateState();
    });
    
    return card;
  }));
}

function renderCredentialsWarningBlock() {
  if (generateActiveTab === "curl" && generateDetectedCredentials && (generateDetectedCredentials.hasAuth || generateDetectedCredentials.hasCookie)) {
    generateCredentialsWarning.hidden = false;
    
    let msg = "";
    if (generateDetectedCredentials.hasAuth && generateDetectedCredentials.hasCookie) {
      msg = t("options.generator.credentials.bothDetected");
    } else if (generateDetectedCredentials.hasAuth) {
      msg = t("options.generator.credentials.authDetected");
    } else {
      msg = t("options.generator.credentials.cookieDetected");
    }
    
    generateCredentialsWarningMsg.textContent = msg;
    generateSyncAuthCheckbox.parentElement.hidden = !generateDetectedCredentials.hasAuth;
    generateSyncCookieCheckbox.parentElement.hidden = !generateDetectedCredentials.hasCookie;
  } else {
    generateCredentialsWarning.hidden = true;
  }
}

function renderGeneratedRulesPreview() {
  const selected = generateParsedCandidates.filter(c => c.selected);
  const container = document.querySelector("#generateRulePreviewContainer");
  const list = document.querySelector("#generateRulePreviewList");
  
  if (!container || !list) return;
  
  if (selected.length === 0) {
    container.hidden = true;
    return;
  }
  
  container.hidden = false;
  list.innerHTML = "";
  
  selected.forEach((c) => {
    const card = document.createElement("div");
    card.className = "generate-preview-card";
    
    const name = document.createElement("strong");
    name.className = "generate-preview-card__name";
    name.textContent = c.name;
    
    const group = document.createElement("span");
    group.className = "generate-preview-card__group";
    group.textContent = c.group ? t("options.generator.preview.group", { group: c.group }) : t("options.generator.preview.noGroup");
    group.style.fontSize = "11px";
    group.style.color = "var(--muted)";
    group.style.marginBottom = "4px";
    
    const meta = document.createElement("div");
    meta.className = "generate-preview-card__meta";
    
    const typeBadge = document.createElement("span");
    typeBadge.style.background = "var(--panel-soft)";
    typeBadge.style.padding = "2px 6px";
    typeBadge.style.borderRadius = "4px";
    typeBadge.style.marginRight = "6px";
    typeBadge.style.fontSize = "10px";
    typeBadge.style.fontWeight = "700";
    typeBadge.style.color = "var(--accent)";
    typeBadge.style.border = "1px solid var(--line)";
    typeBadge.textContent = String(c.patternType || "wildcard").toUpperCase();
    
    const pathMapping = document.createElement("code");
    pathMapping.textContent = `${c.sourcePattern} ➔ ${c.targetUrl}`;
    pathMapping.style.fontSize = "11px";
    
    meta.appendChild(typeBadge);
    meta.appendChild(pathMapping);
    
    card.appendChild(name);
    card.appendChild(group);
    card.appendChild(meta);
    
    list.appendChild(card);
  });
}

function updateFooterStats() {
  const prodUrl = generateBaseProdUrl.value.trim();
  const redirectUrl = generateRedirectUrl.value.trim();
  
  const hasProdUrl = Boolean(prodUrl);
  const hasredirectUrl = Boolean(redirectUrl);
  
  // Validation for Production URL/Host
  const prodError = document.querySelector("#prodUrlError");
  let isProdUrlValid = true;
  if (!hasProdUrl) {
    isProdUrlValid = false;
    if (prodError) {
      prodError.textContent = t("options.generator.validation.prodRequired");
      prodError.style.display = "block";
    }
  } else {
    try {
      const parsed = prodUrl.startsWith("http") ? new URL(prodUrl) : new URL("https://" + prodUrl);
      if (!parsed.hostname) throw new Error();
      if (prodError) prodError.style.display = "none";
    } catch (e) {
      isProdUrlValid = false;
      if (prodError) {
        prodError.textContent = t("options.generator.validation.prodInvalid");
        prodError.style.display = "block";
      }
    }
  }
  generateBaseProdUrl.classList.toggle("is-invalid", !isProdUrlValid);
  
  // Validation for Local URL
  const localError = document.querySelector("#redirectUrlError");
  let isredirectUrlValid = true;
  if (!hasredirectUrl) {
    isredirectUrlValid = false;
    if (localError) {
      localError.textContent = t("options.generator.validation.localRequired");
      localError.style.display = "block";
    }
  } else {
    try {
      const checkUrl = redirectUrl.replace(/:\*$/, ":80").replace(/:\*([/?#])/, ":80$1");
      new URL(checkUrl);
      if (localError) localError.style.display = "none";
    } catch (e) {
      isredirectUrlValid = false;
      if (localError) {
        localError.textContent = t("options.generator.validation.localInvalid");
        localError.style.display = "block";
      }
    }
  }
  generateRedirectUrl.classList.toggle("is-invalid", !isredirectUrlValid);
  
  const selectedCount = generateParsedCandidates.filter(c => c.selected).length;
  const isValid = isProdUrlValid && isredirectUrlValid && selectedCount > 0;
  
  if (!isProdUrlValid || !isredirectUrlValid) {
    generateRuleStatsMsg.innerHTML = `<span style="color: var(--danger); font-weight: 700;">${t("options.generator.stats.fixRequired", { count: selectedCount })}</span>`;
  } else if (selectedCount === 0) {
    generateRuleStatsMsg.innerHTML = `<span style="color: var(--warning); font-weight: 700;">${t("options.generator.stats.selectAtLeast")}</span>`;
  } else {
    generateRuleStatsMsg.textContent = t("options.generator.stats.selected", { count: selectedCount });
  }
  
  generateSaveDraft.disabled = !isValid;
  generateSaveEnable.disabled = !isValid;
}

// Live Redirection Simulators
function simulateRedirection(testUrl, sourcePattern, targetUrl, patternType) {
  if (patternType === "regex") {
    try {
      const regex = new RegExp(sourcePattern);
      if (regex.test(testUrl)) {
        return testUrl.replace(regex, targetUrl);
      }
    } catch (e) {
      return null;
    }
  } else {
    const matcher = buildSourceMatcher(sourcePattern, "wildcard");
    if (matcher(testUrl)) {
      const staticParts = sourcePattern.split("*");
      if (staticParts.length >= 2) {
        const lastSegment = staticParts[staticParts.length - 2];
        const cleanSegment = lastSegment.replace(/^[a-zA-Z0-9+.-]+:\/\//, ""); // strip protocol
        const testUrlClean = testUrl.replace(/^[a-zA-Z0-9+.-]+:\/\//, "");
        const index = testUrlClean.indexOf(cleanSegment);
        if (index !== -1) {
          const suffix = testUrlClean.substring(index + cleanSegment.length);
          const cleanTarget = targetUrl.replace(/\*$/, "");
          return cleanTarget + suffix;
        }
      }
      return targetUrl;
    }
  }
  return null;
}

function updateGeneratePlayground() {
  const testUrl = generatePlaygroundInput.value.trim();
  if (!testUrl) {
    generatePlaygroundStatus.dataset.status = "none";
    generatePlaygroundStatus.textContent = t("options.generator.playground.status.noInput");
    generatePlaygroundRedirectResult.textContent = "-";
    return;
  }
  
  const selectedRules = generateParsedCandidates.filter(c => c.selected);
  if (selectedRules.length === 0) {
    generatePlaygroundStatus.dataset.status = "nomatch";
    generatePlaygroundStatus.textContent = t("options.generator.playground.status.noRules");
    generatePlaygroundRedirectResult.textContent = "-";
    return;
  }
  
  // Find first matching rule
  let matchedRule = null;
  let redirectedUrl = null;
  
  for (const r of selectedRules) {
    const result = simulateRedirection(testUrl, r.sourcePattern, r.targetUrl, r.patternType);
    if (result) {
      matchedRule = r;
      redirectedUrl = result;
      break;
    }
  }
  
  if (matchedRule) {
    generatePlaygroundStatus.dataset.status = "match";
    generatePlaygroundStatus.textContent = t("options.generator.playground.status.matched", { name: matchedRule.name });
    generatePlaygroundRedirectResult.textContent = redirectedUrl;
  } else {
    generatePlaygroundStatus.dataset.status = "nomatch";
    generatePlaygroundStatus.textContent = t("options.generator.playground.status.noMatch");
    generatePlaygroundRedirectResult.textContent = "-";
  }
}

if (generatePlaygroundInput) {
  generatePlaygroundInput.addEventListener("input", updateGeneratePlayground);
}

// 4. Save candidates to Altreurl rules state
async function saveGeneratedRules(enabled = true) {
  const selectedCandidates = generateParsedCandidates.filter(c => c.selected);
  if (selectedCandidates.length === 0) return;
  
  // Save base Local URL to presets history
  const redirectUrl = generateRedirectUrl.value.trim();
  if (redirectUrl) {
    await addLocalPresetToHistory(redirectUrl);
    const prodUrl = generateBaseProdUrl.value.trim();
    if (prodUrl) {
      await addProdUrlPresetToHistory(prodUrl);
    }
  }
  
  const now = new Date().toISOString();
  const newRules = selectedCandidates.map((c) => {
    const blankRule = createBlankRule();
    
    // Auto-configured from Candidate
    const rule = {
      ...blankRule,
      enabled: enabled,
      name: c.name || blankRule.name,
      group: c.group || "",
      patternType: c.patternType === "regex" ? PATTERN_TYPES.regex : PATTERN_TYPES.wildcard,
      sourcePattern: c.sourcePattern,
      targetUrl: c.targetUrl,
      createdAt: now,
      modifiedAt: now
    };
    
    // Auto configure synced credentials if cURL tab and checkbox is enabled
    if (generateActiveTab === "curl" && generateDetectedCredentials) {
      if (generateDetectedCredentials.hasAuth && generateSyncAuthCheckbox.checked) {
        rule.credentialMode = CREDENTIAL_MODES.sync;
        rule.syncAuthorization = true;
        rule.credentialSource = CREDENTIAL_SOURCES.storage;
        rule.storageArea = STORAGE_AREAS.localStorage;
        rule.authorizationKey = "token"; // smart guess
        rule.authorizationPrefix = "Bearer";
      }
      
      if (generateDetectedCredentials.hasCookie && generateSyncCookieCheckbox.checked) {
        rule.credentialMode = CREDENTIAL_MODES.sync;
        rule.syncCookies = true;
        rule.cookieNames = "session,sid"; // smart guess
      }
    }
    
    return rule;
  });
  
  try {
    if (enabled) {
      // Save & Enable: Persist rules immediately, preserve other drafts
      const persistedRules = await getRedirectRules();
      const savedRules = [...newRules, ...persistedRules];
      const appliedRules = await saveRules(savedRules);
      
      savedRuleIds = new Set(appliedRules.map((rule) => rule.id));
      rules = mergePersistedRulesWithDrafts(appliedRules, {
        committedRuleIds: new Set(newRules.map(r => r.id))
      });
    } else {
      // Save as Draft: Keep rules purely in-memory as drafts
      rules = [...newRules, ...rules];
    }
    
    // Select the newly generated rules in sidebar
    selectedRuleIds = new Set(newRules.map((rule) => rule.id));
    selectedRuleId = newRules[0].id;
    
    notify(
      newRules.length > 1
        ? t("options.toast.imported", { count: newRules.length, noun: t("common.rules") })
        : t("options.toast.ruleAdded"),
      "success"
    );
    closeGenerateDialog();
    render();
  } catch (err) {
    notify(t("runtime.error.apply") + ": " + err.message, "error");
  }
}

if (generateSaveDraft) {
  generateSaveDraft.addEventListener("click", () => saveGeneratedRules(false));
}

if (generateSaveEnable) {
  generateSaveEnable.addEventListener("click", () => saveGeneratedRules(true));
}

// Helpers
function getUrlPathname(urlStr) {
  try {
    const u = new URL(urlStr.startsWith("http") ? urlStr : "https://" + urlStr);
    return u.pathname;
  } catch(e) {
    return "/";
  }
}

function getUrlHost(urlStr) {
  try {
    const u = new URL(urlStr.startsWith("http") ? urlStr : "https://" + urlStr);
    return u.host;
  } catch(e) {
    return "api.production.com";
  }
}

function setupHelpModal() {
  const modal = document.getElementById("helpModal");
  const modalClose = document.getElementById("helpModalClose");
  const modalTitle = document.getElementById("helpModalTitle");
  const modalContent = document.getElementById("helpModalContent");

  if (!modal || !modalClose || !modalTitle || !modalContent) return;

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".help-btn");
    if (btn) {
      e.preventDefault();
      const topic = btn.dataset.helpTopic;
      if (topic) {
        modalTitle.textContent = t(`options.help.${topic}.title`);
        modalContent.innerHTML = t(`options.help.${topic}.content`);
        modal.classList.add("active");
      }
    }
  });

  modalClose.addEventListener("click", () => {
    modal.classList.remove("active");
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.remove("active");
    }
  });
}

setupHelpModal();
render();

// Helper for Local URL Presets History
async function initializeLocalPresetsHistory() {
  if (!generateRedirectHistories) return;
  
  try {
    const result = await chrome.storage.local.get({ localPresetsHistory: [] });
    const history = Array.isArray(result.localPresetsHistory) ? result.localPresetsHistory : [];
    
    generateRedirectHistories.innerHTML = "";
    
    if (history.length === 0) {
      generateRedirectHistories.style.display = "none";
      return;
    }
    
    generateRedirectHistories.style.display = "";
    
    // Add placeholder first
    const placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = "History...";
    placeholderOpt.disabled = true;
    placeholderOpt.selected = true;
    generateRedirectHistories.appendChild(placeholderOpt);
    
    history.forEach((url) => {
      const opt = document.createElement("option");
      opt.value = url;
      opt.textContent = url.replace(/^https?:\/\//, "");
      generateRedirectHistories.appendChild(opt);
    });
  } catch (err) {
    console.error("Failed to load local presets history:", err);
  }
}

async function addLocalPresetToHistory(url) {
  if (!url || typeof url !== "string") return;
  const cleanUrl = url.trim().replace(/\/$/, ""); // Trim and clean trailing slash
  if (!cleanUrl) return;
  
  try {
    const result = await chrome.storage.local.get({ localPresetsHistory: [] });
    let history = Array.isArray(result.localPresetsHistory) ? result.localPresetsHistory : [];
    
    // Remove if already in history to move to top
    history = history.filter(item => item !== cleanUrl);
    
    // Add to very top
    history.unshift(cleanUrl);
    
    // Keep max 5 history items
    history = history.slice(0, 5);
    
    await chrome.storage.local.set({ localPresetsHistory: history });
    
    // Re-initialize dropdown UI
    await initializeLocalPresetsHistory();
  } catch (err) {
    console.error("Failed to add local preset to history:", err);
  }
}

async function initializeProdUrlHistory() {
  if (!generateProdUrlHistories) return;
  try {
    const result = await chrome.storage.local.get({ prodUrlPresetsHistory: [] });
    const history = Array.isArray(result.prodUrlPresetsHistory) ? result.prodUrlPresetsHistory : [];
    
    generateProdUrlHistories.innerHTML = "";
    
    if (history.length === 0) {
      generateProdUrlHistories.style.display = "none";
      return;
    }
    
    generateProdUrlHistories.style.display = "";
    
    // Add placeholder first
    const placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = "History...";
    placeholderOpt.disabled = true;
    placeholderOpt.selected = true;
    generateProdUrlHistories.appendChild(placeholderOpt);
    
    history.forEach((url) => {
      const opt = document.createElement("option");
      opt.value = url;
      opt.textContent = url.replace(/^https?:\/\//, "");
      generateProdUrlHistories.appendChild(opt);
    });
  } catch (err) {
    console.error("Failed to load prod url history:", err);
  }
}

async function addProdUrlPresetToHistory(url) {
  if (!url || typeof url !== "string") return;
  const cleanUrl = url.trim().replace(/\/$/, ""); 
  if (!cleanUrl) return;
  
  try {
    const result = await chrome.storage.local.get({ prodUrlPresetsHistory: [] });
    let history = Array.isArray(result.prodUrlPresetsHistory) ? result.prodUrlPresetsHistory : [];
    
    history = history.filter(item => item !== cleanUrl);
    history.unshift(cleanUrl);
    history = history.slice(0, 5);
    
    await chrome.storage.local.set({ prodUrlPresetsHistory: history });
    await initializeProdUrlHistory();
  } catch (err) {
    console.error("Failed to add prod url preset to history:", err);
  }
}
