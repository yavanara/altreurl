/**
 * Generator helper for Request URL Redirector (Altreurl)
 * Exposes methods to parse cURL, suggest patterns, parse Swagger specs, and detect credentials.
 */

// Helper to escape regex special characters
export function escapeRegex(value) {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

/**
 * Parses a cURL command string and extracts the URL, headers, and HTTP method.
 * @param {string} curlString
 * @returns {{ url: string, headers: Array<{name: string, value: string}>, method: string }|null}
 */
export function parseCurlCommand(curlString) {
  if (!curlString || typeof curlString !== "string") {
    return null;
  }

  // Clean line continuations (newlines escaped with backslashes)
  const cleaned = curlString.replace(/\\\r?\n/g, " ").trim();

  // Simple tokenizer that handles single, double, and unquoted arguments
  const args = [];
  let current = "";
  let inDoubleQuote = false;
  let inSingleQuote = false;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === " " && !inDoubleQuote && !inSingleQuote) {
      if (current.trim()) {
        args.push(current.trim());
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    args.push(current.trim());
  }

  let url = "";
  const headers = [];
  let method = "";
  let hasDataPayload = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-H" || arg === "--header") {
      const headerVal = args[i + 1];
      if (headerVal) {
        const colonIndex = headerVal.indexOf(":");
        if (colonIndex !== -1) {
          const name = headerVal.substring(0, colonIndex).trim();
          const value = headerVal.substring(colonIndex + 1).trim();
          headers.push({ name, value });
        }
        i++; // skip next arg
      }
    } else if (arg === "-X" || arg === "--request") {
      const reqVal = args[i + 1];
      if (reqVal) {
        method = reqVal.toUpperCase();
        i++;
      }
    } else if (
      arg === "-d" ||
      arg === "--data" ||
      arg === "--data-raw" ||
      arg === "--data-binary" ||
      arg === "--data-urlencode"
    ) {
      hasDataPayload = true;
      i++; // skip payload arg
    } else if (arg.startsWith("http://") || arg.startsWith("https://")) {
      url = arg;
    } else if (!arg.startsWith("-") && !url) {
      // Sometimes URL is just written without quotes or protocol in front, but let's be strict
      // or try to guess if it looks like a URL/domain
      if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(arg)) {
        url = arg.startsWith("http") ? arg : "https://" + arg;
      }
    }
  }

  // Fallback method detection
  if (!method) {
    method = hasDataPayload ? "POST" : "GET";
  }

  if (!url) {
    // Last ditch: look for any argument that has http:// or https:// even inside quotes that might not have tokenized perfectly
    const urlMatch = cleaned.match(/https?:\/\/[^\s'"]+/);
    if (urlMatch) {
      url = urlMatch[0];
    }
  }

  return url ? { url, headers, method } : null;
}

/**
 * Suggests exact, wildcard, and regex patterns based on a single input URL.
 * @param {string} inputUrl
 * @returns {Array<{ type: string, pattern: string, descriptionKey: string }>}
 */
export function suggestPatterns(inputUrl) {
  if (!inputUrl) return [];

  let urlObj;
  try {
    urlObj = new URL(inputUrl);
  } catch (e) {
    // If invalid URL, try adding protocol
    try {
      urlObj = new URL("https://" + inputUrl);
    } catch (err) {
      return [];
    }
  }

  const protocol = urlObj.protocol; // e.g. "https:"
  const host = urlObj.hostname;     // e.g. "api.example.com"
  const pathname = urlObj.pathname; // e.g. "/v1/users/123/profile"
  const search = urlObj.search;     // e.g. "?sort=asc"

  const suggestions = [];

  // 1. Exact Match
  suggestions.push({
    type: "exact",
    pattern: urlObj.toString(),
    descriptionKey: "options.generator.pattern.exact"
  });

  // 2. Path Wildcard (without query params)
  const pathWildcard = `${protocol}//${host}${pathname}*`;
  suggestions.push({
    type: "wildcard_path",
    pattern: pathWildcard,
    descriptionKey: "options.generator.pattern.wildcardPath"
  });

  // 3. Domain Wildcard (covers any path/subdomain under this domain)
  const domainWildcard = `*://${host}/*`;
  suggestions.push({
    type: "wildcard_domain",
    pattern: domainWildcard,
    descriptionKey: "options.generator.pattern.wildcardDomain"
  });

  // 4. Smart Regex (replaces numeric IDs or UUIDs with dynamic matching)
  // Numeric ID: /123/ -> /([^\/]+)/
  // UUID: /123e4567-e89b-12d3-a456-426614174000/ -> /([^\/]+)/
  const segments = pathname.split("/");
  let hasDynamicSegment = false;
  const regexSegments = segments.map((seg) => {
    // Match numeric IDs or UUID patterns
    const isNumeric = /^\d+$/.test(seg);
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(seg);

    if (seg && (isNumeric || isUuid)) {
      hasDynamicSegment = true;
      return "([^\\/]+)";
    }
    return escapeRegex(seg);
  });

  if (hasDynamicSegment) {
    const escapedHost = escapeRegex(host);
    const regexPattern = `^https?:\\/\\/${escapedHost}${regexSegments.join("\\/")}(?:\\?.*)?$`;
    suggestions.push({
      type: "regex_dynamic",
      pattern: regexPattern,
      descriptionKey: "options.generator.pattern.regexDynamic"
    });
  }

  return suggestions;
}

/**
 * Checks for presence of sensitive credentials like Authorization or Cookies in headers list
 * @param {Array<{name: string, value: string}>} headers
 * @returns {{ hasAuth: boolean, hasCookie: boolean, authHeader: string, cookieHeader: string }}
 */
export function detectCredentials(headers = []) {
  let hasAuth = false;
  let hasCookie = false;
  let authHeader = "";
  let cookieHeader = "";

  for (const h of headers) {
    const nameLower = h.name.toLowerCase();
    if (nameLower === "authorization") {
      hasAuth = true;
      authHeader = h.value;
    } else if (nameLower === "cookie") {
      hasCookie = true;
      cookieHeader = h.value;
    }
  }

  return { hasAuth, hasCookie, authHeader, cookieHeader };
}

/**
 * Parses a Swagger / OpenAPI specification object and generates rule candidates.
 * @param {object} spec Swagger spec object
 * @param {string} baseProdUrl Base production URL, e.g. "https://api.production.com"
 * @param {string} baseredirectUrl Base target local URL, e.g. "http://localhost:5000"
 * @param {'simple'|'specific'} patternStyle Pattern style to generate by default
 * @returns {Array<object>} List of candidate rules
 */
export function parseSwaggerSpec(spec, baseProdUrl, baseredirectUrl, patternStyle = "specific", baseOn = "path") {
  if (!spec || typeof spec !== "object") return [];

  // Use spec.info.title as default parent group
  const parentGroup = spec.info?.title ? String(spec.info.title).trim() : "Swagger";

  const candidates = [];
  const paths = spec.paths || {};

  let prodOrigin = "";
  let localOrigin = "";

  try {
    prodOrigin = new URL(baseProdUrl).origin;
  } catch (e) {
    prodOrigin = baseProdUrl.startsWith("http") ? baseProdUrl : "https://" + baseProdUrl;
  }

  try {
    localOrigin = new URL(baseredirectUrl).origin;
  } catch (e) {
    localOrigin = baseredirectUrl.startsWith("http") ? baseredirectUrl : "http://" + baseredirectUrl;
  }

  // Ensure trailing slash is removed from base URLs for joining paths neatly
  const prodClean = prodOrigin.replace(/\/$/, "");
  const localClean = localOrigin.replace(/\/$/, "");

  // Host name without protocol for wildcard formatting
  const prodHost = prodClean.replace(/^https?:\/\//, "");

  if (patternStyle === "simple") {
    if (baseOn === "tags") {
      const tagGroups = {};
      Object.entries(paths).forEach(([pathKey, pathObj]) => {
        const methods = Object.keys(pathObj);
        for (const mKey of methods) {
          const method = mKey.toUpperCase();
          if (["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"].includes(method)) {
            const operationObj = pathObj[mKey];
            const tags = operationObj?.tags || [];
            const tag = tags.length > 0 ? String(tags[0]).trim() : "General";
            if (!tagGroups[tag]) tagGroups[tag] = [];
            tagGroups[tag].push(pathKey);
          }
        }
      });

      Object.entries(tagGroups).forEach(([tag, tagPaths]) => {
        const fullGroupName = `${parentGroup} / ${tag}`;
        const ruleName = tag;

        const strippedPaths = tagPaths.map(p => p.split('{')[0]);
        let prefix = strippedPaths[0];
        for (let i = 1; i < strippedPaths.length; i++) {
          while (strippedPaths[i].indexOf(prefix) !== 0) {
            prefix = prefix.substring(0, prefix.length - 1);
            if (prefix === "") break;
          }
        }
        
        const lastSlash = prefix.lastIndexOf('/');
        if (lastSlash > -1) {
          prefix = prefix.substring(0, lastSlash + 1);
        }

        const sourcePattern = `*://${prodHost}${prefix}*`;
        const targetUrl = `${localClean}${prefix}`;

        candidates.push({
          name: ruleName,
          group: fullGroupName,
          patternType: "wildcard",
          sourcePattern,
          targetUrl,
          swaggerPath: prefix || tag,
          method: "ALL",
          sourceAuth: false,
          sourceCookies: false,
          selected: true
        });
      });
    } else {
      // -------------------------------------------------------------------------
      // SIMPLE MODE: Generate exactly ONE wildcard rule candidate per unique path
      // -------------------------------------------------------------------------
      Object.entries(paths).forEach(([pathKey, pathObj]) => {
      // Find subgroup tag from operations on this path
      let subgroup = "General";
      const methods = Object.keys(pathObj);
      for (const mKey of methods) {
        const method = mKey.toUpperCase();
        if (["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"].includes(method)) {
          const operationObj = pathObj[mKey];
          const tags = operationObj?.tags || [];
          if (tags.length > 0) {
            subgroup = String(tags[0]).trim();
            break;
          }
        }
      }

      const fullGroupName = `${parentGroup} / ${subgroup}`;
      const ruleName = pathKey;

      // Make a clean wildcard pattern: strip dynamic parameters if any or just add *
      const paramMatches = pathKey.match(/\{[^}]+\}/g) || [];
      const hasParams = paramMatches.length > 0;
      
      let sourcePattern = "";
      let targetUrl = "";

      if (hasParams) {
        const firstParamIndex = pathKey.indexOf("{");
        const staticPart = pathKey.substring(0, firstParamIndex);
        sourcePattern = `*://${prodHost}${staticPart}*`;
        targetUrl = `${localClean}${staticPart}`;
      } else {
        sourcePattern = `*://${prodHost}${pathKey}*`;
        targetUrl = `${localClean}${pathKey}`;
      }

      candidates.push({
        name: ruleName,
        group: fullGroupName,
        patternType: "wildcard",
        sourcePattern,
        targetUrl,
        method: "ALL", // Method ALL shows it applies universally to all methods on the path
        swaggerPath: pathKey,
        subgroup
      });
      });
    }
  } else {
    // -------------------------------------------------------------------------
    // SPESIFIK MODE: Original behavior, one candidate for every single endpoint
    // -------------------------------------------------------------------------
    Object.entries(paths).forEach(([pathKey, pathObj]) => {
      // Loop through HTTP methods (get, post, put, delete, patch, etc.)
      Object.entries(pathObj).forEach(([methodKey, operationObj]) => {
        const method = methodKey.toUpperCase();
        if (!["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"].includes(method)) {
          return; // skip non-HTTP methods/objects like parameters
        }

        // 1. Get Swagger Tags for Subgrouping
        const tags = operationObj.tags || [];
        const subgroup = tags.length > 0 ? String(tags[0]).trim() : "General";
        const fullGroupName = `${parentGroup} / ${subgroup}`;

        // 2. Generate Rule Name
        const summary = operationObj.summary || operationObj.description || "";
        const ruleName = summary
          ? `[${method}] ${summary}`
          : `[${method}] ${pathKey}`;

        // 3. Process Path & Parameter Substitutions
        // Swagger parameters are defined in format: /path/to/{paramName}
        // Let's find all occurrences of {paramName}
        const paramMatches = pathKey.match(/\{[^}]+\}/g) || [];
        const hasParams = paramMatches.length > 0;

        let sourcePattern = "";
        let targetUrl = "";
        let patternType = "wildcard";

        // Under spesifik mode, we default each rule's format dropdown selection to Regex if params are present,
        // otherwise to Wildcard.
        if (hasParams) {
          patternType = "regex";
          // Replace each {paramName} with ([^\/]+)
          let regexPath = escapeRegex(pathKey);
          paramMatches.forEach((param) => {
            const escapedParam = escapeRegex(param);
            regexPath = regexPath.replace(escapedParam, "([^\\/]+)");
          });

          const escapedProdHost = escapeRegex(prodHost);
          sourcePattern = `^https?:\\/\\/${escapedProdHost}${regexPath}(?:\\?.*)?$`;

          // Generate targetUrl with $1, $2 replacements
          let targetPath = pathKey;
          paramMatches.forEach((param, index) => {
            targetPath = targetPath.replace(param, `$${index + 1}`);
          });
          targetUrl = `${localClean}${targetPath}`;
        } else {
          // No parameters, use a wildcard path matching
          patternType = "wildcard";
          sourcePattern = `*://${prodHost}${pathKey}*`;
          targetUrl = `${localClean}${pathKey}`;
        }

        // Push Candidate
        candidates.push({
          name: ruleName,
          group: fullGroupName,
          patternType,
          sourcePattern,
          targetUrl,
          method, // helper field for UI lists
          swaggerPath: pathKey, // helper field
          subgroup // helper field
        });
      });
    });
  }

  return candidates;
}
