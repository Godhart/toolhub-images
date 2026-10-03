import React, { createContext, useContext, useState } from "react";
import en from "../locales/en.json";
import ru from "../locales/ru.json";
import zh from "../locales/zh.json";

export const AVAILABLE_LANGUAGES = ["en", "ru", "zh"] as const;
export type Language = (typeof AVAILABLE_LANGUAGES)[number];

type TranslationTree = Record<string, any>;

const dictionaries: Record<Language, TranslationTree> = {
  en,
  ru,
  zh
};

interface I18nContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (path: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

const getNestedValue = (obj: any, path: string): string | undefined => {
  return path.split(".").reduce((acc, part) => acc && acc[part], obj);
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem("toolhub_lang") as Language;
    return saved && AVAILABLE_LANGUAGES.includes(saved) ? saved : "ru";
  });

  const setLang = (newLang: Language) => {
    localStorage.setItem("toolhub_lang", newLang);
    setLangState(newLang);
  };

  const t = (path: string, params?: Record<string, string | number>): string => {
    const currentDict = dictionaries[lang];
    const fallbackDict = dictionaries["en"];

    let template = getNestedValue(currentDict, path) || getNestedValue(fallbackDict, path) || path;

    if (params && typeof template === "string") {
      Object.entries(params).forEach(([k, v]) => {
        template = template.replace(new RegExp(`{{${k}}}`, "g"), String(v));
      });
    }

    return template;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
};