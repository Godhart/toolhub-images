import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { 
  Plus, Terminal, Trash2, Save, HelpCircle, Info,
  Code, Package, Play, FileCode, Sparkles
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/useTheme";

interface RunnerConfig {
  runCmd: string;
  codeFileName: string;
  installCmd?: string;
  depFileName?: string;
}

const RUNNER_TEMPLATES = [
  {
    id: 'bun',
    title: "Bun / Node.js (TS/JS)",
    type: "bun_local",
    desc: "TypeScript & JavaScript via Bun runtime",
    config: { runCmd: "bun run index.ts", codeFileName: "index.ts", installCmd: "bun install", depFileName: "package.json" }
  },
  {
    id: 'python',
    title: "Python 3 (Pip)",
    type: "python_local",
    desc: "Python scripts with virtual package resolution",
    config: { runCmd: "python3 main.py", codeFileName: "main.py", installCmd: "pip install -r requirements.txt", depFileName: "requirements.txt" }
  },
  {
    id: 'go',
    title: "Go (Golang)",
    type: "go_local",
    desc: "Compile and execute Go modules",
    config: { runCmd: "go run main.go", codeFileName: "main.go", installCmd: "go mod tidy", depFileName: "go.mod" }
  },
  {
    id: 'php',
    title: "PHP CLI (Composer)",
    type: "php_local",
    desc: "PHP scripts execution with Composer",
    config: { runCmd: "php index.php", codeFileName: "index.php", installCmd: "composer install", depFileName: "composer.json" }
  },
  {
    id: 'bash',
    title: "Bash / Shell Script",
    type: "bash_local",
    desc: "Pure Linux command line scripts",
    config: { runCmd: "bash script.sh", codeFileName: "script.sh" }
  },
  {
    id: 'cpp',
    title: "C++ (GCC Compiler)",
    type: "cpp_local",
    desc: "Compile with g++ and instant binary run",
    config: { runCmd: "g++ tool.cpp -o tool && ./tool", codeFileName: "tool.cpp" }
  }
];

export function Runners() {
  const { t } = useI18n();
  const { monacoTheme } = useTheme();

  const [runners, setRunners] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [isRawJsonMode, setIsRawJsonMode] = useState(false);

  const [form, setForm] = useState({ 
    name: "", 
    type: "", 
    runCmd: "bun run index.ts",
    codeFileName: "index.ts",
    installCmd: "bun install",
    depFileName: "package.json",
    rawJson: "{}"
  });

  const load = async () => {
    try {
      const res = await fetch("/admin/api/runners");
      if (res.ok) {
        const data = await res.json();
        setRunners(Array.isArray(data) ? data : []);
      } else {
        toast.error("Error loading runners");
      }
    } catch {
      toast.error("Network error loading runners");
    }
  };

  useEffect(() => { load(); }, []);

  const selectTemplate = (template: typeof RUNNER_TEMPLATES[0]) => {
    setForm({
      name: template.title,
      type: template.type,
      runCmd: template.config.runCmd || "",
      codeFileName: template.config.codeFileName || "",
      installCmd: template.config.installCmd || "",
      depFileName: template.config.depFileName || "",
      rawJson: JSON.stringify(template.config, null, 2)
    });
    toast.info(t("runners.preset_applied", { title: template.title }));
  };

  const startEdit = (runner: any) => {
    setEditingId(runner.id);
    const cfg: RunnerConfig = runner.config || {};
    setForm({
      name: runner.name,
      type: runner.type,
      runCmd: cfg.runCmd || "",
      codeFileName: cfg.codeFileName || "",
      installCmd: cfg.installCmd || "",
      depFileName: cfg.depFileName || "",
      rawJson: JSON.stringify(cfg, null, 2)
    });
  };

  const resetForm = () => {
    setEditingId(null);
    selectTemplate(RUNNER_TEMPLATES[0]);
  };

  const toggleRawMode = () => {
    if (!isRawJsonMode) {
      // Переходим в JSON-режим: собираем текущие инпуты в JSON
      const currentConfig: RunnerConfig = {
        runCmd: form.runCmd,
        codeFileName: form.codeFileName,
        installCmd: form.installCmd || undefined,
        depFileName: form.depFileName || undefined,
      };
      setForm(prev => ({ ...prev, rawJson: JSON.stringify(currentConfig, null, 2) }));
    } else {
      // Возвращаемся из JSON-режима: разбираем JSON по инпутам
      try {
        const parsed = JSON.parse(form.rawJson);
        setForm(prev => ({
          ...prev,
          runCmd: parsed.runCmd || prev.runCmd,
          codeFileName: parsed.codeFileName || prev.codeFileName,
          installCmd: parsed.installCmd || "",
          depFileName: parsed.depFileName || ""
        }));
      } catch {
        toast.error("Invalid JSON format");
        return;
      }
    }
    setIsRawJsonMode(!isRawJsonMode);
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t("common.confirm_delete_runner"))) return;
    try {
      const res = await fetch(`/admin/api/runners/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success("Runner deleted");
        if (editingId === id) resetForm();
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Error deleting runner");
      }
    } catch {
      toast.error("Network error deleting runner");
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.type) return toast.error("Name and type required");

    let finalConfig: RunnerConfig;

    if (isRawJsonMode) {
      try {
        finalConfig = JSON.parse(form.rawJson);
      } catch (e: any) {
        return toast.error("JSON syntax error: " + e.message);
      }
    } else {
      if (!form.runCmd || !form.codeFileName) {
        return toast.error("Code file name and Run command are required!");
      }
      finalConfig = {
        runCmd: form.runCmd,
        codeFileName: form.codeFileName,
        installCmd: form.installCmd || undefined,
        depFileName: form.depFileName || undefined,
      };
    }

    const url = editingId ? `/admin/api/runners/${editingId}` : "/admin/api/runners";
    const method = editingId ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name: form.name, 
          type: form.type, 
          config: finalConfig 
        })
      });

      if (res.ok) {
        toast.success(editingId ? t("runners.updated") : t("runners.created"));
        resetForm();
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Error saving runner");
      }
    } catch {
      toast.error("Network error saving runner");
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Шапка страницы */}
      <div className="h-[74.4px] min-h-[74.4px] max-h-[74.4px] px-6 border-b border-border flex items-center justify-end shrink-0 box-border">
        <div className="flex items-center gap-2">
          <Button 
            size="sm" 
            variant="ghost" 
            onClick={() => setShowHelp(!showHelp)} 
            className="h-8 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 rounded-lg"
          >
            <HelpCircle className="h-3.5 w-3.5 mr-1.5" /> {showHelp ? t("runners.hide_help") : t("runners.how_it_works")}
          </Button>
          <Button size="sm" variant="outline" onClick={resetForm} className="h-8 text-xs rounded-lg">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> {t("runners.new")}
          </Button>
          <Button size="sm" onClick={handleSave} className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-bold rounded-lg shadow-sm">
            <Save className="h-3.5 w-3.5 mr-1.5" /> {editingId ? t("runners.save") : t("runners.create")}
          </Button>
        </div>
      </div>

      {/* Рабочая область */}
      <div className="p-4 flex-1 overflow-hidden min-h-0 flex flex-col gap-3">
        {showHelp && (
          <div className="p-3.5 bg-blue-500/10 border border-blue-500/20 rounded-xl space-y-2.5 text-xs shrink-0 animate-in fade-in duration-200">
            <div className="flex justify-between items-center font-bold text-foreground">
              <span className="flex items-center gap-1.5 uppercase tracking-wider text-[11px] text-blue-600 dark:text-blue-400">
                <Info className="h-4 w-4" /> {t("runners.lifecycle_title")}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setShowHelp(false)} className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground">
                ✕
              </Button>
            </div>
            
            <div className="grid grid-cols-4 gap-2 font-mono text-[10px]">
              <div className="p-2.5 bg-card rounded-lg border border-border space-y-1">
                <span className="font-bold text-blue-600 dark:text-blue-400 block">{t("runners.step1_box")}</span>
                <p className="text-muted-foreground leading-tight">{t("runners.step1_desc")}</p>
              </div>
              <div className="p-2.5 bg-card rounded-lg border border-border space-y-1">
                <span className="font-bold text-blue-600 dark:text-blue-400 block">{t("runners.step2_box")}</span>
                <p className="text-muted-foreground leading-tight">{t("runners.step2_desc")}</p>
              </div>
              <div className="p-2.5 bg-card rounded-lg border border-border space-y-1">
                <span className="font-bold text-blue-600 dark:text-blue-400 block">{t("runners.step3_box")}</span>
                <p className="text-muted-foreground leading-tight">{t("runners.step3_desc")}</p>
              </div>
              <div className="p-2.5 bg-card rounded-lg border border-border space-y-1">
                <span className="font-bold text-blue-600 dark:text-blue-400 block">{t("runners.step4_box")}</span>
                <p className="text-muted-foreground leading-tight">{t("runners.step4_desc")}</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
          {/* Левый блок со списком раннеров и пресетами */}
          <div className="col-span-4 border border-border rounded-xl flex flex-col bg-card overflow-hidden">
            <div className="p-2.5 border-b border-border bg-muted/40 text-xs font-bold uppercase text-muted-foreground">
              {t("runners.saved")}
            </div>
            
            <div className="flex-1 overflow-y-auto divide-y divide-border p-2 space-y-1">
              {runners.map(r => (
                <div 
                  key={r.id} 
                  onClick={() => startEdit(r)}
                  className={`p-2 rounded-lg border text-xs cursor-pointer transition-colors flex items-center justify-between ${
                    editingId === r.id 
                      ? "bg-emerald-500/15 border-emerald-500/40 font-bold text-foreground" 
                      : "hover:bg-muted/50 bg-card border-border"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Terminal className="h-4 w-4 text-emerald-500 shrink-0" />
                    <div className="truncate">
                      <div className="text-xs truncate">{r.name}</div>
                      <div className="text-[9px] font-mono text-muted-foreground truncate">{r.type}</div>
                    </div>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6 text-destructive hover:bg-destructive/10 shrink-0 rounded" 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(r.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="p-2.5 border-t border-border bg-muted/20 space-y-2 shrink-0">
              <div className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" /> {t("runners.quick_setup")}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {RUNNER_TEMPLATES.map(item => (
                  <button
                    key={item.id}
                    onClick={() => selectTemplate(item)}
                    className="text-[10px] text-left bg-background border border-border hover:border-emerald-500/50 rounded-lg p-2 transition-colors shadow-sm"
                  >
                    <div className="font-bold text-foreground truncate">{item.title}</div>
                    <div className="text-[8px] text-muted-foreground truncate">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Правый блок редактирования */}
          <div className="col-span-8 border border-border rounded-xl flex flex-col bg-card overflow-hidden p-3.5 gap-3 overflow-y-auto">
            <div className="flex justify-between items-center border-b border-border pb-2 shrink-0">
              <div className="font-bold text-xs uppercase text-foreground flex items-center gap-1.5">
                <Code className="h-4 w-4 text-emerald-500" /> 
                <span>{editingId ? t("runners.edit_title", { id: editingId }) : t("runners.new_title")}</span>
              </div>

              <button
                onClick={toggleRawMode}
                className="text-[10px] font-mono text-muted-foreground hover:text-foreground underline transition-colors"
              >
                {isRawJsonMode ? t("runners.form_mode") : t("runners.expert_mode")}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">{t("runners.name")}</Label>
                <Input 
                  value={form.name} 
                  onChange={e => setForm({...form, name: e.target.value})} 
                  placeholder="Python 3.11 DataScience" 
                  className="h-8 text-xs font-bold"
                />
                <span className="text-[9px] text-muted-foreground block">{t("runners.name_hint")}</span>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">{t("runners.type")}</Label>
                <Input 
                  value={form.type} 
                  onChange={e => setForm({...form, type: e.target.value})} 
                  placeholder="python_local" 
                  className="h-8 text-xs font-mono"
                />
                <span className="text-[9px] text-muted-foreground block">{t("runners.type_hint")}</span>
              </div>
            </div>

            {!isRawJsonMode ? (
              <div className="space-y-3 pt-1">
                {/* Шаг 1 */}
                <div className="p-3 bg-muted/40 border border-border rounded-xl space-y-2">
                  <div className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                    <FileCode className="h-3.5 w-3.5 text-blue-500" /> {t("runners.step1_title")}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-muted-foreground">{t("runners.code_file")}</Label>
                      <Input 
                        value={form.codeFileName} 
                        onChange={e => setForm({...form, codeFileName: e.target.value})} 
                        placeholder="index.ts / main.py / script.sh" 
                        className="h-8 text-xs font-mono bg-background"
                      />
                      <span className="text-[9px] text-muted-foreground block">{t("runners.code_file_hint")}</span>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold text-muted-foreground">{t("runners.dep_file")}</Label>
                      <Input 
                        value={form.depFileName} 
                        onChange={e => setForm({...form, depFileName: e.target.value})} 
                        placeholder="package.json / requirements.txt / go.mod" 
                        className="h-8 text-xs font-mono bg-background"
                      />
                      <span className="text-[9px] text-muted-foreground block">{t("runners.dep_file_hint")}</span>
                    </div>
                  </div>
                </div>

                {/* Шаг 2 */}
                <div className="p-3 bg-muted/40 border border-border rounded-xl space-y-2">
                  <div className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-purple-500" /> {t("runners.step2_title")}
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-muted-foreground">{t("runners.install_cmd")}</Label>
                    <Input 
                      value={form.installCmd} 
                      onChange={e => setForm({...form, installCmd: e.target.value})} 
                      placeholder="bun install / pip install -r requirements.txt / go mod tidy" 
                      className="h-8 text-xs font-mono bg-background"
                    />
                    <span className="text-[9px] text-muted-foreground block">{t("runners.install_cmd_hint")}</span>
                  </div>
                </div>

                {/* Шаг 3 */}
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
                  <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <Play className="h-3.5 w-3.5 fill-current" /> {t("runners.step3_title")}
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{t("runners.run_cmd")}</Label>
                    <Input 
                      value={form.runCmd} 
                      onChange={e => setForm({...form, runCmd: e.target.value})} 
                      placeholder="bun run index.ts / python3 main.py / bash script.sh" 
                      className="h-8 text-xs font-mono bg-background border-emerald-500/30"
                    />
                    <span className="text-[9px] text-emerald-600/80 dark:text-emerald-400/80 block">{t("runners.run_cmd_hint")}</span>
                  </div>
                </div>

                {/* Консольный пайплайн */}
                <div className="p-3 border border-border bg-zinc-950 text-zinc-100 rounded-xl font-mono text-[10px] space-y-1">
                  <div className="text-[9px] font-bold text-amber-400 uppercase tracking-wider">{t("runners.pipeline_preview")}</div>
                  <div className="text-emerald-400">$ cd /tmp/hub_run_xxxx/</div>
                  <div className="text-zinc-400">$ echo "[code]" &gt; {form.codeFileName || "..."}</div>
                  {form.depFileName && <div className="text-zinc-400">$ echo "[deps]" &gt; {form.depFileName}</div>}
                  {form.installCmd && form.depFileName && <div className="text-purple-300">$ {form.installCmd}</div>}
                  <div className="text-emerald-400 font-bold">$ {form.runCmd || "..."}</div>
                </div>
              </div>
            ) : (
              <div className="space-y-1 flex-1 flex flex-col min-h-[300px]">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">{t("runners.raw_json_label")}</Label>
                <div className="border border-border rounded-xl flex-1 overflow-hidden bg-background">
                  <Editor 
                    height="100%"
                    defaultLanguage="json"
                    theme={monacoTheme}
                    value={form.rawJson}
                    onChange={val => setForm({...form, rawJson: val || "{}"})}
                    options={{ minimap: { enabled: false }, fontSize: 12 }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}