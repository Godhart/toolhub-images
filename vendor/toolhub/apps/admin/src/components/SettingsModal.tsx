import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { 
  ShieldCheck, Database, Save, Lock, Trash2, RefreshCw, X, Settings as SettingsIcon 
} from "lucide-react";
import { useI18n } from "../lib/i18n";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "prompt">("general");

  const [settings, setSettings] = useState({ 
    rootPrompt: "",
    rootAppendPrompt: "",
    agentSecret: "", 
    adminPassword: "",
    maxLogRetention: 1000 
  });

  const loadSettings = () => {
    setLoading(true);
    fetch("/admin/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setSettings({
          rootPrompt: data?.rootPrompt || "",
          rootAppendPrompt: data?.rootAppendPrompt || "",
          agentSecret: data?.agentSecret || "",
          adminPassword: data?.adminPassword || "admin",
          maxLogRetention: data?.maxLogRetention || 1000,
        });
        setLoading(false);
      })
      .catch(() => {
        toast.error("Error loading settings");
        setLoading(false);
      });
  };

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  // Закрытие по Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/admin/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          maxLogRetention: Number(settings.maxLogRetention) || 1000
        }),
      });

      if (res.ok) {
        if (settings.adminPassword) {
          localStorage.setItem('admin_password', settings.adminPassword);
        }
        toast.success(t("settings.saved_ok"));
        onClose();
      } else {
        toast.error("Error saving settings");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleClearLogs = async () => {
    if (!confirm(t("common.confirm_clear_logs"))) return;
    try {
      const res = await fetch("/admin/api/logs", { method: "DELETE" });
      if (res.ok) {
        toast.success(t("settings.all_cleared"));
      } else {
        toast.error("Failed to clear logs");
      }
    } catch {
      toast.error("Request error");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="fixed inset-0 bg-black/40" />
      
      <div 
        className="relative w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] z-10 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка модалки */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-primary/10 rounded-lg text-primary">
              <SettingsIcon className="w-4 h-4" />
            </div>
            <h2 className="font-bold text-sm text-foreground">
              {t("settings.title") || "Settings"}
            </h2>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={onClose}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Табы модалки */}
        <div className="px-4 pt-3 border-b border-border bg-muted/10 shrink-0 flex gap-2">
          <button
            onClick={() => setActiveTab("general")}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all ${
              activeTab === "general"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("settings.tab_general") || "General & Security"}
          </button>
          <button
            onClick={() => setActiveTab("prompt")}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === "prompt"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>{t("settings.tab_prompt") || "Root Prompt"}</span>
            <span className="text-[9px] font-mono bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.2 rounded-full border border-purple-500/20">
              System
            </span>
          </button>
        </div>

        {/* Тело модалки */}
        <div className="p-4 overflow-y-auto flex-1 min-h-[320px]">
          {loading ? (
            <div className="h-full min-h-[250px] flex items-center justify-center font-mono text-xs text-muted-foreground">
              <RefreshCw className="h-4 w-4 mr-2 animate-spin text-primary" /> {t("settings.loading")}
            </div>
          ) : activeTab === "general" ? (
            <div className="space-y-4">
              {/* Карточка Admin Auth */}
              <div className="border border-border rounded-xl p-3.5 bg-background space-y-2.5">
                <div className="text-xs font-bold uppercase text-foreground flex items-center gap-1.5 border-b border-border pb-2">
                  <Lock className="h-3.5 w-3.5 text-amber-500" /> {t("settings.admin_auth")}
                </div>

                <div className="space-y-1 pt-1">
                  <Label htmlFor="adminPass" className="text-[10px] font-bold uppercase text-muted-foreground">
                    {t("settings.admin_pass")}
                  </Label>
                  <Input 
                    id="adminPass"
                    type="password"
                    value={settings.adminPassword}
                    onChange={e => setSettings({ ...settings, adminPassword: e.target.value })}
                    placeholder="admin"
                    className="h-8 text-xs font-mono bg-background"
                  />
                  <span className="text-[9px] text-muted-foreground block">
                    {t("settings.admin_pass_desc")}
                  </span>
                </div>
              </div>

              {/* Карточка Agent Auth */}
              <div className="border border-border rounded-xl p-3.5 bg-background space-y-2.5">
                <div className="text-xs font-bold uppercase text-foreground flex items-center gap-1.5 border-b border-border pb-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> {t("settings.agent_auth")}
                </div>

                <div className="space-y-1 pt-1">
                  <Label htmlFor="agentSecret" className="text-[10px] font-bold uppercase text-muted-foreground">
                    {t("settings.agent_pass")}
                  </Label>
                  <Input 
                    id="agentSecret"
                    type="password"
                    value={settings.agentSecret}
                    onChange={e => setSettings({ ...settings, agentSecret: e.target.value })}
                    placeholder="123"
                    className="h-8 text-xs font-mono bg-background"
                  />
                  <span className="text-[9px] text-muted-foreground block">
                    {t("settings.agent_pass_desc")}
                  </span>
                </div>
              </div>

              {/* Карточка DB Retention */}
              <div className="border border-border rounded-xl p-3.5 bg-background space-y-3">
                <div className="text-xs font-bold uppercase text-foreground flex items-center gap-1.5 border-b border-border pb-2">
                  <Database className="h-3.5 w-3.5 text-blue-500" /> {t("settings.db_retention")}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="retention" className="text-[10px] font-bold uppercase text-muted-foreground">
                    {t("settings.max_logs")}
                  </Label>
                  <Input 
                    id="retention"
                    type="number"
                    value={settings.maxLogRetention}
                    onChange={e => setSettings({ ...settings, maxLogRetention: Number(e.target.value) })}
                    className="h-8 text-xs font-mono bg-background"
                  />
                  <span className="text-[9px] text-muted-foreground block">
                    {t("settings.max_logs_desc")}
                  </span>
                </div>

                <div className="pt-2 border-t border-border flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground font-medium">{t("settings.clear_history")}</span>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={handleClearLogs}
                    className="h-7 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border-rose-500/20 font-bold rounded-lg"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> {t("settings.clear_all_btn")}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full space-y-3">
              {/* Root Directory Context (appendPrompt for '/') */}
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400 flex items-center justify-between">
                  <span>{t("settings.root_nav_prompt")}</span>
                  <span className="text-[9px] font-mono text-muted-foreground lowercase">appendPrompt</span>
                </Label>
                <Input
                  value={settings.rootAppendPrompt}
                  onChange={e => setSettings({ ...settings, rootAppendPrompt: e.target.value })}
                  placeholder={t("settings.root_nav_placeholder")}
                  className="h-8 text-xs font-mono bg-background"
                />
                <span className="text-[9px] text-muted-foreground block">
                  {t("settings.root_nav_prompt_desc")}
                </span>
              </div>

              {/* System Protocol Prompt */}
              <div className="flex-1 flex flex-col space-y-1 min-h-[200px]">
                <Label className="text-[10px] font-bold uppercase text-purple-600 dark:text-purple-400 flex items-center justify-between">
                  <span>{t("settings.system_protocol_prompt")}</span>
                  <span className="text-[9px] font-mono text-muted-foreground lowercase">GET /prompt</span>
                </Label>
                <div className="flex-1 min-h-[190px]">
                  <Textarea 
                    value={settings.rootPrompt}
                    onChange={e => setSettings({ ...settings, rootPrompt: e.target.value })}
                    className="h-full min-h-[190px] w-full font-mono text-xs leading-relaxed p-3 resize-none border border-border rounded-xl bg-zinc-950 text-emerald-400 focus-visible:ring-1 focus-visible:ring-primary shadow-inner"
                    placeholder={t("settings.placeholder_prompt")}
                  />
                </div>
                <span className="text-[9px] text-muted-foreground block">
                  {t("settings.system_protocol_prompt_desc")}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Подвал модалки */}
        <div className="p-3.5 border-t border-border bg-muted/20 flex items-center justify-end gap-2 shrink-0">
          <Button size="sm" variant="ghost" onClick={onClose} className="h-8 text-xs rounded-lg">
            {t("common.cancel") || "Cancel"}
          </Button>
          <Button 
            size="sm" 
            onClick={handleSave} 
            disabled={saving} 
            className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-bold rounded-lg shadow-sm"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" /> {saving ? t("settings.saving") : t("settings.save_params")}
          </Button>
        </div>
      </div>
    </div>
  );
}