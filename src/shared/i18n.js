const DEFAULT_LOCALE = "en";

let messages = {};
let loadedLocale = "";
let loadPromise = null;

export async function initI18n(locale = DEFAULT_LOCALE) {
  if (loadPromise && loadedLocale === locale) {
    return loadPromise;
  }

  loadedLocale = locale;
  loadPromise = loadMessages(locale)
    .then((loadedMessages) => {
      messages = loadedMessages;
      return messages;
    })
    .catch(() => {
      messages = {};
      return messages;
    });

  return loadPromise;
}

export function t(key, values = {}) {
  const template = messages[key] || key;

  return template.replace(/\{(\w+)\}/g, (_match, token) => String(values[token] ?? ""));
}

export function applyTranslations(root = document) {
  translateText(root, "[data-i18n]", "textContent");
  translateAttribute(root, "[data-i18n-title]", "title", "i18nTitle");
  translateAttribute(root, "[data-i18n-placeholder]", "placeholder", "i18nPlaceholder");
  translateAttribute(root, "[data-i18n-aria-label]", "aria-label", "i18nAriaLabel");
}

async function loadMessages(locale) {
  const path = `src/shared/locales/${locale}.json`;

  if (globalThis.chrome?.runtime?.getURL) {
    const response = await fetch(chrome.runtime.getURL(path));

    if (!response.ok) {
      throw new Error(`Unable to load locale: ${locale}`);
    }

    return response.json();
  }

  if (typeof window !== "undefined") {
    try {
      const response = await fetch(new URL(`./locales/${locale}.json`, import.meta.url));
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Fallback
    }
    return {};
  }

  try {
    const nodeFsSpecifier = "node:" + "fs/promises";
    const { readFile } = await import(nodeFsSpecifier);
    const fileUrl = new URL(`./locales/${locale}.json`, import.meta.url);

    return JSON.parse(await readFile(fileUrl, "utf8"));
  } catch {
    return {};
  }
}

function translateText(root, selector, propertyName) {
  getMatchingElements(root, selector).forEach((element) => {
    element[propertyName] = t(element.dataset.i18n);
  });
}

function translateAttribute(root, selector, attributeName, datasetName) {
  getMatchingElements(root, selector).forEach((element) => {
    element.setAttribute(attributeName, t(element.dataset[datasetName]));
  });
}

function getMatchingElements(root, selector) {
  const elements = root.querySelectorAll ? [...root.querySelectorAll(selector)] : [];

  return root.matches?.(selector) ? [root, ...elements] : elements;
}
