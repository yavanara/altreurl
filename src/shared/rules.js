import { t } from "./i18n.js";

const RULE_ID_BASE = 1000;
const WILDCARD = "*";
let dynamicRuleApplyQueue = Promise.resolve();
export const PATTERN_TYPES = {
  wildcard: "wildcard",
  regex: "regex"
};
export const CREDENTIAL_MODES = {
  manual: "manual",
  sync: "sync"
};
export const CREDENTIAL_SOURCES = {
  request: "request",
  storage: "storage",
  cookie: "cookie"
};
export const STORAGE_AREAS = {
  localStorage: "localStorage",
  sessionStorage: "sessionStorage"
};
const UNSYNCED_HEADER_NAMES = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "origin",
  "referer",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "upgrade-insecure-requests"
]);

export function normalizeHeaderRows(headers = []) {
  return headers
    .map((header) => ({
      name: String(header.name || "").trim(),
      value: String(header.value || "").trim()
    }))
    .filter((header) => header.name && header.value);
}

export function normalizePatternType(patternType) {
  return Object.values(PATTERN_TYPES).includes(patternType) ? patternType : PATTERN_TYPES.wildcard;
}

export function normalizeCredentialMode(rule) {
  if (Object.values(CREDENTIAL_MODES).includes(rule?.credentialMode)) {
    return rule.credentialMode;
  }

  return Boolean(rule?.syncHeaders || rule?.syncAuthorization || rule?.syncCookies)
    ? CREDENTIAL_MODES.sync
    : CREDENTIAL_MODES.manual;
}

export function normalizeCredentialSource(rule) {
  if (Object.values(CREDENTIAL_SOURCES).includes(rule?.credentialSource)) {
    return rule.credentialSource;
  }

  return CREDENTIAL_SOURCES.request;
}

export function normalizeStorageArea(storageArea) {
  return Object.values(STORAGE_AREAS).includes(storageArea) ? storageArea : STORAGE_AREAS.localStorage;
}

export function isSyncableHeaderName(headerName) {
  const normalizedName = String(headerName || "").trim().toLowerCase();
  return normalizedName && !UNSYNCED_HEADER_NAMES.has(normalizedName) && normalizedName !== "authorization";
}

function canSyncHeaders(rule) {
  return normalizeCredentialSource(rule) !== CREDENTIAL_SOURCES.cookie;
}

export function normalizeSyncedHeaders(headers = []) {
  return normalizeHeaderRows(headers).filter((header) => isSyncableHeaderName(header.name));
}

export function hasSyncEnabled(rule) {
  return normalizeCredentialMode(rule) === CREDENTIAL_MODES.sync &&
    Boolean((canSyncHeaders(rule) && rule.syncHeaders) || rule.syncAuthorization || rule.syncCookies);
}

export function isWaitingForSyncCapture(rule) {
  if (!hasSyncEnabled(rule)) {
    return false;
  }

  return !rule.lastSyncedAt;
}

export function buildSourceMatcher(sourcePattern, patternType = PATTERN_TYPES.wildcard) {
  const normalizedPatternType = normalizePatternType(patternType);
  const regexSource = normalizedPatternType === PATTERN_TYPES.regex
    ? sourcePattern
    : !sourcePattern.includes(WILDCARD)
      ? buildRegexFilterFromLiteralUrl(sourcePattern)
    : buildRegexFilterFromWildcard(sourcePattern);
  const regex = new RegExp(regexSource);

  return (url) => regex.test(url);
}

