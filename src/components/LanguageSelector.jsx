import { IconLanguage } from '@tabler/icons-react';
import { useLocale } from '../i18n/react.jsx';
import { getLanguagePreference, setLanguagePreference } from '../i18n/locale.js';
import './language-selector.css';

export function LanguageSelector() {
  const locale = useLocale();
  return (
    <label className="language-selector">
      <IconLanguage size={16} stroke={1.6} aria-hidden="true" />
      <select aria-label="界面语言 / Interface language" value={getLanguagePreference()} onChange={(event) => setLanguagePreference(event.target.value)}>
        <option value="system">{locale === 'en' ? 'System language' : '跟随系统'}</option>
        <option value="zh-CN">简体中文</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
