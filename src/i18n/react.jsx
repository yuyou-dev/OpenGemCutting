import { useSyncExternalStore } from 'react';
import { getLanguagePreference, getLocale, subscribeLocale } from './locale.js';

export function useLocale() {
  useSyncExternalStore(subscribeLocale, () => `${getLanguagePreference()}:${getLocale()}`);
  return getLocale();
}