function escapeRegex(value) {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function countWildcards(value) {
  return [...String(value || "")].filter((character) => character === WILDCARD).length;
}

function buildRegexFilterFromWildcard(sourcePattern) {
  if (sourcePattern.startsWith("^") && sourcePattern.endsWith("$")) {
    return sourcePattern;
  }

  return `^${sourcePattern.split(WILDCARD).map(escapeRegex).join("(.*)")}$`;
}

function buildRegexFilterFromLiteralUrl(url, options = {}) {
  const escapedUrl = escapeRegex(url);
  const canPreserveUrlSuffix = /^https?:\/\//i.test(url) && !/[?#]/.test(url);
  const canAppendQuerySuffix = /^https?:\/\//i.test(url) && url.includes("?") && !url.includes("#");
  const suffixPattern = options.captureSuffix ? "([?#].*)?" : "(?:[?#].*)?";
  const querySuffixPattern = options.captureSuffix ? "([&#].*)?" : "(?:[&#].*)?";

  if (canPreserveUrlSuffix) {
    return `^${escapedUrl}${suffixPattern}$`;
  }

  if (canAppendQuerySuffix) {
    return `^${escapedUrl}${querySuffixPattern}$`;
  }

  return `^${escapedUrl}$`;
}

function buildRegexSubstitutionFromWildcard(targetUrl) {
  if (/\\[1-9]\d*|\$[1-9]\d*/.test(targetUrl)) {
    return targetUrl;
  }

  let groupIndex = 0;

  return targetUrl
    .split(WILDCARD)
    .map((part, index) => {
      if (index === 0) {
        return part;
      }

      groupIndex += 1;
      return `\\${groupIndex}${part}`;
    })
    .join("");
}

function stripRegexAnchors(regexPattern) {
  return regexPattern.replace(/^\^/, "").replace(/\$$/, "");
}

function unescapeRegexLiterals(regexPattern) {
  return regexPattern.replace(/\\([\\^$*+?.()|[\]{}])/g, "$1");
}

function buildWildcardFromRegexFilter(regexPattern) {
  return unescapeRegexLiterals(
    stripRegexAnchors(regexPattern)
      .replace(/\(\.\*\??\)/g, WILDCARD)
      .replace(/\(\[\^[^\]]+\]\*\??\)/g, WILDCARD)
  );
}

function buildWildcardFromRegexSubstitution(targetUrl) {
  return targetUrl.replace(/\\[1-9]\d*/g, WILDCARD).replace(/\$[1-9]\d*/g, WILDCARD);
}

function buildRegexFilterFromRegexSubstitution(targetUrl) {
  return `^${targetUrl
    .split(/(\\[1-9]\d*|\$[1-9]\d*)/g)
    .map((part) => (/^(\\[1-9]\d*|\$[1-9]\d*)$/.test(part) ? "(.*)" : escapeRegex(part)))
    .join("")}$`;
}

function countRegexCaptureGroups(regexPattern = "") {
  let count = 0;
  let inCharacterClass = false;

  for (let index = 0; index < regexPattern.length; index += 1) {
    const character = regexPattern[index];
    const previousCharacter = regexPattern[index - 1];
    const isEscaped = previousCharacter === "\\";

    if (character === "[" && !isEscaped) {
      inCharacterClass = true;
      continue;
    }

    if (character === "]" && !isEscaped) {
      inCharacterClass = false;
      continue;
    }

    if (character !== "(" || isEscaped || inCharacterClass) {
      continue;
    }

    if (regexPattern[index + 1] === "?" && regexPattern[index + 2] !== "<") {
      continue;
    }

    if (regexPattern[index + 1] === "?" && regexPattern[index + 2] === "<" && ["=", "!"].includes(regexPattern[index + 3])) {
      continue;
    }

    count += 1;
  }

  return count;
}

function getRegexSubstitutionRefs(targetUrl = "") {
  return [...String(targetUrl).matchAll(/\\([1-9]\d*)|\$([1-9]\d*)/g)]
    .map((match) => Number(match[1] || match[2]))
    .filter((groupIndex) => Number.isInteger(groupIndex));
}

export function validateRegexSubstitutionRefs(sourcePattern, targetUrl) {
  const captureGroupCount = countRegexCaptureGroups(sourcePattern);
  const invalidRef = getRegexSubstitutionRefs(targetUrl)
    .find((groupIndex) => groupIndex > captureGroupCount);

  if (invalidRef) {
    throw new Error(t("rules.error.captureRef", { group: invalidRef, count: captureGroupCount }));
  }
}

export function isRegexPatternValid(sourcePattern) {
  try {
    new RegExp(sourcePattern);
    return true;
  } catch (_error) {
    return false;
  }
}

