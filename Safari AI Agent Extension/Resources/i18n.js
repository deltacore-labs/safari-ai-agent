// i18n.js — translation module for popup.js and background.js
let currentLang = "de";

export function setLanguage(lang) {
  currentLang = lang === "en" ? "en" : "de";
}

export function getLanguage() {
  return currentLang;
}

export function t(key, ...args) {
  const dict = TRANSLATIONS[currentLang] ?? TRANSLATIONS.de;
  let str = dict[key] ?? TRANSLATIONS.de[key] ?? key;
  args.forEach((val, i) => {
    str = str.replace(`%${i + 1}`, val);
  });
  return str;
}

export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll("[data-i18n-title]").forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
    el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
  });
}

const TRANSLATIONS = {
  de: {},
  en: {}
};
