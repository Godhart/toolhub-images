import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { 
  Search, RefreshCw, Trash2, CheckCircle2, XCircle, Terminal, 
  ChevronLeft, ChevronRight 
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/useTheme";

export function Logs() {
  const { t } = useI18n();
  const { monacoTheme } = useTheme();

  const [logs, setLogs] = useState<any[]>([]);
  const [selectedLog, setSelectedLog] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  // Состояния серверной пагинации и фильтрации
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");

  const loadLogs = async (targetPage = page, targetLimit = limit, targetSearch = search) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: targetPage.toString(),
        limit: targetLimit.toString(),
        search: targetSearch
      });

      const res = await fetch(`/admin/api/logs?${query}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data.logs) ? data.logs : []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        setPage(data.page || 1);

        if (data.logs.length > 0) {
          setSelectedLog(data.logs[0]);
        } else {
          setSelectedLog(null);
        }
      }
    } catch {
      toast.error(t("logs.err_fetch"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs(1, limit, search);
  }, [limit]);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    loadLogs(1, limit, val);
  };

  const formatJson = (data: any): string => {
    if (data === undefined) return "";
    if (typeof data === "string") return data;
    try {
      return JSON.stringify(data, null, 2) ?? "";
    } catch {
      return String(data);
    }
  };

  const clearLogs = async () => {
    if (!confirm(t("common.confirm_clear_logs"))) return;
    try {
      const res = await fetch("/admin/api/logs", { method: "DELETE" });
      if (res.ok) {
        toast.success(t("logs.cleared"));
        setLogs([]);
        setSelectedLog(null);
        setTotal(0);
        setTotalPages(1);
        setPage(1);
      } else {
        toast.error(t("logs.err_clear"));
      }
    } catch {
      toast.error(t("logs.err_clear"));
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Шапка */}
      <div className="h-[74.4px] min-h-[74.4px] max-h-[74.4px] px-6 border-b border-border flex items-center justify-between shrink-0 box-border">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2.5 py-1 rounded-full border border-blue-500/20 font-bold">
            {t("logs.entries", { count: total })}
          </span>

          {/* Селектор количества записей на страницу */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
            <span>{t("logs.per_page")}</span>
            <select
              value={limit}
              onChange={e => {
                const newLimit = parseInt(e.target.value);
                setLimit(newLimit);
              }}
              className="h-7 text-xs font-mono border border-border rounded-md bg-background px-1.5 text-foreground focus:outline-none"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="500">500</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input 
              placeholder={t("common.filter_path")} 
              className="pl-8 h-8 text-xs font-mono rounded-lg" 
              value={search} 
              onChange={e => handleSearchChange(e.target.value)} 
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => loadLogs()} className="h-8 text-xs rounded-lg">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> {t("common.refresh")}
          </Button>
          <Button variant="ghost" size="sm" onClick={clearLogs} className="h-8 text-destructive hover:bg-destructive/10 rounded-lg" title={t("common.clear")}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Рабочая область */}
      <div className="p-4 flex-1 overflow-hidden min-h-0">
        <div className="grid grid-cols-12 gap-4 h-full">
          {/* Левый список логов */}
          <div className="col-span-5 border border-border rounded-xl overflow-hidden flex flex-col bg-card">
            <div className="bg-muted/40 p-2.5 text-[10px] font-mono uppercase font-bold text-muted-foreground border-b border-border flex justify-between shrink-0">
              <span>{t("logs.recent")}</span>
              <span>{t("logs.status_time")}</span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-border text-xs">
              {logs.map(log => (
                <div 
                  key={log.id} 
                  onClick={() => setSelectedLog(log)}
                  className={`p-2.5 cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                    selectedLog?.id === log.id 
                      ? "bg-blue-500/15 border-l-4 border-l-blue-600 text-foreground" 
                      : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {log.success ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="font-mono font-bold truncate text-[11px] text-foreground">{log.path}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {new Date(log.createdAt).toLocaleTimeString()} • {log.callerIp}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded font-semibold text-foreground border border-border">
                      {log.durationMs}ms
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Пагинатор списка */}
            <div className="p-2 border-t border-border bg-muted/30 flex items-center justify-between text-xs font-mono shrink-0">
              <span className="text-[10px] text-muted-foreground font-semibold">
                {t("logs.page_info", { page, totalPages })}
              </span>
              <div className="flex items-center gap-1">
                <Button 
                  size="icon" 
                  variant="outline" 
                  disabled={page <= 1 || loading}
                  onClick={() => loadLogs(page - 1)}
                  className="h-6 w-6 rounded"
                  title={t("logs.prev_page")}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button 
                  size="icon" 
                  variant="outline" 
                  disabled={page >= totalPages || loading}
                  onClick={() => loadLogs(page + 1)}
                  className="h-6 w-6 rounded"
                  title={t("logs.next_page")}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Правая деталка лога */}
          <div className="col-span-7 border border-border rounded-xl overflow-hidden flex flex-col bg-card">
            {selectedLog ? (
              <div className="flex flex-col h-full">
                <div className="bg-muted/40 p-3 border-b border-border flex items-center justify-between shrink-0">
                  <div>
                    <div className="font-mono font-bold text-sm flex items-center gap-2 text-foreground">
                      <Terminal className="h-4 w-4 text-blue-500" /> {selectedLog.path}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                      ID: {selectedLog.id} • {new Date(selectedLog.createdAt).toLocaleString()} • Duration: {selectedLog.durationMs}ms
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase border ${
                    selectedLog.success 
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" 
                      : "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30"
                  }`}>
                    {selectedLog.success ? "Success" : "Failed"}
                  </span>
                </div>

                <div className="flex-1 flex flex-col p-3.5 gap-3 overflow-y-auto font-mono text-xs">
                  {selectedLog.error && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl text-xs leading-relaxed">
                      <strong>{t("logs.error_details")}</strong> {selectedLog.error}
                    </div>
                  )}

                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">{t("logs.payload_input")}</span>
                    <div className="border border-border rounded-lg overflow-hidden bg-background">
                      <Editor 
                        height="140px" 
                        defaultLanguage="json" 
                        theme={monacoTheme} 
                        value={formatJson(selectedLog.payload)} 
                        options={{ readOnly: true, minimap: { enabled: false }, fontSize: 11, lineNumbers: 'off' }} 
                      />
                    </div>
                  </div>

                  <div className="space-y-1 flex-1 flex flex-col min-h-[200px]">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">{t("logs.kernel_response")}</span>
                    <div className="border border-border rounded-lg overflow-hidden flex-1 bg-background">
                      <Editor 
                        height="100%" 
                        defaultLanguage="json" 
                        theme={monacoTheme} 
                        value={formatJson(selectedLog.result)} 
                        options={{ readOnly: true, minimap: { enabled: false }, fontSize: 11, lineNumbers: 'off' }} 
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs font-mono">
                {t("logs.empty_select")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}