function validateRegexPattern(sourcePattern) {
  if (!isRegexPatternValid(sourcePattern)) {
    throw new Error(t("rules.error.regexInvalid"));
  }
}

export function isRegexSubstitutionValid(sourcePattern, targetUrl) {
  try {
    validateRegexSubstitutionRefs(sourcePattern, targetUrl);
    return true;
  } catch (_error) {
    return false;
  }
}

export function convertPatternFormat(value, fromPatternType, toPatternType, fieldType) {
  const fromType = normalizePatternType(fromPatternType);
  const toType = normalizePatternType(toPatternType);

  if (!value || fromType === toType) {
    return value;
  }

  if (fromType === PATTERN_TYPES.wildcard && toType === PATTERN_TYPES.regex) {
    return fieldType === "target" ? buildRegexSubstitutionFromWildcard(value) : buildRegexFilterFromWildcard(value);
  }

  if (fromType === PATTERN_TYPES.regex && toType === PATTERN_TYPES.wildcard) {
    return fieldType === "target" ? buildWildcardFromRegexSubstitution(value) : buildWildcardFromRegexFilter(value);
  }

  return value;
}

export function buildRedirectCondition(sourcePattern, patternType = PATTERN_TYPES.wildcard) {
  if (normalizePatternType(patternType) === PATTERN_TYPES.regex) {
    validateRegexPattern(sourcePattern);

    return {
      regexFilter: sourcePattern,
      resourceTypes: getResourceTypes()
    };
  }

  if (!sourcePattern.includes(WILDCARD)) {
    return {
      regexFilter: buildRegexFilterFromLiteralUrl(sourcePattern, { captureSuffix: true }),
      resourceTypes: getResourceTypes()
    };
  }

  return {
    regexFilter: buildRegexFilterFromWildcard(sourcePattern),
    resourceTypes: getResourceTypes()
  };
}

export function buildHeaderCondition(sourcePattern, targetUrl, patternType = PATTERN_TYPES.wildcard) {
  if (normalizePatternType(patternType) === PATTERN_TYPES.regex) {
    validateRegexPattern(sourcePattern);

    return {
      regexFilter: buildRegexFilterFromRegexSubstitution(targetUrl),
      resourceTypes: getResourceTypes()
    };
  }

  if (targetUrl.includes(WILDCARD)) {
    return {
      regexFilter: buildRegexFilterFromWildcard(targetUrl),
      resourceTypes: getResourceTypes()
    };
  }

  return {
    regexFilter: buildRegexFilterFromLiteralUrl(targetUrl),
    resourceTypes: getResourceTypes()
  };
}

function buildExactRedirectRules(sourcePattern, targetUrl, baseId) {
  const escapedSource = escapeRegex(sourcePattern);
  const queryJoiner = targetUrl.includes("?") ? "&" : "?";
  const sourceHasQuery = sourcePattern.includes("?") && !sourcePattern.includes("#");
  return [
    {
      id: baseId,
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          url: targetUrl
        }
      },
      condition: {
        regexFilter: `^${escapedSource}$`,
        resourceTypes: getResourceTypes()
      }
    },
    {
      id: baseId + 1,
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          regexSubstitution: `${targetUrl}${queryJoiner}\\1`
        }
      },
      condition: {
        regexFilter: sourceHasQuery ? `^${escapedSource}&(.*)$` : `^${escapedSource}\\?(.*)$`,
        resourceTypes: getResourceTypes()
      }
    }
  ];
}

function shouldUseExactRedirectRules(sourcePattern, targetUrl, patternType = PATTERN_TYPES.wildcard) {
  return normalizePatternType(patternType) === PATTERN_TYPES.wildcard &&
    countWildcards(sourcePattern) === 0 &&
    countWildcards(targetUrl) === 0 &&
    /^https?:\/\//i.test(sourcePattern) &&
    !sourcePattern.includes("#");
}

function getConditionSignature(condition) {
  return condition.regexFilter ? `regex:${condition.regexFilter}` : `url:${condition.urlFilter || ""}`;
}

