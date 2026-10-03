import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch"; 
import { toast } from "sonner";
import { 
  Folder, Trash2, ChevronRight, ChevronDown, Layers, Terminal,
  Globe, Zap, RefreshCw, Box, Plus, Activity, Save, Play, FileText, Code,
  Package, Sparkles, Beaker, RotateCcw, AlertCircle, Download, Upload, X
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/useTheme";

type CategoryType = 'LOCAL' | 'REMOTE' | 'MCP';

interface Category {
  id: number;
  name: string;
  fullPath: string;
  parentId: number | null;
  appendPrompt: string | null;
  type: CategoryType;      
  isActive: boolean;        
  remoteUrl: string | null; 
  remoteToken: string | null;
  mcpCommand: string | null;
  mcpArgs: string | null;
  mcpEnv: any;
  mcpToolsCache: any;
  mcpIsStateful: boolean;
  tools: any[];
  _count: {
    children: number;
    tools: number;
  };
  children?: Category[];
}

const inferSchema = (obj: any): any => {
  if (Array.isArray(obj)) return { type: "array", items: obj.length > 0 ? inferSchema(obj[0]) : { type: "string" } };
  if (obj === null) return { type: "null" };
  if (typeof obj === "object") {
    const properties: any = {};
    const required: string[] = [];
    Object.keys(obj).forEach(key => {
      properties[key] = inferSchema(obj[key]);
      properties[key].description = `Property ${key}`;
      required.push(key);
    });
    return { type: "object", properties, required };
  }
  return { type: typeof obj };
};

const getEditorLanguage = (runnerId: string, runners: any[]) => {
  const runner = runners.find(r => r.id.toString() === runnerId);
  if (!runner) return "javascript";
  const type = runner.type.toLowerCase();
  if (type.includes("bun") || type.includes("node")) return "typescript";
  if (type.includes("python")) return "python";
  if (type.includes("bash") || type.includes("sh")) return "shell";
  return "javascript";
};

function RemoteSubTree({ 
  node, parentCat, selectedPath, onSelectTool, remoteExpanded, onToggleExpand 
}: { 
  node: any; parentCat: Category; selectedPath?: string;
  onSelectTool: (parentCat: Category, tool: any) => void;
  remoteExpanded: Record<string, boolean>; onToggleExpand: (path: string) => void;
}) {
  const isOpen = !!remoteExpanded[node.path];
  const hasChildren = (node.children && node.children.length > 0) || (node.tools && node.tools.length > 0);

  return (
    <div className="ml-4 space-y-0.5">
      <div 
        className="flex items-center gap-2 p-1 text-[11px] text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 rounded cursor-pointer font-mono"
        onClick={(e) => { e.stopPropagation(); onToggleExpand(node.path); }}
      >
        <div className="text-blue-500 shrink-0">
          {hasChildren ? (isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : <div className="w-3" />}
        </div>
        <Folder className="h-3 w-3 text-blue-500 shrink-0" />
        <span className="font-bold">{node.name}</span>
        <span className="text-[9px] text-muted-foreground">{node.path}</span>
      </div>

      {isOpen && (
        <div className="space-y-0.5">
          {node.children?.map((child: any) => (
            <RemoteSubTree 
              key={child.path} node={child} parentCat={parentCat} selectedPath={selectedPath}
              onSelectTool={onSelectTool} remoteExpanded={remoteExpanded} onToggleExpand={onToggleExpand}
            />
          ))}
          {node.tools?.map((tool: any) => {
            const isSelected = selectedPath === tool.path;
            return (
              <div 
                key={tool.path} onClick={(e) => { e.stopPropagation(); onSelectTool(parentCat, tool); }}
                className={`ml-6 flex items-center justify-between p-1 text-[11px] rounded cursor-pointer transition-colors ${
                  isSelected 
                    ? "bg-blue-500/20 text-blue-600 dark:text-blue-400 font-bold border border-blue-500/30" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Terminal className="h-3 w-3 text-blue-500 shrink-0" />
                  <span className="font-medium">{tool.name}</span>
                </div>
                <span className="font-mono text-[9px] text-muted-foreground">{tool.path}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Categories() {
  const { t } = useI18n();
  const { monacoTheme } = useTheme();

  const [flatCategories, setFlatCategories] = useState<Category[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [runners, setRunners] = useState<any[]>([]);

  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [remoteExpanded, setRemoteExpanded] = useState<Record<string, boolean>>({});
  
  const [isSyncing, setIsSyncing] = useState<number | null>(null);
  const [isRefreshingRemote, setIsRefreshingRemote] = useState<number | null>(null);
  const [pingStatus, setPingStatus] = useState<Record<number, any>>({});
  const [remoteTrees, setRemoteTrees] = useState<Record<number, any>>({});

  const [selectionMode, setSelectionMode] = useState<'category' | 'local_tool' | 'remote_tool'>('category');

  // Дропдаун создания и модалка импорта
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importTargetCatId, setImportTargetCatId] = useState<string>("");
  const [importFile, setImportFile] = useState<File | null>(null);

  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    name: "", parentId: "" as string, appendPrompt: "", isActive: true,
    type: 'LOCAL' as CategoryType, remoteUrl: "", remoteToken: "",
    mcpCommand: "bunx", mcpArgs: "", mcpEnv: "{}", mcpIsStateful: false,
  });

  const [editingToolId, setEditingToolId] = useState<number | null>(null);
  const [activeToolTab, setActiveToolTab] = useState<"code" | "deps" | "schema" | "examples">("code");
  const [schemaSubTab, setSchemaSubTab] = useState<"input" | "output">("input");
  const [toolHistory, setToolHistory] = useState<any[]>([]);
  const [inspectingVersionId, setInspectingVersionId] = useState<number | null>(null);
  const [toolRightTab, setToolRightTab] = useState<"test" | "history">("test");

  const [toolForm, setToolForm] = useState({
    name: "", slug: "", agentDescription: "", code: "", packageJson: "",
    inputSchema: "{}", outputSchema: "{}", examples: "[]", runnerId: "",
    categoryIds: [] as number[], isActive: true, timeoutMs: 30000,
    isMcpProxy: false, mcpMethodName: "", mcpSourceId: ""
  });

  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState("");

  const [localTestInput, setLocalTestInput] = useState("{}");
  const [localTestResult, setLocalTestResult] = useState<any>(null);

  const [selectedRemoteTool, setSelectedRemoteTool] = useState<{ parentCategory: Category; tool: any; } | null>(null);
  const [remoteTestInput, setRemoteTestInput] = useState("{}");
  const [remoteTestResult, setRemoteTestResult] = useState<any>(null);
  const [remoteTestLoading, setRemoteTestLoading] = useState(false);

  const handleExportTool = async (toolId: number, toolName: string) => {
    try {
      const res = await fetch(`/admin/api/export/tool/${toolId}`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${toolName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.tool`;
      a.click();
      toast.success(t("cats.exported_tool"));
    } catch { 
      toast.error(t("cats.err_export_tool")); 
    }
  };

  const handleExportCategory = async (catId: number, catName: string) => {
    try {
      const res = await fetch(`/admin/api/export/category/${catId}`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${catName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.toolpack`;
      a.click();
      toast.success(t("cats.exported_pack"));
    } catch { 
      toast.error(t("cats.err_export_pack")); 
    }
  };

  const handleExecuteImport = async () => {
    if (!importFile) return toast.error(t("cats.no_file_selected"));
    try {
      const text = await importFile.text();
      const payload = JSON.parse(text);
      const targetCatId = importTargetCatId ? parseInt(importTargetCatId) : null;

      const res = await fetch('/admin/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, targetCategoryId: targetCatId })
      });

      const result = await res.json();
      if (res.ok && result.success) {
        if (result.importedType === 'TOOL') {
          toast.success(t("cats.tool_imported_success", { name: result.toolName || '' }));
        } else {
          toast.success(t("cats.import_success"));
        }
        setImportModalOpen(false);
        setImportFile(null);
        loadData();
      } else {
        toast.error(result.error || t("cats.import_failed"));
      }
    } catch (err: any) {
      toast.error(t("cats.invalid_pkg_file", { error: err.message }));
    }
  };

  const loadData = async () => {
    try {
      const [cats, tls, rns] = await Promise.all([
        fetch("/admin/api/categories").then(res => res.json()),
        fetch("/admin/api/tools").then(res => res.json()),
        fetch("/admin/api/runners").then(res => res.json())
      ]);
      setFlatCategories(Array.isArray(cats) ? cats : []);
      setTools(Array.isArray(tls) ? tls : []);
      setRunners(Array.isArray(rns) ? rns : []);
    } catch { toast.error(t("cats.err_load_data")); }
  };

  useEffect(() => { loadData(); }, []);

  const categoryTree = useMemo(() => {
    const map: Record<number, Category> = {};
    const roots: Category[] = [];
    flatCategories.forEach(cat => { map[cat.id] = { ...cat, children: [] }; });
    flatCategories.forEach(cat => {
      if (cat.parentId && map[cat.parentId]) { map[cat.parentId].children?.push(map[cat.id]); }
      else { roots.push(map[cat.id]); }
    });
    return roots;
  }, [flatCategories]);

  const toggleExpand = (item: Category) => {
    const willExpand = !expanded[item.id];
    setExpanded(prev => ({ ...prev, [item.id]: willExpand }));
    if (willExpand && item.type === 'REMOTE' && !remoteTrees[item.id]) {
      loadRemoteTree(item.id);
    }
  };

  const loadRemoteTree = async (id: number) => {
    try {
      const res = await fetch(`/admin/api/categories/${id}/remote-tree`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setRemoteTrees(prev => ({ ...prev, [id]: data }));
      }
    } catch {}
  };

  const refreshRemote = async (id: number) => {
    setIsRefreshingRemote(id);
    await loadRemoteTree(id);
    setIsRefreshingRemote(null);
    toast.success(t("cats.remote_tree_refreshed"));
  };

  const pingRemote = async (id: number) => {
    setPingStatus(prev => ({ ...prev, [id]: { loading: true } }));
    try {
      const res = await fetch(`/admin/api/categories/${id}/ping`, { method: 'POST' });
      const data = await res.json();
      setPingStatus(prev => ({ ...prev, [id]: data }));
    } catch {
      setPingStatus(prev => ({ ...prev, [id]: { online: false, error: "Error" } }));
    }
  };

  const syncMcp = async (id: number) => {
    setIsSyncing(id);
    const res = await fetch(`/admin/api/categories/${id}/mcp-sync`, { method: 'POST' });
    setIsSyncing(null);
    if (res.ok) {
      toast.success(t("cats.synced"));
      loadData();
    } else toast.error(t("cats.err_mcp_sync"));
  };

  const selectCategoryForEdit = (cat: Category) => {
    setSelectionMode('category');
    setEditingCategoryId(cat.id);
    setCategoryForm({
      name: cat.name,
      parentId: cat.parentId?.toString() || "",
      appendPrompt: cat.appendPrompt || "",
      isActive: cat.isActive,
      type: cat.type,
      remoteUrl: cat.remoteUrl || "",
      remoteToken: cat.remoteToken || "",
      mcpCommand: cat.mcpCommand || "bunx",
      mcpArgs: cat.mcpArgs || "",
      mcpIsStateful: cat.mcpIsStateful || false,
      mcpEnv: typeof cat.mcpEnv === 'string' ? cat.mcpEnv : JSON.stringify(cat.mcpEnv || {}, null, 2)
    });
  };

  const startNewCategory = () => {
    setSelectionMode('category');
    setEditingCategoryId(null);
    setCategoryForm({ 
      name: "", parentId: "", appendPrompt: "", isActive: true, type: 'LOCAL',
      remoteUrl: "", remoteToken: "", mcpCommand: "bunx", mcpArgs: "", mcpEnv: "{}", mcpIsStateful: false
    });
    setCreateMenuOpen(false);
  };

  const selectLocalToolForEdit = (tool: any) => {
    setSelectionMode('local_tool');
    setEditingToolId(tool.id);
    setInspectingVersionId(null);
    
    const fullTool = tools.find(t => t.id === tool.id) || tool;
    const isProxy = fullTool.isMcpProxy || false;
    const catIds = fullTool.categories?.map((c: any) => c.categoryId || c.category?.id || c.id) || [];

    setToolForm({
      name: fullTool.name, 
      slug: fullTool.slug, 
      agentDescription: fullTool.agentDescription || "", 
      code: fullTool.code || "",
      packageJson: fullTool.packageJson || "", 
      inputSchema: typeof fullTool.inputSchema === 'string' ? fullTool.inputSchema : JSON.stringify(fullTool.inputSchema || {}, null, 2),
      outputSchema: typeof fullTool.outputSchema === 'string' ? fullTool.outputSchema : JSON.stringify(fullTool.outputSchema || {}, null, 2), 
      examples: typeof fullTool.examples === 'string' ? fullTool.examples : JSON.stringify(fullTool.examples || [], null, 2),
      runnerId: fullTool.runnerId?.toString() || runners[0]?.id?.toString() || "1", 
      categoryIds: catIds,
      isActive: fullTool.isActive, 
      timeoutMs: fullTool.timeoutMs || 30000, 
      isMcpProxy: isProxy,
      mcpMethodName: fullTool.mcpMethodName || "", 
      mcpSourceId: fullTool.mcpSourceId?.toString() || ""
    });

    if (isProxy) setActiveToolTab("schema");
    loadToolHistory(fullTool.id);
  };

  const startNewTool = (defaultCategoryId?: number) => {
    setSelectionMode('local_tool');
    setEditingToolId(null);
    setToolHistory([]);
    setInspectingVersionId(null);
    setToolForm({ 
      name: "", slug: "", agentDescription: "", code: "", packageJson: "", 
      inputSchema: "{}", outputSchema: "{}", examples: "[]", runnerId: runners[0]?.id?.toString() || "1", 
      categoryIds: defaultCategoryId ? [defaultCategoryId] : [], isActive: true, timeoutMs: 30000, 
      isMcpProxy: false, mcpMethodName: "", mcpSourceId: "" 
    });
    setActiveToolTab("code");
    setCreateMenuOpen(false);
  };

  const selectRemoteTool = (parentCat: Category, tool: any) => {
    setSelectionMode('remote_tool');
    setSelectedRemoteTool({ parentCategory: parentCat, tool });
    setRemoteTestInput("{}");
    setRemoteTestResult(null);
  };

  const selectLocalMcpTool = (parentCat: Category, mcpTool: any) => {
    setSelectionMode('remote_tool');
    setSelectedRemoteTool({
      parentCategory: parentCat,
      tool: {
        name: mcpTool.name,
        description: mcpTool.description || "MCP Dynamic Executable Tool",
        path: `/${mcpTool.name}`,
        inputSchema: mcpTool.inputSchema || mcpTool.schema || {}
      }
    });
    setRemoteTestInput("{}");
    setRemoteTestResult(null);
  };

  const handleCategorySubmit = async () => {
    if (!categoryForm.name) return toast.error(t("cats.err_cat_name_req"));
    const isEdit = !!editingCategoryId;
    const url = isEdit ? `/admin/api/categories/${editingCategoryId}` : "/admin/api/categories";
    const method = isEdit ? "PUT" : "POST";

    try {
      const parsedEnv = JSON.parse(categoryForm.mcpEnv || "{}");
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...categoryForm,
          parentId: categoryForm.parentId === "" ? null : parseInt(categoryForm.parentId),
          mcpEnv: parsedEnv
        }),
      });

      if (res.ok) {
        toast.success(isEdit ? t("cats.folder_updated") : t("cats.folder_created"));
        loadData();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t("cats.err_save_cat"));
      }
    } catch (e: any) {
      toast.error(t("cats.err_invalid_mcp_env", { error: e.message }));
    }
  };

  const handleToolSubmit = async () => {
    if (!toolForm.name || toolForm.categoryIds.length === 0) return toast.error(t("tool.err_name_folder_req"));
    const url = editingToolId ? `/admin/api/tools/${editingToolId}` : "/admin/api/tools";
    const method = editingToolId ? "PUT" : "POST";
    
    try {
      const payload = {
        ...toolForm,
        inputSchema: JSON.parse(toolForm.inputSchema || "{}"),
        outputSchema: JSON.parse(toolForm.outputSchema || "{}"),
        examples: JSON.parse(toolForm.examples || "[]"),
        mcpSourceId: toolForm.mcpSourceId ? parseInt(toolForm.mcpSourceId) : null
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success(editingToolId ? t("cats.tool_updated") : t("cats.tool_created"));
        loadData();
        if (editingToolId) loadToolHistory(editingToolId);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t("tool.err_save_tool"));
      }
    } catch (e: any) {
      toast.error(t("tool.err_invalid_json", { error: e.message }));
    }
  };

  const handleDeleteTool = async () => {
    if (!editingToolId) return;
    if (!confirm(t("common.confirm_delete_tool"))) return;
    const res = await fetch(`/admin/api/tools/${editingToolId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(t("cats.tool_deleted"));
      loadData();
      startNewCategory();
    }
  };

  const loadToolHistory = async (id: number) => {
    try {
      const res = await fetch(`/admin/api/tools/${id}/history`);
      if (res.ok) setToolHistory(await res.json());
    } catch {}
  };

  const inspectVersion = (ver: any) => {
    setInspectingVersionId(ver.id);
    setToolForm(prev => ({
      ...prev,
      code: ver.code || "",
      agentDescription: ver.agentDescription || prev.agentDescription,
      inputSchema: typeof ver.inputSchema === 'string' ? ver.inputSchema : JSON.stringify(ver.inputSchema || {}, null, 2)
    }));
    setActiveToolTab("code");
  };

    const deleteVersion = async (vId: number) => {
    if (!editingToolId) return;
    if (!confirm(t("common.confirm_delete_snapshot"))) return;
    const res = await fetch(`/admin/api/tools/${editingToolId}/history/${vId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(t("tool.snapshot_deleted"));
      if (inspectingVersionId === vId) setInspectingVersionId(null);
      loadToolHistory(editingToolId);
    }
  };

  const rollbackVersion = async (vId: number) => {
    if (!editingToolId) return;
    if (!confirm(t("common.confirm_rollback"))) return;
    const res = await fetch(`/admin/api/tools/${editingToolId}/rollback/${vId}`, { method: "POST" });
    if (res.ok) {
      const rolledBack = await res.json();
      toast.success(t("tool.rolled_back"));
      selectLocalToolForEdit(rolledBack);
      loadData();
    }
  };

  const addTestToExamples = () => {
    if (!localTestResult) return toast.error(t("tool.err_exec_test_first"));
    try {
      const currentExamples = JSON.parse(toolForm.examples || "[]");
      const newExample = { 
        input: JSON.parse(localTestInput || "{}"), 
        output: localTestResult 
      };
      setToolForm(prev => ({ ...prev, examples: JSON.stringify([...currentExamples, newExample], null, 2) }));
      setActiveToolTab("examples");
      toast.success(t("tool.few_shot_added"));
    } catch {
      toast.error(t("tool.err_add_examples"));
    }
  };

  const handleInferSchema = (target: 'input' | 'output', sourceData: any) => {
    try {
      let data = sourceData;
      if (typeof sourceData === 'string') { try { data = JSON.parse(sourceData); } catch {} }
      const inferred = inferSchema(data);
      const str = JSON.stringify(inferred, null, 2);
      if (target === 'input') setToolForm(prev => ({ ...prev, inputSchema: str }));
      else setToolForm(prev => ({ ...prev, outputSchema: str }));
      toast.success(t("tool.schema_generated"));
    } catch { toast.error(t("tool.err_infer_schema")); }
  };

  const runLocalTest = async () => {
    if (!editingToolId) return toast.error(t("tool.save_first"));
    setLocalTestResult(t("tool.executing"));
    const tool = tools.find(t => t.id === editingToolId);
    if (!tool) return;

    try {
      const catPath = tool.categories[0]?.category?.fullPath || "";
      const toolPath = `${catPath}/${tool.slug}`.replace(/\/+/g, '/');
      const res = await fetch(`/admin/api/test-tool${toolPath}`, { 
        method: "POST", headers: { "Content-Type": "application/json" }, body: localTestInput 
      });
      setLocalTestResult(await res.json());
    } catch (e: any) { 
      setLocalTestResult({ error: e.message });
    }
  };

  const executeRemoteToolTest = async () => {
    if (!selectedRemoteTool) return;
    setRemoteTestLoading(true);
    setRemoteTestResult(t("tool.executing"));
    try {
      const { parentCategory, tool } = selectedRemoteTool;
      const rawPath = `${parentCategory.fullPath}${tool.path}`.replace(/\/+/g, '/');
      const res = await fetch(`/admin/api/test-tool${rawPath}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: remoteTestInput
      });
      setRemoteTestResult(await res.json());
    } catch (e: any) {
      setRemoteTestResult({ error: e.message });
    } finally {
      setRemoteTestLoading(false);
    }
  };

  const promoteTool = async (categoryId: number, mcpToolName: string) => {
    const res = await fetch(`/admin/api/mcp/promote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId, mcpToolName })
    });
    if (res.ok) {
      toast.success(t("tool.promoted"));
      loadData();
    }
  };

  const TreeItem = ({ item, depth }: { item: Category; depth: number }) => {
    const isExpanded = expanded[item.id];
    const hasChildren = (item.children && item.children.length > 0) || item.type !== 'LOCAL';
    const hasTools = (item.tools && item.tools.length > 0) || (item.mcpToolsCache?.tools?.length > 0);
    const ping = pingStatus[item.id];
    const remoteData = remoteTrees[item.id];
    const isCatSelected = selectionMode === 'category' && editingCategoryId === item.id;

    return (
      <div className="space-y-0.5">
        <div 
          onClick={() => selectCategoryForEdit(item)}
          className={`group flex items-center justify-between p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
            depth > 0 && "ml-4"
          } ${isCatSelected ? "bg-amber-500/15 border-amber-500/40 font-bold text-foreground" : "hover:bg-muted/50 bg-card border-border"} ${
            !item.isActive && "opacity-50"
          }`}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div 
              className="text-muted-foreground shrink-0 p-0.5 hover:bg-muted rounded" 
              onClick={(e) => { e.stopPropagation(); toggleExpand(item); }}
            >
              {hasChildren || hasTools ? (
                isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
              ) : <div className="w-3.5" />}
            </div>
            
            {item.type === 'REMOTE' ? <Globe className="h-3.5 w-3.5 text-blue-500 shrink-0" /> :
             item.type === 'MCP' ? <Zap className="h-3.5 w-3.5 text-purple-500 shrink-0" /> :
             <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
            
            <span className="truncate font-medium">{item.name}</span>
            <span className="font-mono text-[9px] text-muted-foreground truncate">{item.fullPath}</span>

            {item.type === 'REMOTE' && <span className="text-[8px] bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20 px-1 rounded font-mono uppercase">Remote</span>}
            {item.type === 'MCP' && <span className="text-[8px] bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/20 px-1 rounded font-mono uppercase">MCP</span>}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {item.type === 'LOCAL' && (
              <Button size="icon" variant="ghost" className="h-5 w-5 text-muted-foreground hover:text-foreground" title="Add Tool" onClick={(e) => { e.stopPropagation(); startNewTool(item.id); }}>
                <Plus className="h-3 w-3" />
              </Button>
            )}
            {item.type === 'REMOTE' && (
              <>
                <Button variant="ghost" size="icon" className="h-5 w-5 text-blue-500" title={t("cats.ping")} onClick={(e) => { e.stopPropagation(); pingRemote(item.id); }}>
                  <Activity className={`h-3 w-3 ${ping?.loading ? "animate-spin" : ""}`} />
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5 text-blue-500" title={t("cats.refresh_tree")} onClick={(e) => { e.stopPropagation(); refreshRemote(item.id); }}>
                  <RefreshCw className={`h-3 w-3 ${isRefreshingRemote === item.id ? "animate-spin" : ""}`} />
                </Button>
              </>
            )}
            {item.type === 'MCP' && (
              <Button variant="ghost" size="icon" className="h-5 w-5 text-purple-500" onClick={(e) => { e.stopPropagation(); syncMcp(item.id); }}>
                <RefreshCw className={`h-3 w-3 ${isSyncing === item.id ? "animate-spin" : ""}`} />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); if(confirm(t("common.confirm_delete_folder"))) fetch(`/admin/api/categories/${item.id}`, {method:'DELETE'}).then(loadData); }}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div className="space-y-0.5">
            {item.children?.map(child => <TreeItem key={child.id} item={child} depth={depth + 1} />)}
            
            {item.tools?.map((rel: any) => {
              const toolObj = rel.tool || rel;
              const isToolSelected = selectionMode === 'local_tool' && editingToolId === toolObj.id;
              return (
                <div 
                  key={toolObj.id} 
                  className={`ml-8 flex items-center justify-between p-1.5 rounded-lg border text-[11px] cursor-pointer transition-colors ${
                    isToolSelected 
                      ? "bg-blue-500/15 border-blue-500/40 font-bold text-foreground" 
                      : "hover:bg-muted/50 bg-card border-border"
                  } ${!toolObj.isActive ? "opacity-40" : ""}`}
                  onClick={(e) => { e.stopPropagation(); selectLocalToolForEdit(toolObj); }}
                >
                  <div className="flex items-center gap-2 truncate">
                    {toolObj.isMcpProxy ? (
                      <Zap className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                    ) : (
                      <Terminal className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    )}
                    <span className="truncate">{toolObj.name}</span>
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground">{toolObj.slug}</span>
                </div>
              );
            })}

            {item.type === 'MCP' && item.mcpToolsCache?.tools?.map((tItem: any) => {
              const isSelected = selectedRemoteTool?.tool.name === tItem.name;
              return (
                <div 
                  key={tItem.name} onClick={(e) => { e.stopPropagation(); selectLocalMcpTool(item, tItem); }}
                  className={`ml-8 flex items-center justify-between p-1.5 rounded-lg border text-[11px] cursor-pointer transition-colors ${
                    isSelected 
                      ? "bg-purple-500/20 text-purple-600 dark:text-purple-400 font-bold border-purple-500/30" 
                      : "text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Box className="h-3.5 w-3.5 text-purple-500 shrink-0" /> <span className="italic">{tItem.name}</span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-5 w-5 text-purple-500 hover:bg-purple-500/20" title={t("tool.promote")} onClick={(e) => { e.stopPropagation(); promoteTool(item.id, tItem.name); }}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}

            {item.type === 'REMOTE' && remoteData?.tree?.categories?.map((rc: any) => (
              <RemoteSubTree 
                key={rc.path} node={rc} parentCat={item} selectedPath={selectedRemoteTool?.tool.path}
                onSelectTool={selectRemoteTool} remoteExpanded={remoteExpanded} onToggleExpand={path => setRemoteExpanded(p => ({ ...p, [path]: !p[path] }))}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {/* Шапка управления */}
      <div className="h-[74.4px] min-h-[74.4px] max-h-[74.4px] px-6 border-b border-border flex items-center justify-end shrink-0 box-border">
        <div className="flex items-center gap-2">
          {/* Кнопка импорта с вызовом модалки */}
          <Button 
            size="sm" 
            variant="outline" 
            onClick={() => setImportModalOpen(true)} 
            className="h-8 text-xs font-bold rounded-lg border-border"
          >
            <Upload className="h-3.5 w-3.5 mr-1.5 text-emerald-600 dark:text-emerald-400" /> {t("common.import")}
          </Button>

          {/* Дропдаун меню Создания */}
          <div className="relative">
            <Button 
              size="sm" 
              onClick={() => setCreateMenuOpen(prev => !prev)} 
              className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-bold rounded-lg shadow-sm"
            >
              <Plus className="h-4 w-4 mr-1" /> {t("cats.create_menu")}
              <ChevronDown className={`h-3.5 w-3.5 ml-1 transition-transform ${createMenuOpen ? "rotate-180" : ""}`} />
            </Button>

            {createMenuOpen && (
              <div className="absolute right-0 mt-1 z-50 w-44 bg-card border border-border rounded-xl shadow-xl p-1 space-y-0.5 animate-in fade-in duration-150">
                <button
                  onClick={startNewCategory}
                  className="w-full text-left p-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-muted text-foreground transition-colors"
                >
                  <Folder className="h-4 w-4 text-amber-500" />
                  <span>{t("cats.new_folder")}</span>
                </button>
                <button
                  onClick={() => startNewTool()}
                  className="w-full text-left p-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-muted text-foreground transition-colors"
                >
                  <Terminal className="h-4 w-4 text-blue-500" />
                  <span>{t("cats.new_tool")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 flex-1 overflow-hidden min-h-0">
        <div className="grid grid-cols-12 gap-3 h-full">
          {/* Левый проводник категорий */}
          <div className="col-span-4 border border-border rounded-xl flex flex-col bg-card overflow-hidden">
            <div className="p-2.5 border-b border-border bg-muted/40 text-xs font-bold uppercase text-muted-foreground flex justify-between shrink-0">
              <span>{t("cats.explorer")}</span>
              <span>{t("cats.items")}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {categoryTree.map(root => <TreeItem key={root.id} item={root} depth={0} />)}
            </div>
          </div>

          {/* Правая рабочая область */}
          <div className="col-span-8 border border-border rounded-xl flex flex-col bg-card overflow-hidden p-3.5 gap-3 overflow-y-auto text-xs">
            {selectionMode === 'category' && (
              <div className="flex flex-col h-full space-y-3">
                <div className="flex justify-between items-center border-b border-border pb-2">
                  <span className="font-bold uppercase text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <Folder className="h-4 w-4 text-amber-500" /> 
                    {editingCategoryId ? t("cats.edit_folder", { id: editingCategoryId }) : t("cats.new_folder_title")}
                  </span>
                  
                  <div className="flex items-center gap-2">
                    {editingCategoryId && (
                      <Button size="sm" variant="outline" onClick={() => handleExportCategory(editingCategoryId, categoryForm.name)} className="h-7 text-xs text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10">
                        <Download className="h-3.5 w-3.5 mr-1" /> {t("cats.export_pack")}
                      </Button>
                    )}
                    <Button size="sm" onClick={handleCategorySubmit} className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-sm">
                      <Save className="h-3.5 w-3.5 mr-1" /> {editingCategoryId ? t("cats.save_folder") : t("cats.create_folder")}
                    </Button>
                  </div>
                </div>

                <div className="flex bg-muted p-1 rounded-lg shrink-0 border border-border">
                  {(['LOCAL', 'REMOTE', 'MCP'] as CategoryType[]).map((typeItem) => (
                    <button
                      key={typeItem} onClick={() => setCategoryForm({ ...categoryForm, type: typeItem })}
                      className={`flex-1 py-1 text-xs font-bold rounded-md transition-all ${
                        categoryForm.type === typeItem ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {typeItem}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-8 space-y-1">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">{t("cats.category_name")}</Label>
                    <Input value={categoryForm.name} onChange={e => setCategoryForm({...categoryForm, name: e.target.value})} placeholder="SmartHome" className="h-8 text-xs font-bold" />
                  </div>
                  <div className="col-span-4 flex items-center justify-end gap-2 pt-4">
                    <Label className="text-xs font-bold">{t("common.active")}</Label>
                    <Switch checked={categoryForm.isActive} onCheckedChange={v => setCategoryForm({...categoryForm, isActive: v})} />
                  </div>
                </div>

                {(categoryForm.type === 'LOCAL' || categoryForm.type === 'MCP') && (
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">{t("cats.parent_folder")}</Label>
                    <select 
                      className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      value={categoryForm.parentId} onChange={e => setCategoryForm({...categoryForm, parentId: e.target.value})}
                    >
                      <option value="">{t("cats.root_option")}</option>
                      {flatCategories.filter(c => c.type === 'LOCAL' && c._count.tools === 0 && c.id !== editingCategoryId).map(c => (
                        <option key={c.id} value={c.id}>{c.fullPath}</option>
                      ))}
                    </select>
                  </div>
                )}

                {categoryForm.type === 'REMOTE' && (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl space-y-2.5">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400">{t("cats.remote_url")}</Label>
                      <Input value={categoryForm.remoteUrl} onChange={e => setCategoryForm({...categoryForm, remoteUrl: e.target.value})} placeholder="http://192.168.1.10:3000" className="h-8 text-xs bg-background" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400">{t("cats.remote_token")}</Label>
                      <Input value={categoryForm.remoteToken} onChange={e => setCategoryForm({...categoryForm, remoteToken: e.target.value})} placeholder="x-agent-password" className="h-8 text-xs bg-background" />
                    </div>
                  </div>
                )}

                {categoryForm.type === 'MCP' && (
                  <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl space-y-2.5">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase font-bold text-purple-600 dark:text-purple-400">{t("cats.mcp_command")}</Label>
                        <Input value={categoryForm.mcpCommand} onChange={e => setCategoryForm({...categoryForm, mcpCommand: e.target.value})} placeholder="bunx" className="h-8 text-xs bg-background" />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-[10px] uppercase font-bold text-purple-600 dark:text-purple-400">{t("cats.mcp_args")}</Label>
                        <Input value={categoryForm.mcpArgs} onChange={e => setCategoryForm({...categoryForm, mcpArgs: e.target.value})} placeholder="@mcp/server-puppeteer" className="h-8 text-xs bg-background" />
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase font-bold text-purple-600 dark:text-purple-400">{t("cats.mcp_env")}</Label>
                      <div className="border border-border rounded-lg bg-background overflow-hidden h-20">
                        <Editor height="100%" defaultLanguage="json" theme={monacoTheme} value={categoryForm.mcpEnv} onChange={val => setCategoryForm({...categoryForm, mcpEnv: val || "{}"})} options={{ minimap: { enabled: false }, fontSize: 11, lineNumbers: 'off' }} />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase">{t("cats.mcp_stateful")}</span>
                      <Switch checked={categoryForm.mcpIsStateful} onCheckedChange={v => setCategoryForm({ ...categoryForm, mcpIsStateful: v })} />
                    </div>
                  </div>
                )}

                <div className="space-y-1 flex-1 flex flex-col min-h-[160px]">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground">{t("cats.append_prompt")}</Label>
                  <div className="border border-border rounded-lg flex-1 overflow-hidden bg-background">
                    <Editor height="100%" defaultLanguage="markdown" theme={monacoTheme} value={categoryForm.appendPrompt} onChange={val => setCategoryForm({...categoryForm, appendPrompt: val || ""})} options={{ minimap: { enabled: false }, fontSize: 11, lineNumbers: 'off', wordWrap: 'on' }} />
                  </div>
                </div>
              </div>
            )}

            {selectionMode === 'local_tool' && (
              <div className="flex flex-col h-full space-y-2">
                {inspectingVersionId && (
                  <div className="bg-amber-500 text-amber-950 px-3 py-1 text-xs font-bold flex items-center justify-between shrink-0 rounded-lg">
                    <span className="flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5" /> {t("tool.inspecting_revision")}
                    </span>
                    <Button size="sm" variant="ghost" className="h-5 px-2 text-[10px] text-amber-950 font-bold hover:bg-amber-400" onClick={() => {
                      const currentTool = tools.find(tItem => tItem.id === editingToolId);
                      if (currentTool) selectLocalToolForEdit(currentTool);
                    }}>
                      {t("tool.reset_current")}
                    </Button>
                  </div>
                )}

                <div className="flex justify-between items-center border-b border-border pb-2 shrink-0">
                  <span className="font-bold uppercase text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                    <Terminal className="h-4 w-4" />
                    {editingToolId ? t("tool.editing", { name: toolForm.name }) : t("tool.new")}
                  </span>
                  
                  <div className="flex items-center gap-2">
                    {editingToolId && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => handleExportTool(editingToolId, toolForm.name)} className="h-7 text-xs text-blue-600 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/10">
                          <Download className="h-3.5 w-3.5 mr-1" /> {t("tool.export")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={handleDeleteTool} className="h-7 text-xs text-destructive hover:bg-destructive/10">
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> {t("tool.delete")}
                        </Button>
                      </>
                    )}
                    <Button size="sm" onClick={handleToolSubmit} className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm">
                      <Save className="h-3.5 w-3.5 mr-1" /> {editingToolId ? t("cats.save_tool") : t("cats.create_tool")}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-12 gap-2 shrink-0">
                  <div className="col-span-3">
                    <Input placeholder={t("tool.name")} value={toolForm.name} onChange={e => {
                      const newName = e.target.value;
                      setToolForm(prev => {
                        const isSlugUntouched = !prev.slug || prev.slug === prev.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
                        const autoSlug = newName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
                        return {
                          ...prev,
                          name: newName,
                          slug: (!editingToolId && isSlugUntouched) ? autoSlug : prev.slug
                        };
                      });
                    }} className="h-8 text-xs font-bold" />
                  </div>
                  <div className="col-span-3">
                    <Input placeholder={t("tool.slug")} value={toolForm.slug} onChange={e => setToolForm({...toolForm, slug: e.target.value})} className="h-8 text-xs font-mono" />
                  </div>
                  <div className="col-span-3 flex items-center gap-1">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">{t("tool.runner")}</span>
                    <select disabled={toolForm.isMcpProxy} className="h-8 w-full border border-border rounded-lg text-xs px-2 bg-background font-mono text-foreground focus:outline-none" value={toolForm.runnerId} onChange={e => setToolForm({...toolForm, runnerId: e.target.value})}>
                      {runners.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2 flex items-center gap-1">
                    <span className="text-[9px] uppercase font-bold text-muted-foreground">{t("tool.timeout")}</span>
                    <Input type="number" value={toolForm.timeoutMs} onChange={e => setToolForm({...toolForm, timeoutMs: parseInt(e.target.value) || 30000})} className="h-8 text-xs font-mono px-1.5" />
                  </div>
                  <div className="col-span-1 flex items-center justify-end" title={t("common.active")}>
                    <Switch checked={toolForm.isActive} onCheckedChange={v => setToolForm({ ...toolForm, isActive: v })} />
                  </div>
                </div>

                <div className="p-2.5 bg-purple-500/10 border border-purple-500/20 rounded-xl space-y-1.5 text-xs shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-purple-600 dark:text-purple-400">
                      <Zap className="h-3.5 w-3.5" />
                      <span>{t("tool.mcp_proxy_mode")}</span>
                    </div>
                    <Switch 
                      checked={toolForm.isMcpProxy} 
                      onCheckedChange={v => {
                        setToolForm({...toolForm, isMcpProxy: v});
                        if (v) setActiveToolTab("schema");
                      }} 
                    />
                  </div>

                  {toolForm.isMcpProxy && (
                    <div className="grid grid-cols-2 gap-2 pt-1 animate-in fade-in duration-200">
                      <div className="space-y-0.5">
                        <Label className="text-[9px] font-bold uppercase text-purple-600 dark:text-purple-400">{t("tool.mcp_source")}</Label>
                        <select 
                          className="h-8 w-full border border-border rounded-lg text-xs px-2 bg-background font-mono text-foreground focus:outline-none"
                          value={toolForm.mcpSourceId} 
                          onChange={e => setToolForm({...toolForm, mcpSourceId: e.target.value})}
                        >
                          <option value="">{t("tool.mcp_source_placeholder")}</option>
                          {flatCategories.filter(c => c.type === 'MCP').map(c => (
                            <option key={c.id} value={c.id}>{c.name} ({c.fullPath})</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-0.5">
                        <Label className="text-[9px] font-bold uppercase text-purple-600 dark:text-purple-400">{t("tool.mcp_method")}</Label>
                        <Input 
                          placeholder="e.g. create_issue" 
                          value={toolForm.mcpMethodName} 
                          onChange={e => setToolForm({...toolForm, mcpMethodName: e.target.value})}
                          className="h-8 text-xs font-mono bg-background"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs shrink-0 relative">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground shrink-0">{t("tool.folder_binding")}</span>
                  
                  {/* Кнопка открытия селектора */}
                  <div 
                    onClick={() => setFolderDropdownOpen(prev => !prev)}
                    className={`flex-1 border rounded-lg p-1.5 min-h-[34px] bg-background cursor-pointer flex items-center justify-between gap-2 transition-all ${
                      toolForm.categoryIds.length === 0 ? "border-rose-500/50 bg-rose-500/5" : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap max-h-14 overflow-y-auto">
                      {toolForm.categoryIds.length === 0 ? (
                        <span className="text-[11px] text-rose-500 font-medium italic">{t("cats.pick_at_least_one_folder")}</span>
                      ) : (
                        flatCategories
                          .filter(c => toolForm.categoryIds.includes(c.id))
                          .map(c => (
                            <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[10px] font-mono font-bold">
                              <Folder className="h-3 w-3 shrink-0" />
                              {c.fullPath}
                            </span>
                          ))
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 text-muted-foreground">
                      <span className="text-[10px] font-bold bg-muted px-1.5 py-0.5 rounded font-mono">
                        {toolForm.categoryIds.length}
                      </span>
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${folderDropdownOpen ? "rotate-180" : ""}`} />
                    </div>
                  </div>

                  {/* Всплывающее меню с поиском */}
                  {folderDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-card border border-border rounded-xl shadow-xl p-2.5 space-y-2 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between pb-1 border-b border-border">
                        <Input 
                          placeholder={t("cats.search_folder_placeholder")} 
                          value={folderSearchQuery}
                          onChange={e => setFolderSearchQuery(e.target.value)}
                          className="h-7 text-xs font-mono bg-background"
                          autoFocus
                        />
                      </div>

                      <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                        {flatCategories
                          .filter(c => c.type === 'LOCAL')
                          .filter(c => c.fullPath.toLowerCase().includes(folderSearchQuery.toLowerCase()) || c.name.toLowerCase().includes(folderSearchQuery.toLowerCase()))
                          .map(c => {
                            const isChecked = toolForm.categoryIds.includes(c.id);
                            return (
                              <div
                                key={c.id}
                                onClick={() => {
                                  const ids = isChecked 
                                    ? toolForm.categoryIds.filter(id => id !== c.id) 
                                    : [...toolForm.categoryIds, c.id];
                                  setToolForm({...toolForm, categoryIds: ids});
                                }}
                                className={`flex items-center justify-between p-1.5 rounded-lg border text-xs cursor-pointer transition-all ${
                                  isChecked 
                                    ? "bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400 font-bold" 
                                    : "bg-background border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                <div className="flex items-center gap-2 truncate font-mono text-[11px]">
                                  <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                  <span className="truncate">{c.fullPath}</span>
                                </div>
                                <input 
                                  type="checkbox" 
                                  checked={isChecked} 
                                  onChange={() => {}} 
                                  className="h-3.5 w-3.5 rounded border-border text-amber-500 focus:ring-0 cursor-pointer"
                                />
                              </div>
                            );
                          })}
                      </div>

                      <div className="flex justify-between items-center pt-1 border-t border-border text-[10px]">
                        <button 
                          onClick={() => setToolForm({...toolForm, categoryIds: []})}
                          className="text-rose-500 font-bold hover:underline"
                        >
                          {t("cats.reset_selection")}
                        </button>
                        <Button 
                          size="sm" 
                          onClick={() => setFolderDropdownOpen(false)} 
                          className="h-6 text-[10px] px-3 bg-primary text-primary-foreground font-bold rounded"
                        >
                          {t("cats.done")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <Textarea placeholder={t("tool.agent_instructions")} value={toolForm.agentDescription} onChange={e => setToolForm({...toolForm, agentDescription: e.target.value})} className="h-14 text-xs p-2 leading-tight resize-none font-mono shrink-0 bg-background" />

                <div className="flex justify-between items-center border-b border-border bg-muted/30 shrink-0 rounded-t-lg">
                  <div className="flex">
                    {[
                      { id: 'code', label: t("tool.tab_code"), icon: Code, disabled: toolForm.isMcpProxy },
                      { id: 'deps', label: t("tool.tab_deps"), icon: Package, disabled: toolForm.isMcpProxy },
                      { id: 'schema', label: t("tool.tab_schema"), icon: Layers },
                      { id: 'examples', label: t("tool.tab_examples"), icon: Beaker }
                    ].map(tab => (
                      <button key={tab.id} disabled={tab.disabled} onClick={() => setActiveToolTab(tab.id as any)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors ${activeToolTab === tab.id ? "border-blue-600 text-blue-600 bg-background" : "border-transparent text-muted-foreground hover:text-foreground"} ${tab.disabled && "opacity-30 cursor-not-allowed"}`}>
                        <tab.icon className="h-3.5 w-3.5" /> <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>

                  {activeToolTab === 'schema' && (
                    <div className="flex items-center gap-1 p-1">
                      <button onClick={() => setSchemaSubTab("input")} className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${schemaSubTab === "input" ? "bg-background text-blue-600 dark:text-blue-400 shadow-sm border border-border" : "text-muted-foreground"}`}>Input Schema</button>
                      <button onClick={() => setSchemaSubTab("output")} className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${schemaSubTab === "output" ? "bg-background text-emerald-600 dark:text-emerald-400 shadow-sm border border-border" : "text-muted-foreground"}`}>Output Schema</button>
                    </div>
                  )}
                </div>

                <div className="flex-1 border border-border rounded-b-lg overflow-hidden min-h-[180px] bg-background relative">
                  {toolForm.isMcpProxy && (activeToolTab === 'code' || activeToolTab === 'deps') && (
                    <div className="absolute inset-0 bg-background/90 backdrop-blur-sm z-10 flex flex-col items-center justify-center p-6 text-center">
                      <Zap className="h-10 w-10 text-purple-500 mb-2 animate-pulse" />
                      <h3 className="text-sm font-bold text-purple-600 dark:text-purple-400 uppercase">{t("tool.mcp_proxy_active")}</h3>
                      <p className="text-xs text-muted-foreground mt-1 max-w-xs font-mono">{t("tool.mcp_proxy_desc")}</p>
                    </div>
                  )}

                  {activeToolTab === 'code' && <Editor height="100%" language={getEditorLanguage(toolForm.runnerId, runners)} theme={monacoTheme} value={toolForm.code} onChange={val => setToolForm({...toolForm, code: val || ""})} options={{ minimap: { enabled: false }, fontSize: 11 }} />}
                  {activeToolTab === 'deps' && <Editor height="100%" defaultLanguage="json" theme={monacoTheme} value={toolForm.packageJson} onChange={val => setToolForm({...toolForm, packageJson: val || ""})} options={{ minimap: { enabled: false }, fontSize: 11 }} />}
                  {activeToolTab === 'schema' && (
                    <div className="h-full flex flex-col min-h-0">
                      <div className="p-1.5 text-[10px] font-bold uppercase bg-muted/40 border-b border-border text-muted-foreground px-3 flex justify-between items-center shrink-0">
                        <span>{schemaSubTab === "input" ? t("tool.schema_input") : t("tool.schema_output")}</span>
                        <button 
                          onClick={() => handleInferSchema(schemaSubTab, schemaSubTab === "input" ? localTestInput : localTestResult)}
                          className="text-[9px] bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded flex items-center gap-1 font-bold hover:bg-blue-500/25 transition-colors"
                        >
                          <Sparkles className="h-3 w-3" /> {t("tool.infer_from", { target: schemaSubTab === "input" ? t("tool.test_input") : t("tool.test_result") })}
                        </button>
                      </div>
                      <div className="flex-1 min-h-0">
                        {schemaSubTab === "input" 
                          ? <Editor height="100%" defaultLanguage="json" theme={monacoTheme} value={toolForm.inputSchema} onChange={val => setToolForm({...toolForm, inputSchema: val || ""})} options={{ minimap: { enabled: false }, fontSize: 11 }} />
                          : <Editor height="100%" defaultLanguage="json" theme={monacoTheme} value={toolForm.outputSchema !== "null" ? toolForm.outputSchema : "{}"} onChange={val => setToolForm({...toolForm, outputSchema: val || ""})} options={{ minimap: { enabled: false }, fontSize: 11 }} />
                        }
                      </div>
                    </div>
                  )}
                  {activeToolTab === 'examples' && <Editor height="100%" defaultLanguage="json" theme={monacoTheme} value={toolForm.examples} onChange={val => setToolForm({...toolForm, examples: val || ""})} options={{ minimap: { enabled: false }, fontSize: 11 }} />}
                </div>

                <div className="border border-border rounded-xl p-3 bg-muted/20 space-y-2 shrink-0">
                  <div className="flex justify-between items-center text-[10px] font-bold uppercase">
                    <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg border border-border">
                      <button 
                        onClick={() => setToolRightTab("test")}
                        className={`px-2 py-0.5 rounded-md transition-all ${toolRightTab === "test" ? "bg-background text-blue-600 dark:text-blue-400 font-bold shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {t("tool.live_test")}
                      </button>
                      <button 
                        onClick={() => setToolRightTab("history")}
                        className={`px-2 py-0.5 rounded-md transition-all ${toolRightTab === "history" ? "bg-background text-purple-600 dark:text-purple-400 font-bold shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {t("tool.history", { count: toolHistory.length })}
                      </button>
                    </div>

                    {toolRightTab === "test" && (
                      <div className="flex items-center gap-1.5">
                        <button 
                          onClick={() => {
                            handleInferSchema('input', localTestInput);
                            setActiveToolTab('schema');
                            setSchemaSubTab('input');
                          }}
                          className="text-[9px] bg-blue-500/15 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded border border-blue-500/20 font-bold hover:bg-blue-500/25 transition-colors"
                          title={t("tool.infer_input_btn")}
                        >
                          {t("tool.infer_input_btn")}
                        </button>

                        {localTestResult && (
                          <>
                            <button 
                              onClick={() => {
                                handleInferSchema('output', localTestResult);
                                setActiveToolTab('schema');
                                setSchemaSubTab('output');
                              }}
                              className="text-[9px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20 font-bold hover:bg-emerald-500/25 transition-colors"
                              title={t("tool.infer_output_btn")}
                            >
                              {t("tool.infer_output_btn")}
                            </button>
                            <button 
                              onClick={addTestToExamples}
                              className="text-[9px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded border border-amber-500/20 font-bold hover:bg-amber-500/25 transition-colors"
                              title={t("tool.add_few_shot")}
                            >
                              {t("tool.add_few_shot")}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {toolRightTab === "test" ? (
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-4 space-y-1">
                        <Textarea placeholder='{"arg": "val"}' value={localTestInput} onChange={e => setLocalTestInput(e.target.value)} className="h-16 font-mono text-[10px] p-1.5 resize-none bg-background border border-border" />
                        <Button size="sm" onClick={runLocalTest} className="h-7 w-full bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded-lg shadow-sm">
                          <Play className="h-3 w-3 mr-1 fill-current" /> {t("common.execute")}
                        </Button>
                      </div>
                      <div className="col-span-8 border border-border rounded-lg bg-zinc-950 p-2 font-mono text-[10px] text-emerald-400 h-24 overflow-y-auto">
                        <pre className="whitespace-pre-wrap">{JSON.stringify(localTestResult, null, 2)}</pre>
                      </div>
                    </div>
                  ) : (
                    <div className="max-h-36 overflow-y-auto divide-y divide-border bg-background border border-border rounded-lg">
                      {toolHistory.length === 0 ? (
                        <div className="p-3 text-center text-muted-foreground text-[10px]">
                          {t("tool.empty_history")}
                        </div>
                      ) : (
                        toolHistory.map((ver, idx) => {
                          const isInspectingThis = inspectingVersionId === ver.id;
                          const matchesFormCode = (toolForm.code || "").trim() === (ver.code || "").trim();
                          const matchingVersion = toolHistory.find(v => (v.code || "").trim() === (toolForm.code || "").trim());
                          const isCurrentSaved = !inspectingVersionId && matchesFormCode && matchingVersion?.id === ver.id;

                          return (
                            <div key={ver.id} className={`p-2 space-y-1.5 transition-colors ${
                              isInspectingThis ? "bg-amber-500/15" : isCurrentSaved ? "bg-emerald-500/10" : "hover:bg-muted/40"
                            }`}>
                              <div className="flex justify-between items-center font-mono text-[10px]">
                                <span className="font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                                  v{toolHistory.length - idx} (#{ver.id})
                                  {isCurrentSaved && (
                                    <span className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[8px] px-1 rounded font-bold uppercase border border-emerald-500/30">
                                      {t("tool.current_saved")}
                                    </span>
                                  )}
                                  {isInspectingThis && (
                                    <span className="bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[8px] px-1 rounded font-bold uppercase border border-amber-500/30">
                                      {t("tool.inspecting")}
                                    </span>
                                  )}
                                </span>
                                <span className="text-muted-foreground text-[9px]">
                                  {new Date(ver.createdAt).toLocaleTimeString()} ({new Date(ver.createdAt).toLocaleDateString()})
                                </span>
                              </div>

                              <div className="text-[9px] text-muted-foreground font-mono bg-muted/60 p-1.5 rounded truncate">
                                {(ver.code || "").length > 0 ? (
                                  <span className="text-foreground">{(ver.code || "").slice(0, 45)}...</span>
                                ) : (
                                  <span className="italic text-muted-foreground">{t("tool.empty_code")}</span>
                                )}
                              </div>

                              <div className="flex items-center gap-1 pt-0.5">
                                <Button size="sm" variant="outline" onClick={() => inspectVersion(ver)} className="h-6 text-[9px] px-2 rounded">
                                  <Code className="h-3 w-3 mr-1 text-blue-500" /> {t("common.view")}
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => rollbackVersion(ver.id)} className="h-6 text-[9px] px-2 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10 rounded">
                                  <RotateCcw className="h-3 w-3 mr-1" /> {t("common.rollback")}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => deleteVersion(ver.id)} className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10 ml-auto rounded" title={t("common.delete")}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {selectionMode === 'remote_tool' && selectedRemoteTool && (
              <div className="flex flex-col h-full space-y-3">
                <div className="flex justify-between items-start border-b border-border pb-2 bg-blue-500/10 p-3 rounded-xl border border-blue-500/20">
                  <div>
                    <div className="flex items-center gap-2 font-bold text-sm text-foreground">
                      <Globe className="h-4 w-4 text-blue-500" />
                      <span>{selectedRemoteTool.tool.name}</span>
                      <span className="text-[9px] bg-blue-500/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-mono border border-blue-500/30">REMOTE / MCP</span>
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                      Path: <span className="font-bold text-blue-600 dark:text-blue-400">{selectedRemoteTool.parentCategory.fullPath}{selectedRemoteTool.tool.path}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                    <FileText className="h-3 w-3 text-blue-500" /> {t("tool.agent_description")}
                  </Label>
                  <div className="p-2.5 bg-muted/40 rounded-lg border border-border font-mono text-[11px] text-foreground">
                    {selectedRemoteTool.tool.description || t("tool.no_description")}
                  </div>
                </div>

                <div className="space-y-1 flex-1 flex flex-col min-h-[140px]">
                  <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                    <Code className="h-3 w-3 text-purple-500" /> Input Schema
                  </Label>
                  <div className="border border-border rounded-lg flex-1 overflow-hidden bg-background">
                    <Editor height="100%" defaultLanguage="json" theme={monacoTheme} value={JSON.stringify(selectedRemoteTool.tool.inputSchema || {}, null, 2)} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 11, lineNumbers: 'off' }} />
                  </div>
                </div>

                <div className="border border-blue-500/20 bg-blue-500/10 rounded-xl p-3 space-y-2">
                  <Textarea placeholder="Payload JSON..." className="h-16 font-mono text-xs p-2 resize-none bg-background border-border" value={remoteTestInput} onChange={e => setRemoteTestInput(e.target.value)} />
                  <Button size="sm" onClick={executeRemoteToolTest} disabled={remoteTestLoading} className="h-8 bg-blue-600 hover:bg-blue-700 text-white w-full font-bold rounded-lg shadow-sm">
                    <Play className="h-3.5 w-3.5 mr-1 fill-current" /> {remoteTestLoading ? t("tool.executing") : t("tool.run_on_remote")}
                  </Button>
                  {remoteTestResult && (
                    <div className="border border-border rounded-lg bg-zinc-950 p-2 font-mono text-[10px] text-emerald-400 max-h-32 overflow-y-auto">
                      <pre className="whitespace-pre-wrap">{JSON.stringify(remoteTestResult, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Модалка Импорта с выбором целевой папки */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center border-b border-border pb-2">
              <span className="font-bold text-sm uppercase flex items-center gap-2">
                <Upload className="h-4 w-4 text-emerald-500" /> {t("cats.import_modal_title")}
              </span>
              <Button size="icon" variant="ghost" onClick={() => setImportModalOpen(false)} className="h-6 w-6 rounded-lg">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">{t("cats.import_target_folder")}</Label>
                <select 
                  className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-mono text-foreground focus:outline-none"
                  value={importTargetCatId} 
                  onChange={e => setImportTargetCatId(e.target.value)}
                >
                  <option value="">{t("cats.root_option")}</option>
                  {flatCategories.filter(c => c.type === 'LOCAL').map(c => (
                    <option key={c.id} value={c.id}>{c.fullPath}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">{t("cats.select_file")}</Label>
                <input 
                  type="file" 
                  accept=".tool,.toolpack,.json,.txt,*"
                  onChange={e => setImportFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-muted file:text-foreground hover:file:bg-muted/80 cursor-pointer border border-border rounded-lg p-1"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button size="sm" variant="ghost" onClick={() => setImportModalOpen(false)} className="h-8 text-xs rounded-lg">
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={handleExecuteImport} className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm">
                <Upload className="h-3.5 w-3.5 mr-1.5" /> {t("cats.import_action")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}