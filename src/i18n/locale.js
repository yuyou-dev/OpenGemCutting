import { createTranslator, LANGUAGE_CHOICES, resolveLocale } from './format.js';

export const LANGUAGE_STORAGE_KEY = 'facet96.language';
let preference = 'system';
let languages = [];
let locale = 'zh-CN';
let translate = createTranslator(locale);
const listeners = new Set();
export const getLocale = () => locale;
export const getLanguagePreference = () => preference;
export const t = (source, values) => translate(source, values);
export const subscribeLocale = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

function browserStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}
export function setLanguagePreference(value, storage = browserStorage()) {
  if (!LANGUAGE_CHOICES.includes(value)) return;
  preference = value;
  locale = resolveLocale(preference, languages);
  translate = createTranslator(locale);
  try { storage?.setItem(LANGUAGE_STORAGE_KEY, preference); } catch { /* Preference still works without storage. */ }
  listeners.forEach((listener) => listener());
}
export function initializeLocale({ storage = browserStorage(), browserLanguages = [] } = {}) {
  languages = browserLanguages;
  let saved;
  try { saved = storage?.getItem(LANGUAGE_STORAGE_KEY); } catch { /* Storage may be denied. */ }
  setLanguagePreference(LANGUAGE_CHOICES.includes(saved) ? saved : 'system', storage);
}