function getTargetConflictScope(targetUrl, patternType = PATTERN_TYPES.wildcard) {
  const normalizedTargetUrl = String(targetUrl || "")
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\\./g, ".");
  const boundaryPattern = normalizePatternType(patternType) === PATTERN_TYPES.regex
    ? /(\\[1-9]\d*|\$[1-9]\d*|\(\.\*\)|\.\*)/
    : /\*/;
  const literalPrefix = normalizedTargetUrl.split(boundaryPattern)[0];

  try {
    const parsedUrl = new URL(literalPrefix || normalizedTargetUrl);
    const pathPrefix = parsedUrl.pathname || "/";

    return {
      origin: parsedUrl.origin,
      pathPrefix: pathPrefix.endsWith("/") ? pathPrefix : pathPrefix,
      raw: normalizedTargetUrl
    };
  } catch (_error) {
    return {
      origin: "",
      pathPrefix: "",
      raw: normalizedTargetUrl
    };
  }
}

function doTargetScopesOverlap(leftScope, rightScope) {
  if (!leftScope.origin || !rightScope.origin || leftScope.origin !== rightScope.origin) {
    return false;
  }

  return isSameOrNestedPath(leftScope.pathPrefix, rightScope.pathPrefix) ||
    isSameOrNestedPath(rightScope.pathPrefix, leftScope.pathPrefix);
}

function isSameOrNestedPath(candidatePath, prefixPath) {
  if (candidatePath === prefixPath) {
    return true;
  }

  const normalizedPrefix = prefixPath.endsWith("/") ? prefixPath : `${prefixPath}/`;
  return candidatePath.startsWith(normalizedPrefix);
}

function getTargetConflictScopes(rule) {
  return {
    rule,
    hasCredentialHeaders: hasPotentialCredentialHeaders(rule),
    scope: getTargetConflictScope(rule.targetUrl, rule.patternType),
    signature: getConditionSignature(buildHeaderCondition(rule.sourcePattern, rule.targetUrl, normalizePatternType(rule.patternType)))
  };
}

function getRuleTargetConflict(activeRule, activeRuleScopes) {
  if (!activeRule.hasCredentialHeaders) {
    return null;
  }

  return activeRuleScopes.find((candidateRule) => (
    candidateRule.rule.id !== activeRule.rule.id &&
    (
      candidateRule.signature === activeRule.signature ||
      doTargetScopesOverlap(candidateRule.scope, activeRule.scope)
    )
  )) || null;
}

export function getRuleSetIssuesByRuleId(configRules = []) {
  const activeRules = configRules
    .filter((rule) => rule.enabled && rule.sourcePattern && rule.targetUrl);
  const issuesByRuleId = new Map();
  const rulesEligibleForConflictCheck = activeRules.filter((rule) => {
    if (String(rule.sourcePattern || "").includes("#") || String(rule.targetUrl || "").includes("#")) {
      issuesByRuleId.set(
        rule.id,
        t("rules.error.fragment", { name: rule.name || t("options.rules.unnamed") })
      );
      return false;
    }

    return true;
  });

  addDuplicatePatternIssues(rulesEligibleForConflictCheck, issuesByRuleId);

  const activeRuleScopes = rulesEligibleForConflictCheck.map(getTargetConflictScopes);

  activeRuleScopes.forEach((activeRule) => {
    const conflictRule = getRuleTargetConflict(activeRule, activeRuleScopes);

    if (!conflictRule) {
      return;
    }

    issuesByRuleId.set(
      activeRule.rule.id,
      t("rules.error.credentialOverlap", {
        name: activeRule.rule.name || t("options.rules.unnamed"),
        otherName: conflictRule.rule.name || t("options.rules.unnamed")
      })
    );
    issuesByRuleId.set(
      conflictRule.rule.id,
      t("rules.error.credentialOverlapReverse", {
        name: conflictRule.rule.name || t("options.rules.unnamed"),
        otherName: activeRule.rule.name || t("options.rules.unnamed")
      })
    );
  });

  return issuesByRuleId;
}

