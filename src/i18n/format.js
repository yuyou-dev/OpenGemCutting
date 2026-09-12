import english from './en.json' with { type: 'json' };

export const LANGUAGE_CHOICES = ['system', 'zh-CN', 'en'];
export function resolveLocale(preference = 'system', languages = []) {
  if (preference === 'zh-CN' || preference === 'en') return preference;
  const language = languages.find(Boolean) ?? 'en';
  return /^zh(?:-|$)/i.test(language) ? 'zh-CN' : 'en';
}

const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Match complete registered diagnostic templates only; never replace words in user text.
const templates = Object.keys(english).filter((key) => /\{\d+\}/.test(key)).map((key) => {
  const slots = [...key.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1]));
  const expression = key.split(/\{\d+\}/).map(escapePattern).join('([\\s\\S]*?)');
  return { key, slots, pattern: new RegExp(`^${expression}$`), weight: key.replace(/\{\d+\}/g, '').length };
}).sort((a, b) => b.weight - a.weight);

export function createTranslator(locale) {
  const translate = (source, values) => {
    if (typeof source !== 'string') return source;
    let key = source;
    let slots = values;
    if (locale === 'en' && !Object.hasOwn(english, key) && /[\u3400-\u9fff]/.test(key)) {
      for (const template of templates) {
        const match = template.pattern.exec(source);
        if (!match) continue;
        key = template.key;
        slots = [];
        template.slots.forEach((slot, index) => { slots[slot] = match[index + 1]; });
        break;
      }
    }
    const message = locale === 'en' ? (english[key] ?? key) : key;
    return slots ? message.replace(/\{(\d+)\}/g, (token, index) => slots[index] ?? token) : message;
  };
  return translate;
}
export { english };
