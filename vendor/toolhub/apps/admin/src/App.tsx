import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Categories } from "./pages/Categories";
import { Runners } from "./pages/Runners";
import { Processes } from "./pages/Processes";
import { Logs } from "./pages/Logs";
import { Playground } from "./pages/Playground";
import { Sidebar } from "./components/Sidebar";
import { SettingsModal } from "./components/SettingsModal";
import { KeyRound, Lock } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { useI18n } from "./lib/i18n";

// Перехватываем fetch на уровне модуля до выполнения любых React-хуков
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;
  const url = typeof resource === 'string' ? resource : (resource instanceof URL ? resource.href : resource.url);

  if (url.includes('/admin/api/')) {
    config = config || {};
    const headers = new Headers(config.headers || {});
    const savedPass = localStorage.getItem('admin_password') || '';
    headers.set('x-admin-password', savedPass);
    config.headers = headers;
  }

  const response = await originalFetch(resource, config);

  if (response.status === 401 && url.includes('/admin/api/') && !url.includes('/admin/api/auth/verify')) {
    window.dispatchEvent(new Event('auth:unauthorized'));
  }

  return response;
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    () => !!localStorage.getItem('admin_password')
  );
  const [passwordInput, setPasswordInput] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const handleUnauthorized = () => setIsAuthenticated(false);
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/admin/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput })
      });

      if (res.ok) {
        localStorage.setItem('admin_password', passwordInput);
        setIsAuthenticated(true);
        toast.success(t("auth.granted"));
        window.location.reload();
      } else {
        toast.error(t("auth.invalid"));
      }
    } catch {
      toast.error(t("auth.network_error"));
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_password');
    setIsAuthenticated(false);
  };

  return (
    <BrowserRouter basename="/admin/">
      <Toaster position="top-right" />
      
      {!isAuthenticated && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <form onSubmit={handleLogin} className="bg-card border border-border p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center space-y-1">
              <div className="inline-flex p-3 bg-muted rounded-full text-foreground mb-2">
                <Lock className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-bold tracking-tight text-foreground">{t("auth.title")}</h2>
              <p className="text-xs text-muted-foreground">{t("auth.desc")}</p>
            </div>

            <div className="space-y-2">
              <Input 
                type="password" 
                placeholder={t("auth.placeholder")} 
                value={passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                className="h-9 text-center font-mono text-xs rounded-lg bg-background border-border"
                autoFocus
              />
              <Button type="submit" className="w-full h-9 font-semibold text-xs rounded-lg shadow-sm">
                <KeyRound className="h-4 w-4 mr-2" /> {t("auth.login")}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="h-screen w-screen bg-background flex flex-row overflow-hidden font-sans select-none">
        {/* Левый сайдбар */}
        <Sidebar onLogout={handleLogout} onOpenSettings={() => setIsSettingsOpen(true)} />

        {/* Правая рабочая область во всю высоту */}
        <main className="flex-1 h-full overflow-hidden select-text flex flex-col">
          <Routes>
            <Route path="/" element={<Categories />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/tools" element={<Categories />} />
            <Route path="/runners" element={<Runners />} />
            <Route path="/processes" element={<Processes />} />
            <Route path="/playground" element={<Playground />} />
            <Route path="/logs" element={<Logs />} />
          </Routes>
        </main>

        {/* Глобальная модалка настроек */}
        <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      </div>
    </BrowserRouter>
  );
}