function addDuplicatePatternIssues(activeRules, issuesByRuleId) {
  addDuplicateRuleIssue(
    activeRules,
    issuesByRuleId,
    getRuleRouteSignature,
    "rules.error.duplicateRoute"
  );
  addDuplicateRuleIssue(
    activeRules,
    issuesByRuleId,
    getRuleSourceSignature,
    "rules.error.duplicateSource"
  );
  addDuplicateRuleIssue(
    activeRules,
    issuesByRuleId,
    getRuleTargetSignature,
    "rules.error.duplicateTarget"
  );
}

function addDuplicateRuleIssue(activeRules, issuesByRuleId, getSignature, messageKey) {
  const firstRuleBySignature = new Map();

  activeRules.forEach((rule) => {
    const signature = getSignature(rule);

    if (!signature) {
      return;
    }

    const existingRule = firstRuleBySignature.get(signature);

    if (!existingRule) {
      firstRuleBySignature.set(signature, rule);
      return;
    }

    markDuplicateRuleIssue(existingRule, rule, issuesByRuleId, messageKey);
  });
}

function markDuplicateRuleIssue(leftRule, rightRule, issuesByRuleId, messageKey) {
  if (!issuesByRuleId.has(leftRule.id)) {
    issuesByRuleId.set(leftRule.id, t(messageKey, {
      name: leftRule.name || t("options.rules.unnamed"),
      otherName: rightRule.name || t("options.rules.unnamed")
    }));
  }

  if (!issuesByRuleId.has(rightRule.id)) {
    issuesByRuleId.set(rightRule.id, t(messageKey, {
      name: rightRule.name || t("options.rules.unnamed"),
      otherName: leftRule.name || t("options.rules.unnamed")
    }));
  }
}

function getRuleRouteSignature(rule) {
  return `${getRuleSourceSignature(rule)} -> ${getRuleTargetSignature(rule)}`;
}

function getRuleSourceSignature(rule) {
  return `${normalizePatternType(rule.patternType)}:${normalizePatternValue(rule.sourcePattern)}`;
}

function getRuleTargetSignature(rule) {
  return `${normalizePatternType(rule.patternType)}:${normalizePatternValue(rule.targetUrl)}`;
}

