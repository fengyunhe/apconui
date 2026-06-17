import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import de from './locales/de.json';
import fr from './locales/fr.json';

const langMap: Record<string, string> = {
  zh: 'zh',
  en: 'en',
  ja: 'ja',
  de: 'de',
  fr: 'fr',
};

const getSystemLang = (): string => {
  const lang = navigator.language.toLowerCase();
  const shortLang = lang.split('-')[0];
  return langMap[shortLang] || 'zh';
};

const savedLang = localStorage.getItem('language') || getSystemLang();

i18n
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
      ja: { translation: ja },
      de: { translation: de },
      fr: { translation: fr },
    },
    lng: savedLang,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export const changeLanguage = (lng: string) => {
  i18n.changeLanguage(lng);
  localStorage.setItem('language', lng);
};

export default i18n;
