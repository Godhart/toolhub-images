import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  FolderTree, Cpu, Layers, PlaySquare, Activity, Settings as SettingsIcon, 
  Languages, LogOut, Sun, Moon
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import settings from '../App.json';
import packageJson from '../../../../package.json';

interface SidebarProps {
  onLogout: () => void;
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onLogout, onOpenSettings }) => {
  const { t, lang, setLang } = useI18n();
  const location = useLocation();
  const [totalTools, setTotalTools] = useState<number>(0);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(true);

  // Инициализация темы из localStorage или системной настройки
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const banners = settings.banners || [];
  const displayBanners = banners.length > 1 ? [...banners, banners[0]] : banners;

  // Подсчёт инструментов
  useEffect(() => {
    fetch('/admin/api/tools')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setTotalTools(data.length);
      })
      .catch(() => {});
  }, []);

  // Таймер карусели
  useEffect(() => {
    if (banners.length <= 1 || isPaused) return;
    const interval = setInterval(() => {
      setIsTransitioning(true);
      setCurrentBannerIndex((prev) => (prev >= banners.length ? 1 : prev + 1));
    }, 11000);
    return () => clearInterval(interval);
  }, [banners.length, isPaused]);

  // Бесшовный сброс слайдов
  useEffect(() => {
    if (currentBannerIndex === banners.length) {
      const timer = setTimeout(() => {
        setIsTransitioning(false);
        setCurrentBannerIndex(0);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [currentBannerIndex, banners.length]);

  const links = [
    { path: "/", label: t("nav.skills"), icon: FolderTree },
    { path: "/runners", label: t("nav.runners"), icon: Cpu },
    { path: "/processes", label: t("nav.processes"), icon: Layers },
    { path: "/playground", label: t("nav.playground"), icon: PlaySquare },
    { path: "/logs", label: t("nav.logs"), icon: Activity },
  ];

  return (
    <div className="w-80 bg-card border-r border-border flex flex-col h-full text-foreground select-none shrink-0 transition-all duration-300 ease-in-out relative">
      {/* Шапка боковой панели */}
      <div className="h-[74.4px] min-h-[74.4px] max-h-[74.4px] px-5 border-b border-border flex items-center justify-between shrink-0 min-w-[320px] box-border">
        <div className="flex items-center gap-2">
          <span className="font-bold text-xl tracking-tight text-foreground">
            🛠️ toolhub
          </span>
        </div>
        <div className="flex items-center gap-1">
          <a
            href={settings.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent hover:border-border transition-all"
            title={t('sidebar.github_repo')}
          >
            <img 
              src={theme === 'dark' ? 'GitHub_Invertocat_White.svg' : 'GitHub_Invertocat_Black.svg'} 
              className="w-4 h-4" 
              alt="GitHub"
            />
          </a>

          {/* Языковой селектор */}
          <div 
            className="relative p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent hover:border-border transition-all cursor-pointer"
            title="Change language / Сменить язык / 切换语言"
          >
            <Languages className="w-4 h-4 shrink-0" />
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as any)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              title="Change language / Сменить язык / 切换语言"
            >
              <option value="en" className="bg-card text-foreground font-sans">English</option>
              <option value="ru" className="bg-card text-foreground font-sans">Русский</option>
              <option value="zh" className="bg-card text-foreground font-sans">中文 (简体)</option>
            </select>
          </div>

          {/* Переключатель темы */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent hover:border-border transition-all"
            title={theme === 'dark' ? t('sidebar.theme_light') : t('sidebar.theme_dark')}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Кнопка открытия модалки настроек */}
          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent hover:border-border transition-all"
            title={t('nav.settings') || "Settings"}
          >
            <SettingsIcon className="w-4 h-4" />
          </button>

          {/* Выход */}
          <button
            onClick={onLogout}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 transition-all"
            title={t('nav.logout')}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Список разделов навигации */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1 min-w-[320px]">
        {links.map((l) => {
          const isActive = location.pathname === l.path || (l.path === "/" && location.pathname === "/categories");
          return (
            <Link
              key={l.path}
              to={l.path}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all border ${
                isActive
                  ? 'bg-muted border-border text-foreground font-medium shadow-sm'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <l.icon
                className={`w-4 h-4 shrink-0 ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
              />
              <span className="text-xs truncate">{l.label}</span>
            </Link>
          );
        })}
      </div>

      {/* Баннерная бесконечная карусель */}
      {banners.length > 0 && (
        <div
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          className="mx-4 mb-4 relative overflow-hidden rounded-xl h-[155px] min-w-[288px] shrink-0"
        >
          <div
            className={`flex h-full ${
              isTransitioning
                ? 'transition-transform duration-1000 ease-[cubic-bezier(0.25,1,0.5,1)]'
                : 'transition-none'
            }`}
            style={{ transform: `translateX(-${currentBannerIndex * 100}%)` }}
          >
            {displayBanners.map((banner, idx) => {
              const isCyanTheme = banner.theme === 'cyan';
              const activeDotIndex = currentBannerIndex % banners.length;
              return (
                <div
                  key={idx}
                  onClick={() => window.open(banner.link, '_blank')}
                  className={`w-full h-full shrink-0 p-3.5 border rounded-xl flex flex-col justify-between shadow-sm relative overflow-hidden group cursor-pointer select-none ${
                    isCyanTheme
                      ? 'bg-gradient-to-br from-cyan-500/10 via-teal-500/5 to-blue-500/10 dark:from-cyan-950/30 dark:via-teal-950/20 dark:to-blue-950/30 border-cyan-500/20 dark:border-cyan-500/30 shadow-cyan-500/5 hover:border-cyan-500/40'
                      : 'bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-pink-500/10 dark:from-violet-950/30 dark:via-fuchsia-950/20 dark:to-pink-950/30 border-violet-500/20 dark:border-violet-500/30 shadow-violet-500/5 hover:border-violet-500/40'
                  }`}
                >
                  <div
                    className={`absolute -right-8 -top-8 w-24 h-24 rounded-full blur-xl transition-opacity duration-1000 pointer-events-none ${
                      isCyanTheme
                        ? 'bg-cyan-500/15 group-hover:bg-cyan-500/25'
                        : 'bg-violet-500/15 group-hover:bg-violet-500/25'
                    }`}
                  />

                  <div className="flex items-center justify-between relative z-10 shrink-0">
                    <span
                      className={`text-[9px] font-extrabold tracking-wider uppercase px-2 py-0.5 rounded border ${
                        isCyanTheme
                          ? 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/15 dark:bg-cyan-500/25 border-cyan-500/20'
                          : 'text-violet-600 dark:text-violet-400 bg-violet-500/15 dark:bg-violet-500/25 border-violet-500/20'
                      }`}
                    >
                      {t(banner.badgeKey)}
                    </span>
                    <span className="text-[9px] text-muted-foreground/80 font-semibold tracking-tight">
                      {banner.subdomain || 'toolhub.dev'}
                    </span>
                  </div>

                  <div className="relative z-10 flex-1 flex items-start py-1 overflow-hidden">
                    <p className="text-[11px] text-foreground/85 dark:text-foreground/90 leading-snug font-sans">
                      {t(banner.textKey)}
                    </p>
                  </div>

                  <div className="flex items-center justify-between relative z-10 shrink-0 pt-1.5 border-t border-border/20">
                    <a
                      href={banner.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-[11px] font-bold flex items-center gap-1 transition-colors ${
                        isCyanTheme
                          ? 'text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300'
                          : 'text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300'
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t(banner.linkTextKey)}
                    </a>

                    {banners.length > 1 && (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {banners.map((_, dotIdx) => (
                          <button
                            key={dotIdx}
                            onClick={() => {
                              setIsTransitioning(true);
                              setCurrentBannerIndex(dotIdx);
                            }}
                            className={`h-1.5 rounded-full transition-all duration-500 ${
                              dotIdx === activeDotIndex
                                ? isCyanTheme
                                  ? 'w-4 bg-cyan-500'
                                  : 'w-4 bg-violet-500'
                                : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60'
                            }`}
                            title={`Slide ${dotIdx + 1}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Футер боковой панели */}
      <div className="p-4 border-t border-border bg-card text-[10px] text-muted-foreground flex justify-between items-center min-w-[320px]">
        <span>{t('sidebar.total_tools', { count: totalTools })}</span>
        <a
          href={settings.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors font-semibold flex items-center gap-1.5"
        >
          <img 
            src={theme === 'dark' ? 'GitHub_Invertocat_White.svg' : 'GitHub_Invertocat_Black.svg'} 
            className="w-3.5 h-3.5" 
            alt="GitHub"
          />
          <span>GitHub</span>
        </a>
        <span 
          className="px-1.5 py-0.5 rounded-md font-mono text-[11px] font-bold bg-green-500/10 text-green-500 border border-green-500/30 tracking-tight"
        >
          v{packageJson.version}
        </span>
      </div>
    </div>
  );
};