function normalizePatternValue(value) {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

export function validateRuleSet(configRules = []) {
  const issues = [...getRuleSetIssuesByRuleId(configRules).values()];

  if (issues.length > 0) {
    throw new Error(issues[0]);
  }
}

function validateHeaderConditionUniqueness(headerCondition, rule, seenHeaderConditions) {
  const signature = getConditionSignature(headerCondition);
  const currentScope = getTargetConflictScope(rule.targetUrl, rule.patternType);
  const previousRule = [...seenHeaderConditions.values()].find((entry) => (
    entry.signature === signature ||
    doTargetScopesOverlap(entry.scope, currentScope)
  ))?.rule;

  if (previousRule) {
    throw new Error(
      t("rules.error.headerOverlap", {
        leftName: previousRule.name || t("options.rules.unnamed"),
        rightName: rule.name || t("options.rules.unnamed")
      })
    );
  }

  seenHeaderConditions.set(signature, { rule, scope: currentScope, signature });
}

export function buildRedirectAction(sourcePattern, targetUrl, patternType = PATTERN_TYPES.wildcard) {
  if (normalizePatternType(patternType) === PATTERN_TYPES.regex) {
    validateRegexPattern(sourcePattern);
    validateRegexSubstitutionRefs(sourcePattern, targetUrl);

    return {
      type: "redirect",
      redirect: {
        regexSubstitution: targetUrl
      }
    };
  }

  const sourceWildcardCount = countWildcards(sourcePattern);
  const targetWildcardCount = countWildcards(targetUrl);

  if (sourceWildcardCount > 0 && targetWildcardCount > 0) {
    if (sourceWildcardCount !== targetWildcardCount) {
      throw new Error(t("rules.error.wildcardMismatch"));
    }

    return {
      type: "redirect",
      redirect: {
        regexSubstitution: buildRegexSubstitutionFromWildcard(targetUrl)
      }
    };
  }

  if (targetWildcardCount > 0) {
    throw new Error(t("rules.error.targetWildcardWithoutSource"));
  }

  return {
    type: "redirect",
    redirect: {
      url: targetUrl
    }
  };
}

function getResourceTypes() {
  return [
    "main_frame",
    "sub_frame",
    "xmlhttprequest",
    "script",
    "stylesheet",
    "image",
    "font",
    "media",
    "websocket",
    "other"
  ];
}

function mergeRequestHeaders(...headerGroups) {
  const headersByName = new Map();

  headerGroups.flat().forEach((header) => {
    if (!header.name || !header.value) {
      return;
    }

    headersByName.set(header.name.toLowerCase(), {
      header: header.name,
      operation: "set",
      value: header.value
    });
  });

  return [...headersByName.values()];
}

function getRequestHeadersForRule(rule, isIncognito = false) {
  const syncedHeaders = canSyncHeaders(rule) && rule.syncHeaders
    ? normalizeSyncedHeaders(isIncognito ? rule.incognitoSyncedHeaders : rule.syncedHeaders)
    : [];
  const syncedAuthorization = rule.syncAuthorization && (isIncognito ? rule.incognitoSyncedAuthorization : rule.syncedAuthorization)
    ? [{ name: "Authorization", value: isIncognito ? rule.incognitoSyncedAuthorization : rule.syncedAuthorization }]
    : [];
  const syncedCookieHeader = rule.syncCookies && (isIncognito ? rule.incognitoSyncedCookieHeader : rule.syncedCookieHeader)
    ? [{ name: "Cookie", value: isIncognito ? rule.incognitoSyncedCookieHeader : rule.syncedCookieHeader }]
    : [];
  const manualAuthorization = rule.authorization
    ? [{ name: "Authorization", value: rule.authorization }]
    : [];

  return mergeRequestHeaders(
    syncedHeaders,
    syncedAuthorization,
    syncedCookieHeader,
    normalizeCredentialMode(rule) === CREDENTIAL_MODES.manual ? manualAuthorization : [],
    normalizeCredentialMode(rule) === CREDENTIAL_MODES.manual ? normalizeHeaderRows(rule.headers) : []
  );
}

function hasPotentialCredentialHeaders(rule) {
  if (getRequestHeadersForRule(rule, false).length > 0 || getRequestHeadersForRule(rule, true).length > 0) {
    return true;
  }

  return normalizeCredentialMode(rule) === CREDENTIAL_MODES.sync &&
    Boolean((canSyncHeaders(rule) && rule.syncHeaders) || rule.syncAuthorization || rule.syncCookies);
}

export function getGeneratedDynamicRuleCount(configRules = []) {
  return buildDynamicRules(configRules).length;
}

export function buildDynamicRules(configRules = [], tabGroups = { normalTabIds: [], incognitoTabIds: [] }) {
  validateRuleSet(configRules);
  const seenHeaderConditions = new Map();
  let nextRuleId = RULE_ID_BASE;
  const dynamicRules = [];

  configRules
    .filter((rule) => rule.enabled && rule.sourcePattern && rule.targetUrl)
    .forEach((rule) => {
      const patternType = normalizePatternType(rule.patternType);
      const normalSynced = !hasSyncEnabled(rule) || Boolean(rule.lastSyncedAt);
      const incognitoSynced = !hasSyncEnabled(rule) || Boolean(rule.incognitoLastSyncedAt);

      const hasTabRestrictions = (tabGroups.normalTabIds && tabGroups.normalTabIds.length > 0) || 
                                 (tabGroups.incognitoTabIds && tabGroups.incognitoTabIds.length > 0);

      // Fallback global rules when no active tab groups are provided (e.g. from popup validation/tests)
      if (!hasTabRestrictions) {
        const isWaiting = hasSyncEnabled(rule) && !rule.lastSyncedAt;
        if (!isWaiting) {
          const redirectCondition = buildRedirectCondition(rule.sourcePattern, patternType);
          const redirectRules = shouldUseExactRedirectRules(rule.sourcePattern, rule.targetUrl, patternType)
            ? buildExactRedirectRules(rule.sourcePattern, rule.targetUrl, nextRuleId)
            : [{
                id: nextRuleId,
                priority: 1,
                action: buildRedirectAction(rule.sourcePattern, rule.targetUrl, patternType),
                condition: redirectCondition
              }];

          nextRuleId += redirectRules.length;
          dynamicRules.push(...redirectRules);

          const requestHeaders = getRequestHeadersForRule(rule, false);
          if (requestHeaders.length > 0) {
            const headerCondition = buildHeaderCondition(rule.sourcePattern, rule.targetUrl, patternType);
            validateHeaderConditionUniqueness(headerCondition, rule, seenHeaderConditions);

            dynamicRules.push({
              id: nextRuleId,
              priority: 2,
              action: {
                type: "modifyHeaders",
                requestHeaders
              },
              condition: headerCondition
            });
            nextRuleId += 1;
          }
        }
        return;
      }

      // Normal Tab Group Specific Rules
      if (normalSynced && tabGroups.normalTabIds && tabGroups.normalTabIds.length > 0) {
        const redirectCondition = buildRedirectCondition(rule.sourcePattern, patternType);
        redirectCondition.tabIds = tabGroups.normalTabIds;

        const redirectRules = shouldUseExactRedirectRules(rule.sourcePattern, rule.targetUrl, patternType)
          ? buildExactRedirectRules(rule.sourcePattern, rule.targetUrl, nextRuleId)
          : [{
              id: nextRuleId,
              priority: 1,
              action: buildRedirectAction(rule.sourcePattern, rule.targetUrl, patternType),
              condition: redirectCondition
            }];

        redirectRules.forEach((r) => {
          r.condition.tabIds = tabGroups.normalTabIds;
        });

        nextRuleId += redirectRules.length;
        dynamicRules.push(...redirectRules);

        const requestHeaders = getRequestHeadersForRule(rule, false);
        if (requestHeaders.length > 0) {
          const headerCondition = buildHeaderCondition(rule.sourcePattern, rule.targetUrl, patternType);
          headerCondition.tabIds = tabGroups.normalTabIds;
          validateHeaderConditionUniqueness(headerCondition, rule, seenHeaderConditions);

          dynamicRules.push({
            id: nextRuleId,
            priority: 2,
            action: {
              type: "modifyHeaders",
              requestHeaders
            },
            condition: headerCondition
          });
          nextRuleId += 1;
        }
      }

      // Incognito Tab Group Specific Rules
      if (incognitoSynced && tabGroups.incognitoTabIds && tabGroups.incognitoTabIds.length > 0) {
        const redirectCondition = buildRedirectCondition(rule.sourcePattern, patternType);
        redirectCondition.tabIds = tabGroups.incognitoTabIds;

        const redirectRules = shouldUseExactRedirectRules(rule.sourcePattern, rule.targetUrl, patternType)
          ? buildExactRedirectRules(rule.sourcePattern, rule.targetUrl, nextRuleId)
          : [{
              id: nextRuleId,
              priority: 1,
              action: buildRedirectAction(rule.sourcePattern, rule.targetUrl, patternType),
              condition: redirectCondition
            }];

        redirectRules.forEach((r) => {
          r.condition.tabIds = tabGroups.incognitoTabIds;
        });

        nextRuleId += redirectRules.length;
        dynamicRules.push(...redirectRules);

        const requestHeaders = getRequestHeadersForRule(rule, true);
        if (requestHeaders.length > 0) {
          const headerCondition = buildHeaderCondition(rule.sourcePattern, rule.targetUrl, patternType);
          headerCondition.tabIds = tabGroups.incognitoTabIds;
          validateHeaderConditionUniqueness(headerCondition, rule, seenHeaderConditions);

          dynamicRules.push({
            id: nextRuleId,
            priority: 2,
            action: {
              type: "modifyHeaders",
              requestHeaders
            },
            condition: headerCondition
          });
          nextRuleId += 1;
        }
      }
    });

  return assignUniqueDynamicRuleIds(dynamicRules);
}

function assignUniqueDynamicRuleIds(dynamicRules) {
  return dynamicRules.map((rule, index) => ({
    ...rule,
    id: RULE_ID_BASE + index
  }));
}

export function applyDynamicRules(configRules = [], tabGroups = { normalTabIds: [], incognitoTabIds: [] }) {
  dynamicRuleApplyQueue = dynamicRuleApplyQueue
    .catch(() => {})
    .then(() => applyDynamicRulesNow(configRules, tabGroups));

  return dynamicRuleApplyQueue;
}

async function applyDynamicRulesNow(configRules = [], tabGroups = { normalTabIds: [], incognitoTabIds: [] }) {
  // Clear legacy dynamic rules to ensure they don't conflict with session-scoped rules
  try {
    const legacyDynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
    if (legacyDynamicRules.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: legacyDynamicRules.map((rule) => rule.id)
      });
    }
  } catch (_e) {
    // Fail silently if dynamic rule clearing fails
  }

  const existingRules = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = existingRules
    .map((rule) => rule.id);
  const addRules = buildDynamicRules(configRules, tabGroups);
  const dynamicRuleLimit = getDynamicRuleLimit();

  if (addRules.length > dynamicRuleLimit) {
    throw new Error(t("rules.error.dynamicLimit", { count: addRules.length, limit: dynamicRuleLimit }));
  }

  await validateDynamicRuleRegexFilters(addRules);
  assertUniqueDynamicRuleIds(addRules);

  if (removeRuleIds.length === 0 && addRules.length === 0) {
    return;
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds,
      addRules
    });
  } catch (error) {
    throw new Error(getDynamicRuleApplyErrorMessage(error, addRules));
  }
}

