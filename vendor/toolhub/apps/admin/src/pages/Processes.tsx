import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Cpu, Trash2, RefreshCw, Activity, Clock, Layers } from "lucide-react";
import { useI18n } from "../lib/i18n";

interface PoolProcess {
  catId: number;
  pid: number;
  idleSec: number;
  pendingRequests: number;
}

export function Processes() {
  const { t } = useI18n();
  const [processes, setProcesses] = useState<PoolProcess[]>([]);
  const [loading, setLoading] = useState(false);

  const loadProcesses = async (isManual = false) => {
    if (isManual) setLoading(true);
    try {
      const res = await fetch("/admin/api/mcp/pool");
      if (res.ok) {
        const data = await res.json();
        setProcesses(Array.isArray(data) ? data : []);
      }
    } catch {
      if (isManual) toast.error("Error loading process list");
    } finally {
      if (isManual) setLoading(false);
    }
  };

  useEffect(() => {
    loadProcesses(false);
    const interval = setInterval(() => loadProcesses(false), 5000);
    return () => clearInterval(interval);
  }, []);

  const killProcess = async (catId: number) => {
    if (!confirm(t("common.confirm_kill_process") || "Stop this MCP process?")) return;
    try {
      const res = await fetch(`/admin/api/mcp/pool/${catId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(t("processes.stopped", { id: catId }));
        loadProcesses(false);
      } else {
        toast.error(t("processes.stop_failed"));
      }
    } catch {
      toast.error("Network error stopping process");
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Шапка */}
      <div className="h-[74.4px] min-h-[74.4px] max-h-[74.4px] px-6 border-b border-border flex items-center justify-between shrink-0 box-border">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono bg-purple-500/10 text-purple-600 dark:text-purple-400 px-2.5 py-1 rounded-full border border-purple-500/20 font-bold">
            {t("processes.active")}: {processes.length}
          </span>
          <p className="text-muted-foreground text-xs hidden sm:block">
            {t("processes.desc")}
          </p>
        </div>
        <Button onClick={() => loadProcesses(true)} variant="outline" size="sm" className="h-8 text-xs rounded-lg">
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> {t("common.refresh")}
        </Button>
      </div>

      {/* Рабочая область */}
      <div className="p-4 flex-1 overflow-y-auto min-h-0 space-y-4">
        {processes.length === 0 ? (
          <div className="h-full border border-dashed border-border rounded-xl flex flex-col items-center justify-center p-8 text-center bg-card">
            <Layers className="h-10 w-10 text-muted-foreground/40 mb-3 animate-pulse" />
            <p className="text-sm font-bold text-foreground">{t("processes.empty")}</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              {t("processes.empty_desc")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {processes.map((proc) => (
              <Card key={proc.catId} className="border border-border rounded-xl overflow-hidden shadow-sm bg-card hover:border-border/80 transition-all">
                <CardHeader className="bg-muted/40 border-b border-border p-3.5 flex flex-row items-center justify-between space-y-0">
                  <div className="min-w-0 pr-2">
                    <CardTitle className="text-sm font-bold truncate flex items-center gap-1.5 text-foreground">
                      <Cpu className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                      {t("processes.category_id", { id: proc.catId })}
                    </CardTitle>
                    <CardDescription className="font-mono text-[11px] mt-0.5 text-muted-foreground">
                      PID: <span className="font-bold text-foreground">{proc.pid}</span>
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:bg-destructive/10 shrink-0 rounded-lg"
                    onClick={() => killProcess(proc.catId)}
                    title={t("common.delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </CardHeader>
                <CardContent className="p-3.5 grid grid-cols-2 gap-3 text-xs font-mono">
                  <div className="flex items-center gap-2.5 bg-muted/40 p-2.5 rounded-lg border border-border">
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[9px] text-muted-foreground uppercase font-sans font-bold truncate">
                        {t("processes.idle")}
                      </div>
                      <div className="font-bold truncate text-foreground">
                        {proc.idleSec} {t("processes.seconds")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 bg-purple-500/10 p-2.5 rounded-lg border border-purple-500/20">
                    <Activity className="h-4 w-4 text-purple-600 dark:text-purple-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[9px] text-purple-600 dark:text-purple-400 uppercase font-sans font-bold truncate">
                        {t("processes.queue")}
                      </div>
                      <div className="font-bold truncate text-purple-700 dark:text-purple-300">
                        {proc.pendingRequests}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}