function assertUniqueDynamicRuleIds(dynamicRules) {
  const seenIds = new Set();
  const duplicateIds = [];

  dynamicRules.forEach((rule) => {
    if (seenIds.has(rule.id)) {
      duplicateIds.push(rule.id);
      return;
    }

    seenIds.add(rule.id);
  });

  if (duplicateIds.length > 0) {
    throw new Error(t("rules.error.duplicateDynamicIds", {
      ids: [...new Set(duplicateIds)].join(", ")
    }));
  }
}

function getDynamicRuleLimit() {
  return chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES ||
    chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES ||
    5000;
}

async function validateDynamicRuleRegexFilters(dynamicRules) {
  if (!chrome.declarativeNetRequest.isRegexSupported) {
    return;
  }

  const regexFilters = [...new Set(dynamicRules
    .map((rule) => rule.condition?.regexFilter)
    .filter(Boolean))];

  for (const regex of regexFilters) {
    const result = await chrome.declarativeNetRequest.isRegexSupported({ regex });

    if (!result.isSupported) {
      throw new Error(t("rules.error.unsupportedRegex", {
        reason: result.reason || t("common.unknown"),
        regex
      }));
    }
  }
}

function getDynamicRuleApplyErrorMessage(error, dynamicRules) {
  const detail = error?.message || chrome.runtime?.lastError?.message || "";
  const ruleSummary = dynamicRules.length === 0
    ? t("rules.error.applyNoRules")
    : t("rules.error.applyRuleCount", { count: dynamicRules.length });

  return t("rules.error.applyDetail", {
    detail: detail || t("runtime.error.apply"),
    ruleSummary
  });
}

export function createBlankRule() {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    modifiedAt: now,
    name: t("options.editor.name.placeholder"),
    group: "",
    enabled: true,
    patternType: PATTERN_TYPES.wildcard,
    credentialMode: CREDENTIAL_MODES.manual,
    syncHeaders: false,
    syncAuthorization: false,
    syncCookies: false,
    credentialSource: CREDENTIAL_SOURCES.request,
    storageArea: STORAGE_AREAS.localStorage,
    authorizationKey: "",
    authorizationPrefix: "",
    headersKey: "",
    cookieNames: "",
    sourcePattern: "",
    targetUrl: "",
    authorization: "",
    headers: [],
    syncedHeaders: [],
    syncedAuthorization: "",
    syncedCookieHeader: "",
    lastSyncedAt: ""
  };
}
