import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { HubSDK } from '../../../SDK/JS/sdk.ts';
import { callMcpStdio } from './mcp-helper.js';
import { callMcpPooled, killMcpProcess, getPoolStatus, cleanupAllPoolProcesses } from './mcp-pool.js';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

// Уникальный ID текущего экземпляра сервера для защиты от петель
const SERVER_NODE_ID = `hub_node_${Math.random().toString(36).substring(2, 9)}`;

const fastify = Fastify({
  logger: true,
  ignoreTrailingSlash: true,
  trustProxy: true
});

// Транслитерация кириллицы в латиницу для безопасных слагов
const cyrillicMap: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
};

const slugify = (text: string, defaultSlug = 'item'): string => {
  if (!text) return defaultSlug;
  let str = text.toLowerCase().trim();
  str = str.split('').map(char => cyrillicMap[char] || char).join('');
  str = str.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return str || defaultSlug;
};

// Хелперы парсинга аргументов командной строки с учетом кавычек
const parseCommandArgs = (argsStr?: string | null): string[] => {
  if (!argsStr || !argsStr.trim()) return [];
  const match = argsStr.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!match) return [];
  return match.map(arg => arg.replace(/^['"]|['"]$/g, ''));
};

// Хелперы безопасного парсинга JSON
const safeParseJson = (val: any, fallback: any = {}) => {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
};

const safeStringifyJson = (val: any, fallback: string = '{}') => {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val);
  } catch {
    return fallback;
  }
};

// Троттлированная очистка старых логов (защита от блокировок SQLite)
let lastCleanupTime = 0;
const CLEANUP_COOLDOWN_MS = 30_000;

// Запись аудита выполнения
const logExecution = async (params: {
  toolId?: number | null;
  path: string;
  durationMs: number;
  success: boolean;
  payload: any;
  result: any;
  error?: string | null;
  callerIp?: string;
}) => {
  try {
    await prisma.executionLog.create({
      data: {
        toolId: params.toolId || null,
        path: params.path,
        durationMs: params.durationMs,
        success: params.success,
        payload: safeStringifyJson(params.payload, '{}'),
        result: safeStringifyJson(params.result, null),
        error: params.error || null,
        callerIp: params.callerIp || '127.0.0.1'
      }
    });

    const now = Date.now();
    if (now - lastCleanupTime > CLEANUP_COOLDOWN_MS) {
      lastCleanupTime = now;
      const setting = await prisma.systemSetting.findFirst();
      const maxLogs = setting?.maxLogRetention || 1000;
      const count = await prisma.executionLog.count();
      if (count > maxLogs) {
        const oldestToKeep = await prisma.executionLog.findMany({
          take: 1,
          skip: maxLogs,
          orderBy: { id: 'desc' },
          select: { id: true }
        });
        if (oldestToKeep[0]) {
          await prisma.executionLog.deleteMany({
            where: { id: { lte: oldestToKeep[0].id } }
          });
        }
      }
    }
  } catch (e: any) {
    console.error('⚠️ ExecutionLog error:', e.message);
  }
};

// ==========================================
// --- 1. ГЛОБАЛЬНЫЕ ПЛАГИНЫ И ХЕЛПЕРЫ ---
// ==========================================

await fastify.register(cors, {
  origin: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-agent-password', 'x-admin-password', 'accept']
});

if (process.env.NODE_ENV !== 'production') {
  await fastify.register(swagger, {
    openapi: {
      info: { title: 'Tool Hub API', description: 'Оркестратор навыков и инструментов для AI-агентов', version: '1.5.0' },
      components: {
        securitySchemes: {
          agentAuth: { type: 'apiKey', name: 'x-agent-password', in: 'header' },
          adminAuth: { type: 'apiKey', name: 'x-admin-password', in: 'header' }
        }
      },
      tags: [
        { name: 'Agent API', description: 'Агентские эндпоинты навигации и исполнения' },
        { name: 'Admin Auth', description: 'Авторизация в панели управления' },
        { name: 'Categories', description: 'Управление деревом категорий' },
        { name: 'Tools', description: 'Управление инструментами и ревизиями' },
        { name: 'Runners', description: 'Управление средами исполнения (Runners)' },
        { name: 'MCP Pool', description: 'Управление пулом процессов MCP' },
        { name: 'Logs & Settings', description: 'Системные логи и настройки' },
        { name: 'Import/Export', description: 'Экспорт и импорт пакетов (.toolpack)' }
      ]
    }
  });

  await fastify.register(swaggerUi, { routePrefix: '/docs' });
}

const normalizePath = (p: string) => {
  let decoded = decodeURIComponent(p).trim();
  if (!decoded.startsWith('/')) decoded = '/' + decoded;
  return decoded.replace(/\/+$/, '') || '/';
};

const checkAgentAuth = async (request: any, reply: any): Promise<boolean> => {
  const settings = await prisma.systemSetting.findFirst();
  const secret = settings?.agentSecret || '123';
  if (request.headers['x-agent-password'] !== secret) {
    reply.status(401).send({ error: 'Unauthorized: Invalid Agent Password' });
    return true;
  }
  return false;
};

// Выполнение инструмента в изолированном воркспейсе
const executeTool = async (tool: any, payload: any) => {
  const startTime = Date.now();
  const runDir = path.join(os.tmpdir(), `hub_run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const timeoutMs = tool.timeoutMs || 30000;

  try {
    await fs.mkdir(runDir, { recursive: true });

    const runner = tool.runner;
    const rConfig = safeParseJson(runner?.config, {});

    // Защита от path traversal
    const codeFileName = path.basename(rConfig.codeFileName || 'index.ts');
    const runCmd = rConfig.runCmd || 'bun run index.ts';

    // 1. input.json
    await fs.writeFile(path.join(runDir, 'input.json'), JSON.stringify(payload || {}));

    // 2. Переменные окружения (INPUT_*)
    const env: Record<string, string> = { ...process.env };
    if (payload && typeof payload === 'object') {
      for (const [k, v] of Object.entries(payload)) {
        const sanitizedKey = k.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
        if (!['PATH', 'NODE_ENV', 'HOME', 'USER', 'SHELL'].includes(sanitizedKey)) {
          env[`INPUT_${sanitizedKey}`] = typeof v === 'object' ? JSON.stringify(v) : String(v);
        }
      }
    }

    // 3. Код инструмента
    await fs.writeFile(path.join(runDir, codeFileName), tool.code || '');

    // 4. Зависимости
    let hasDeps = false;
    if (rConfig.depFileName && tool.packageJson && tool.packageJson.trim().length > 0) {
      const depFileName = path.basename(rConfig.depFileName);
      await fs.writeFile(path.join(runDir, depFileName), tool.packageJson);
      hasDeps = true;
    }

    // 5. Установка зависимостей
    const maxBuffer = 10 * 1024 * 1024; // 10 MB buffer

    if (rConfig.installCmd && hasDeps) {
      console.log(`📦 [${tool.name}] Installing dependencies...`);
      await execAsync(rConfig.installCmd, { cwd: runDir, timeout: timeoutMs, maxBuffer });
    }

    // 6. Исполнение
    console.log(`🚀 [${tool.name}] Executing (${timeoutMs}ms limit): ${runCmd}`);
    const { stdout, stderr } = await execAsync(runCmd, { cwd: runDir, env, timeout: timeoutMs, maxBuffer });

    // 7. Сбор результата
    let finalResult;
    try {
      const outJson = await fs.readFile(path.join(runDir, 'output.json'), 'utf-8');
      finalResult = JSON.parse(outJson);
    } catch {
      const cleanStdout = stdout.trim();
      try {
        finalResult = JSON.parse(cleanStdout);
      } catch {
        finalResult = { raw: cleanStdout };
      }
    }

    return {
      success: true,
      data: finalResult,
      logs: stderr.trim() || undefined,
      durationMs: Date.now() - startTime
    };

  } catch (error: any) {
    const isTimeout = error.killed || error.signal === 'SIGTERM';
    const errorMsg = isTimeout ? `Execution Timeout Exceeded (${timeoutMs}ms)` : (error.stderr || error.message);
    console.error(`❌ Execution error [${tool.name}]:`, errorMsg);

    return {
      success: false,
      error: isTimeout ? 'Timeout Error' : 'Execution Error',
      details: errorMsg,
      durationMs: Date.now() - startTime
    };
  } finally {
    await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
  }
};

const extractMcpResponse = (response: any) => {
  if (!response) return null;
  if (response.result?.content && Array.isArray(response.result.content)) {
    const textItem = response.result.content.find((c: any) => c.type === 'text');
    if (textItem && typeof textItem.text === 'string') {
      try { return JSON.parse(textItem.text); } catch { return textItem.text; }
    }
    return response.result.content;
  }
  return response.result !== undefined ? response.result : response;
};

const callMcp = (cat: any, request: any) => {
  const mcpEnvParsed = safeParseJson(cat.mcpEnv, {});
  const args = parseCommandArgs(cat.mcpArgs);

  if (cat.mcpIsStateful) {
    return callMcpPooled(cat.id, cat.mcpCommand!, args, mcpEnvParsed, request);
  }
  return callMcpStdio(cat.mcpCommand!, args, mcpEnvParsed, request);
};

// Рекурсивный пересчет fullPath для всех дочерних категорий при перемещении
const updateChildCategoryPaths = async (parentId: number, parentFullPath: string) => {
  const children = await prisma.category.findMany({ where: { parentId } });
  for (const child of children) {
    const newFullPath = `${parentFullPath}/${child.slug}`.replace(/\/+/g, '/');
    await prisma.category.update({
      where: { id: child.id },
      data: { fullPath: newFullPath }
    });
    await updateChildCategoryPaths(child.id, newFullPath);
  }
};

// Авто-создание цепочки категорий (mkdir -p)
const ensureCategoryPath = async (categoryPath: string): Promise<number> => {
  const cleanPath = normalizePath(categoryPath);
  const segments = cleanPath.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error("Root category '/' cannot hold tools directly. Specify a subfolder.");
  }

  let parentId: number | null = null;
  let currentFullPath = '';

  for (const segment of segments) {
    const slug = slugify(segment, 'cat');
    currentFullPath = `${currentFullPath}/${slug}`;

    let cat = await prisma.category.findFirst({
      where: { fullPath: currentFullPath }
    });

    if (!cat) {
      cat = await prisma.category.create({
        data: {
          name: segment,
          slug,
          fullPath: currentFullPath,
          parentId,
          type: 'LOCAL',
          isActive: true
        }
      });
    }
    parentId = cat.id;
  }

  return parentId!;
};

// ==========================================
// --- 2. АДМИНСКОЕ API (/admin/api) ---
// ==========================================

fastify.register(async (admin) => {

  admin.addHook('onRequest', async (req, reply) => {
    if (req.url === '/admin/api/auth/verify') return;

    const settings = await prisma.systemSetting.findFirst();
    const adminPass = settings?.adminPassword || 'admin';
    const providedPass = req.headers['x-admin-password'];

    if (!providedPass || providedPass !== adminPass) {
      return reply.status(401).send({ error: 'Unauthorized Admin Access: Invalid x-admin-password' });
    }
  });

  admin.post('/auth/verify', {
    schema: {
      tags: ['Admin Auth'],
      summary: 'Проверка пароля админа',
      body: {
        type: 'object',
        properties: { password: { type: 'string' } },
        required: ['password']
      }
    }
  }, async (req: any, reply) => {
    const { password } = req.body || {};
    const settings = await prisma.systemSetting.findFirst();
    const adminPass = settings?.adminPassword || 'admin';

    if (password === adminPass) {
      return { success: true };
    }
    return reply.status(401).send({ error: 'Invalid admin password' });
  });

  admin.post('/test-tool/*', {
    schema: {
      tags: ['Tools'],
      summary: 'Тестовый запуск инструмента из админки',
      security: [{ adminAuth: [] }]
    }
  }, async (req, reply) => {
    const rawPath = (req.params as any)['*'];
    const fullPath = '/' + rawPath.replace(/^\/+/, '');
    const body = req.body || {};

    const pathParts = fullPath.split('/').filter(Boolean);
    const toolSlug = pathParts.pop();
    const categoryPath = '/' + pathParts.join('/');

    const dbTool = await prisma.tool.findFirst({
      where: {
        slug: toolSlug,
        categories: {
          some: {
            category: { fullPath: categoryPath }
          }
        }
      },
      include: {
        runner: true,
        categories: { include: { category: true } }
      }
    });

    if (dbTool) {
      try {
        const startTime = Date.now();
        const res = await executeTool(dbTool, body);

        await logExecution({
          toolId: dbTool.id,
          path: fullPath,
          durationMs: res.durationMs || (Date.now() - startTime),
          success: res.success !== false,
          payload: body,
          result: res.data || res,
          error: res.error ? (res.details || res.error) : null,
          callerIp: req.ip
        });

        return res;
      } catch (e: any) {
        return reply.status(500).send({ error: e.message });
      }
    }

    const category = await prisma.category.findFirst({
      where: { fullPath: categoryPath }
    });

    if (category && category.type === 'MCP') {
      try {
        const startTime = Date.now();
        const response = await callMcp(category, {
          method: 'tools/call',
          params: { name: toolSlug, arguments: body }
        });

        const parsedData = extractMcpResponse(response);
        const durationMs = Date.now() - startTime;

        await logExecution({
          path: fullPath,
          durationMs,
          success: true,
          payload: body,
          result: parsedData,
          callerIp: req.ip
        });

        return { success: true, data: parsedData, durationMs };
      } catch (e: any) {
        return reply.status(500).send({ error: `MCP Execution Error: ${e.message}` });
      }
    }

    const rootCatName = pathParts[0];
    if (rootCatName) {
      const rootCat = await prisma.category.findFirst({
        where: { fullPath: '/' + rootCatName, type: 'REMOTE' }
      });

      if (rootCat && rootCat.remoteUrl) {
        try {
          const startTime = Date.now();
          const sdk = new HubSDK(rootCat.remoteUrl, rootCat.remoteToken || undefined);
          const remoteRelativePath = fullPath.replace('/' + rootCatName, '');
          const result = await sdk.callTool(remoteRelativePath, body);
          const durationMs = Date.now() - startTime;

          await logExecution({
            path: fullPath,
            durationMs,
            success: result?.success !== false,
            payload: body,
            result: result?.data || result,
            error: result?.error || null,
            callerIp: req.ip
          });

          return { success: true, data: result, durationMs };
        } catch (e: any) {
          return reply.status(500).send({ error: `Remote Proxy Error: ${e.message}` });
        }
      }
    }

    return reply.status(404).send({ error: `Tool or Category not found at path: ${fullPath}` });
  });

  admin.get('/settings', {
    schema: { tags: ['Logs & Settings'], summary: 'Получить настройки системы', security: [{ adminAuth: [] }] }
  }, async () => await prisma.systemSetting.findFirst());

  admin.put('/settings', {
    schema: {
      tags: ['Logs & Settings'],
      summary: 'Обновить настройки системы',
      security: [{ adminAuth: [] }],
      body: {
        type: 'object',
        properties: {
          adminPassword: { type: 'string' },
          agentSecret: { type: 'string' },
          rootPrompt: { type: 'string' },
          rootAppendPrompt: { type: 'string' },
          maxLogRetention: { type: 'integer' }
        }
      }
    }
  }, async (req: any) => {
    const s = await prisma.systemSetting.findFirst();
    if (!s) return { error: 'Settings not found' };
    return await prisma.systemSetting.update({ where: { id: s.id }, data: req.body });
  });

  admin.get('/logs', {
    schema: {
      tags: ['Logs & Settings'],
      summary: 'Получить аудит-логи с пагинацией',
      security: [{ adminAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 50 },
          search: { type: 'string' }
        }
      }
    }
  }, async (req: any) => {
    const page = Math.max(Number(req.query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 10), 500);
    const search = (req.query?.search || '').toString().trim();

    const where: any = search ? {
      OR: [
        { path: { contains: search } },
        { error: { contains: search } },
        { tool: { name: { contains: search } } }
      ]
    } : {};

    const [total, logs] = await Promise.all([
      prisma.executionLog.count({ where }),
      prisma.executionLog.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { id: 'desc' },
        include: { tool: { select: { name: true, slug: true } } }
      })
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      logs: logs.map(l => ({
        ...l,
        payload: safeParseJson(l.payload, {}),
        result: safeParseJson(l.result, null)
      }))
    };
  });

  admin.delete('/logs', {
    schema: { tags: ['Logs & Settings'], summary: 'Очистить все логи аудита', security: [{ adminAuth: [] }] }
  }, async () => {
    await prisma.executionLog.deleteMany({});
    return { success: true };
  });

  admin.get('/mcp/pool', {
    schema: { tags: ['MCP Pool'], summary: 'Статус горячего пула процессов MCP', security: [{ adminAuth: [] }] }
  }, async () => getPoolStatus());

  admin.delete('/mcp/pool/:catId', {
    schema: {
      tags: ['MCP Pool'],
      summary: 'Завершить MCP процесс из пула',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { catId: { type: 'integer' } }, required: ['catId'] }
    }
  }, async (req: any) => {
    killMcpProcess(Number(req.params.catId));
    return { success: true };
  });

  admin.get('/categories', {
    schema: { tags: ['Categories'], summary: 'Список всех категорий', security: [{ adminAuth: [] }] }
  }, async () => {
    const cats = await prisma.category.findMany({
      include: {
        _count: { select: { children: true, tools: true } },
        tools: { include: { tool: true } }
      }
    });

    return cats.map(c => ({
      ...c,
      mcpEnv: safeParseJson(c.mcpEnv, {}),
      mcpToolsCache: safeParseJson(c.mcpToolsCache, null)
    }));
  });

  admin.post<{ Params: { id: string } }>('/categories/:id/ping', {
    schema: {
      tags: ['Categories'],
      summary: 'Проверка доступности REMOTE узла',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
    }
  }, async (req, reply) => {
    const cat = await prisma.category.findUnique({ where: { id: Number(req.params.id) } });
    if (!cat || cat.type !== 'REMOTE' || !cat.remoteUrl) {
      return reply.status(400).send({ error: 'Category is not a REMOTE node' });
    }

    const startTime = Date.now();
    try {
      const sdk = new HubSDK(cat.remoteUrl, cat.remoteToken || undefined);
      const res = await sdk.listTools('/');
      return {
        online: true,
        latencyMs: Date.now() - startTime,
        categoriesCount: res.categories?.length || 0
      };
    } catch (e: any) {
      return { online: false, error: e.message, latencyMs: Date.now() - startTime };
    }
  });

  admin.post<{ Params: { id: string } }>('/categories/:id/remote-tree', {
    schema: {
      tags: ['Categories'],
      summary: 'Рекурсивная загрузка дерева REMOTE узла',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
    }
  }, async (req, reply) => {
    const cat = await prisma.category.findUnique({ where: { id: Number(req.params.id) } });
    if (!cat || cat.type !== 'REMOTE' || !cat.remoteUrl) {
      return reply.status(400).send({ error: 'Category is not a REMOTE node' });
    }

    try {
      const sdk = new HubSDK(cat.remoteUrl, cat.remoteToken || undefined);
      const currentPort = Number(process.env.PORT) || 3000;
      const remoteUrlStr = cat.remoteUrl.toLowerCase();

      const isSelf = remoteUrlStr.includes(`:${currentPort}`) ||
                     remoteUrlStr.includes(`localhost:${currentPort}`) ||
                     remoteUrlStr.includes(`127.0.0.1:${currentPort}`);

      const maxDepth = 15;
      const visited = new Set<string>();

      const fetchNode = async (currentPath: string, depth = 0): Promise<any> => {
        if (visited.has(currentPath) || depth > maxDepth) return { categories: [], tools: [] };
        visited.add(currentPath);

        try {
          const data = await sdk.listTools(currentPath);
          const categories: any[] = [];
          const tools: any[] = data.tools || [];

          if (data.categories) {
            for (const subCat of data.categories) {
              if (isSelf && (subCat.path === cat.fullPath || subCat.path.startsWith(cat.fullPath + '/'))) {
                continue;
              }

              const subTree = await fetchNode(subCat.path, depth + 1);
              categories.push({
                name: subCat.name,
                path: subCat.path,
                children: subTree.categories,
                tools: subTree.tools
              });
            }
          }

          return { categories, tools };
        } catch {
          return { categories: [], tools: [] };
        }
      };

      const tree = await fetchNode('/');
      return { success: true, isSelf, maxDepth, tree };
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });

  const categoryBodySchema = {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      parentId: { type: ['integer', 'null'] },
      appendPrompt: { type: 'string' },
      type: { type: 'string', enum: ['LOCAL', 'REMOTE', 'MCP'] },
      isActive: { type: 'boolean' },
      remoteUrl: { type: 'string' },
      remoteToken: { type: 'string' },
      mcpCommand: { type: 'string' },
      mcpArgs: { type: 'string' },
      mcpEnv: { type: 'object' },
      mcpIsStateful: { type: 'boolean' }
    }
  };

  const saveCategory = async (req: any, reply: any, id?: number) => {
    try {
      let {
        name, parentId, parentPath, appendPrompt, type, isActive,
        remoteUrl, remoteToken,
        mcpCommand, mcpArgs, mcpEnv, mcpIsStateful
      } = req.body;

      if (!parentId && parentPath) {
        try {
          parentId = await ensureCategoryPath(parentPath);
        } catch {}
      }

      const parsedParentId = parentId ? Number(parentId) : null;

      if (id && parsedParentId === id) {
        return reply.status(400).send({ error: "A category cannot be its own parent" });
      }

      const cleanSlug = slugify(name, 'cat');
      let fullPath = `/${cleanSlug}`;

      if (parsedParentId) {
        const parent = await prisma.category.findUnique({ where: { id: parsedParentId } });
        if (parent) {
          if (id && (parent.fullPath === fullPath || parent.fullPath.startsWith(fullPath + '/'))) {
            return reply.status(400).send({ error: "Cannot move category inside its own subfolder" });
          }
          fullPath = `${parent.fullPath}/${cleanSlug}`.replace(/\/+/g, '/');
        }
      }

      // Проверка на зацикливание при попытке добавить REMOTE (включая добавление самого себя)
      if (type === 'REMOTE' && remoteUrl) {
        const cleanRemoteUrl = remoteUrl.trim().replace(/\/+$/, '');
        const currentPort = Number(process.env.PORT) || 3000;
        const isSelfUrl = cleanRemoteUrl.includes(`:${currentPort}`) || 
                          cleanRemoteUrl.includes(`localhost:${currentPort}`) || 
                          cleanRemoteUrl.includes(`127.0.0.1:${currentPort}`);

        if (isSelfUrl) {
          return reply.status(400).send({ error: 'Cycle protection!' });
        }

        try {
          const testSdk = new HubSDK(cleanRemoteUrl, remoteToken || undefined, {
            'x-hub-nodes': SERVER_NODE_ID
          });
          const testRes = await testSdk.listTools('/');
          if (testRes?.isCycle) {
            return reply.status(400).send({ error: 'Cycle protection!' });
          }
        } catch (e: any) {
          if (e.message?.includes('Cycle Protection')) {
            return reply.status(400).send({ error: 'Cycle protection!' });
          }
        }
      }

      const data = {
        name,
        slug: cleanSlug,
        fullPath,
        isActive: isActive !== undefined ? isActive : true,
        parentId: parsedParentId,
        appendPrompt,
        type: type || 'LOCAL',
        remoteUrl,
        remoteToken,
        mcpCommand,
        mcpArgs,
        mcpEnv: safeStringifyJson(mcpEnv, '{}'),
        mcpIsStateful: mcpIsStateful ?? false
      };

      let resultCat;
      if (id) {
        resultCat = await prisma.category.update({ where: { id }, data });
        await updateChildCategoryPaths(id, fullPath);
      } else {
        resultCat = await prisma.category.create({ data });
      }
      return resultCat;
    } catch (e: any) {
      if (e.code === 'P2002') {
        return reply.status(400).send({ error: 'Category with this path already exists' });
      }
      return reply.status(500).send({ error: e.message });
    }
  };

  admin.post('/categories', {
    schema: { tags: ['Categories'], summary: 'Создать категорию', security: [{ adminAuth: [] }], body: categoryBodySchema }
  }, (req, reply) => saveCategory(req, reply));

  admin.put<{ Params: { id: string } }>('/categories/:id', {
    schema: {
      tags: ['Categories'],
      summary: 'Обновить категорию',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      body: categoryBodySchema
    }
  }, (req, reply) => saveCategory(req, reply, Number(req.params.id)));

  admin.post<{ Params: { id: string } }>('/categories/:id/mcp-sync', {
    schema: {
      tags: ['Categories'],
      summary: 'Синхронизация схем инструментов MCP сервера',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
    }
  }, async (req, reply) => {
    const cat = await prisma.category.findUnique({ where: { id: Number(req.params.id) } });
    if (!cat || cat.type !== 'MCP') return reply.status(400).send({ error: 'Not an MCP category' });

    try {
      const result = await callMcp(cat, { method: 'tools/list', params: {} });
      const tools = result.result || result;
      await prisma.category.update({
        where: { id: cat.id },
        data: { mcpToolsCache: JSON.stringify(tools) }
      });

      return { success: true, count: tools.tools?.length || 0 };
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });

  async function deleteCategoryRecursive(categoryId: number) {
    const children = await prisma.category.findMany({
      where: { parentId: categoryId },
      select: { id: true }
    });

    for (const child of children) {
      await deleteCategoryRecursive(child.id);
    }

    const boundTools = await prisma.toolCategory.findMany({
      where: { categoryId },
      select: { toolId: true }
    });

    await prisma.toolCategory.deleteMany({ where: { categoryId } });

    for (const { toolId } of boundTools) {
      const remainingBindings = await prisma.toolCategory.count({ where: { toolId } });
      if (remainingBindings === 0) {
        await prisma.toolVersion.deleteMany({ where: { toolId } });
        await prisma.tool.delete({ where: { id: toolId } }).catch(() => {});
      }
    }

    await prisma.category.delete({ where: { id: categoryId } });
  }

  admin.delete<{ Params: { id: string } }>('/categories/:id', {
    schema: {
      tags: ['Categories'],
      summary: 'Рекурсивное удаление категории со всем содержимым',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
    }
  }, async (req, reply) => {
    const id = Number(req.params.id);
    try {
      await deleteCategoryRecursive(id);
      return { success: true };
    } catch (e: any) {
      return reply.status(500).send({ error: `Delete category error: ${e.message}` });
    }
  });

  admin.post('/mcp/promote', {
    schema: {
      tags: ['Categories'],
      summary: 'Промоут динамического MCP инструмента в нативную БД',
      security: [{ adminAuth: [] }],
      body: {
        type: 'object',
        required: ['categoryId', 'mcpToolName'],
        properties: { categoryId: { type: 'integer' }, mcpToolName: { type: 'string' } }
      }
    }
  }, async (req: any, reply) => {
    const { categoryId, mcpToolName } = req.body;

    const source = await prisma.category.findUnique({ where: { id: Number(categoryId) } });
    if (!source || source.type !== 'MCP') return reply.status(400).send({ error: 'Source category is not MCP' });

    const cache: any = safeParseJson(source.mcpToolsCache, null);
    const mcpTool = cache?.tools?.find((t: any) => t.name === mcpToolName);
    if (!mcpTool) return reply.status(404).send({ error: 'Tool not found in MCP cache' });

    let defaultRunner = await prisma.runner.findFirst();
    if (!defaultRunner) {
      defaultRunner = await prisma.runner.create({
        data: { name: 'Bun', type: 'NODE', config: JSON.stringify({ runCmd: 'bun run index.ts', codeFileName: 'index.ts' }) }
      });
    }

    const toolSlug = slugify(`${source.slug}-${mcpTool.name}`, 'mcp-tool');

    return await prisma.tool.create({
      data: {
        name: `[MCP] ${mcpTool.name}`,
        slug: toolSlug,
        agentDescription: mcpTool.description || `MCP tool from ${source.name}`,
        inputSchema: safeStringifyJson(mcpTool.inputSchema, '{}'),
        outputSchema: safeStringifyJson(mcpTool.outputSchema, null),
        isMcpProxy: true,
        mcpMethodName: mcpTool.name,
        mcpSourceId: source.id,
        runnerId: defaultRunner.id,
        code: '',
        isActive: true,
        categories: {
          create: { categoryId: source.id }
        }
      }
    });
  });

  admin.get('/tools', {
    schema: { tags: ['Tools'], summary: 'Список всех инструментов', security: [{ adminAuth: [] }] }
  }, async () => {
    const tools = await prisma.tool.findMany({
      include: { categories: { include: { category: true } }, runner: true }
    });

    return tools.map(t => ({
      ...t,
      inputSchema: safeParseJson(t.inputSchema, {}),
      outputSchema: safeParseJson(t.outputSchema, {}),
      examples: safeParseJson(t.examples, []),
      runner: t.runner ? { ...t.runner, config: safeParseJson(t.runner.config, {}) } : null
    }));
  });

  admin.get('/tools/:id', {
    schema: {
      tags: ['Tools'],
      summary: 'Получить инструмент по ID',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
    }
  }, async (req: any, reply) => {
    const tool = await prisma.tool.findUnique({
      where: { id: Number(req.params.id) },
      include: { categories: { include: { category: true } }, runner: true }
    });
    if (!tool) return reply.status(404).send({ error: 'Tool not found' });

    return {
      ...tool,
      inputSchema: safeParseJson(tool.inputSchema, {}),
      outputSchema: safeParseJson(tool.outputSchema, {}),
      examples: safeParseJson(tool.examples, []),
      runner: tool.runner ? { ...tool.runner, config: safeParseJson(tool.runner.config, {}) } : null
    };
  });

  admin.get('/tools/:id/history', {
    schema: {
      tags: ['Tools'],
      summary: 'История версий кода и схем инструмента',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
    }
  }, async (req: any) => {
    const versions = await prisma.toolVersion.findMany({
      where: { toolId: Number(req.params.id) },
      orderBy: { id: 'asc' }
    });

    return versions.map((v, index) => ({
      ...v,
      versionNum: index + 1
    })).reverse();
  });

  admin.delete('/tools/:id/history/:versionId', {
    schema: {
      tags: ['Tools'],
      summary: 'Удалить ревизию из истории',
      security: [{ adminAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'integer' }, versionId: { type: 'integer' } },
        required: ['id', 'versionId']
      }
    }
  }, async (req: any) => {
    return await prisma.toolVersion.delete({
      where: { id: Number(req.params.versionId) }
    });
  });

  admin.post('/tools/:id/rollback/:versionId', {
    schema: {
      tags: ['Tools'],
      summary: 'Откатить инструмент к указанной версии',
      security: [{ adminAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'integer' }, versionId: { type: 'integer' } },
        required: ['id', 'versionId']
      }
    }
  }, async (req: any, reply) => {
    const version = await prisma.toolVersion.findUnique({
      where: { id: Number(req.params.versionId) }
    });
    if (!version) return reply.status(404).send({ error: 'Version not found' });

    const updated = await prisma.tool.update({
      where: { id: Number(req.params.id) },
      data: {
        code: version.code,
        inputSchema: version.inputSchema,
        agentDescription: version.agentDescription
      },
      include: { categories: { include: { category: true } }, runner: true }
    });

    return {
      ...updated,
      inputSchema: safeParseJson(updated.inputSchema, {}),
      outputSchema: safeParseJson(updated.outputSchema, {}),
      examples: safeParseJson(updated.examples, []),
      runner: updated.runner ? { ...updated.runner, config: safeParseJson(updated.runner.config, {}) } : null
    };
  });

  const toolBodySchema = {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      slug: { type: 'string' },
      runnerId: { type: 'integer' },
      categoryIds: { type: 'array', items: { type: 'integer' } },
      categoryPath: { type: 'string' },
      isActive: { type: 'boolean' },
      isMcpProxy: { type: 'boolean' },
      mcpMethodName: { type: 'string' },
      mcpSourceId: { type: ['integer', 'null'] },
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      examples: { type: 'array' },
      timeoutMs: { type: 'integer' },
      code: { type: 'string' },
      agentDescription: { type: 'string' }
    }
  };

  admin.post('/tools', {
    schema: { tags: ['Tools'], summary: 'Создать инструмент', security: [{ adminAuth: [] }], body: toolBodySchema }
  }, async (req: any, reply) => {
    let { name, slug, runnerId, categoryIds, categoryPath, isActive, isMcpProxy, mcpMethodName, mcpSourceId, inputSchema, outputSchema, examples, timeoutMs, code, agentDescription, ...rest } = req.body;

    // Авто-создание папки (mkdir -p), если передан categoryPath вместо categoryIds
    if (categoryPath && (!categoryIds || categoryIds.length === 0)) {
      try {
        const catId = await ensureCategoryPath(categoryPath);
        categoryIds = [catId];
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }

    if (!categoryIds || categoryIds.length === 0) {
      return reply.status(400).send({ error: 'Select at least one category or specify "categoryPath"' });
    }

    for (const catId of categoryIds) {
      const cat = await prisma.category.findUnique({ where: { id: Number(catId) }, include: { children: true } });
      if (cat && cat.children.length > 0) return reply.status(400).send({ error: `Folder ${cat.fullPath} contains subfolders` });
    }

    const cleanSlug = slugify(slug || name, 'tool');
    const duplicate = await prisma.tool.findFirst({
      where: {
        slug: cleanSlug,
        categories: { some: { categoryId: { in: categoryIds.map((id: any) => Number(id)) } } }
      }
    });

    if (duplicate) {
      return reply.status(400).send({ error: `Tool with slug "${cleanSlug}" already exists in the selected folder` });
    }

    let finalRunnerId = Number(runnerId);
    if (!finalRunnerId) {
      const defRunner = await prisma.runner.findFirst();
      if (defRunner) finalRunnerId = defRunner.id;
    }

    const createdTool = await prisma.tool.create({
      data: {
        ...rest,
        name,
        slug: cleanSlug,
        code: code || '',
        agentDescription: agentDescription || '',
        runnerId: finalRunnerId,
        inputSchema: safeStringifyJson(inputSchema, '{}'),
        outputSchema: safeStringifyJson(outputSchema, '{}'),
        examples: safeStringifyJson(examples, '[]'),
        timeoutMs: Number(timeoutMs) || 30000,
        isActive: isActive !== undefined ? !!isActive : true,
        isMcpProxy: !!isMcpProxy,
        mcpMethodName,
        mcpSourceId: mcpSourceId ? Number(mcpSourceId) : null,
        categories: { create: categoryIds.map((id: any) => ({ categoryId: Number(id) })) }
      }
    });

    await prisma.toolVersion.create({
      data: {
        toolId: createdTool.id,
        code: createdTool.code,
        inputSchema: createdTool.inputSchema,
        agentDescription: createdTool.agentDescription
      }
    });

    return createdTool;
  });

  admin.put('/tools/:id', {
    schema: {
      tags: ['Tools'],
      summary: 'Обновить инструмент',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      body: toolBodySchema
    }
  }, async (req: any, reply) => {
    let { categoryIds, categoryPath, runnerId, id, isActive, isMcpProxy, mcpMethodName, mcpSourceId, inputSchema, outputSchema, examples, timeoutMs, code, agentDescription, slug, ...data } = req.body;
    const toolId = Number(req.params.id);

    if (categoryPath && (!categoryIds || categoryIds.length === 0)) {
      try {
        const catId = await ensureCategoryPath(categoryPath);
        categoryIds = [catId];
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }

    const cleanSlug = slug ? slugify(slug, 'tool') : undefined;

    if (cleanSlug && categoryIds && categoryIds.length > 0) {
      const duplicate = await prisma.tool.findFirst({
        where: {
          id: { not: toolId },
          slug: cleanSlug,
          categories: { some: { categoryId: { in: categoryIds.map((cId: any) => Number(cId)) } } }
        }
      });

      if (duplicate) {
        return reply.status(400).send({ error: `Conflict: Tool with slug "${cleanSlug}" already exists in this folder` });
      }
    }

    const updated = await prisma.tool.update({
      where: { id: toolId },
      data: {
        ...data,
        slug: cleanSlug,
        code: code ?? '',
        agentDescription: agentDescription ?? '',
        inputSchema: safeStringifyJson(inputSchema, '{}'),
        outputSchema: safeStringifyJson(outputSchema, '{}'),
        examples: safeStringifyJson(examples, '[]'),
        timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
        isActive: isActive !== undefined ? !!isActive : true,
        isMcpProxy: !!isMcpProxy,
        mcpMethodName,
        mcpSourceId: mcpSourceId ? Number(mcpSourceId) : null,
        runnerId: runnerId ? Number(runnerId) : undefined,
        categories: categoryIds ? {
          deleteMany: {},
          create: categoryIds.map((id: any) => ({ categoryId: Number(id) }))
        } : undefined
      }
    });

    await prisma.toolVersion.create({
      data: {
        toolId: updated.id,
        code: updated.code,
        inputSchema: updated.inputSchema,
        agentDescription: updated.agentDescription
      }
    });

    return updated;
  });

  admin.delete('/tools/*', {
    schema: {
      tags: ['Tools'],
      summary: 'Удалить инструмент по ID или пути',
      security: [{ adminAuth: [] }]
    }
  }, async (req: any, reply) => {
    const rawParam = req.params['*'] || '';
    if (!rawParam) return reply.status(400).send({ error: 'toolPath is required' });

    if (/^\d+$/.test(rawParam)) {
      const toolId = Number(rawParam);
      await prisma.toolCategory.deleteMany({ where: { toolId } });
      await prisma.toolVersion.deleteMany({ where: { toolId } });
      await prisma.tool.delete({ where: { id: toolId } }).catch(() => {});
      return { success: true, deletedId: toolId };
    }

    const cleanPath = normalizePath(rawParam);
    const parts = cleanPath.split('/').filter(Boolean);
    const toolSlug = parts.pop();
    const categoryPath = '/' + parts.join('/');

    const tool = await prisma.tool.findFirst({
      where: {
        slug: toolSlug,
        categories: { some: { category: { fullPath: categoryPath } } }
      }
    });

    if (!tool) {
      return reply.status(404).send({ error: `Tool at path "${cleanPath}" not found` });
    }

    await prisma.toolCategory.deleteMany({ where: { toolId: tool.id } });
    await prisma.toolVersion.deleteMany({ where: { toolId: tool.id } });
    await prisma.tool.delete({ where: { id: tool.id } });

    return { success: true, deletedPath: cleanPath };
  });

  admin.get('/runners', {
    schema: { tags: ['Runners'], summary: 'Список всех раннеров', security: [{ adminAuth: [] }] }
  }, async () => {
    const runners = await prisma.runner.findMany();
    return runners.map(r => ({ ...r, config: safeParseJson(r.config, {}) }));
  });

  admin.get('/runners/:id', {
    schema: {
      tags: ['Runners'],
      summary: 'Получить раннер по ID',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
    }
  }, async (req: any, reply) => {
    const runner = await prisma.runner.findUnique({ where: { id: Number(req.params.id) } });
    if (!runner) return reply.status(404).send({ error: 'Runner not found' });
    return { ...runner, config: safeParseJson(runner.config, {}) };
  });

  const runnerBodySchema = {
    type: 'object',
    required: ['name', 'type'],
    properties: {
      name: { type: 'string' },
      type: { type: 'string' },
      config: {
        oneOf: [
          { type: 'object' },
          { type: 'string' }
        ]
      }
    }
  };

  admin.post('/runners', {
    schema: { tags: ['Runners'], summary: 'Создать раннер', security: [{ adminAuth: [] }], body: runnerBodySchema }
  }, async (req: any) => {
    const { config, ...rest } = req.body;
    return await prisma.runner.create({
      data: { ...rest, config: safeStringifyJson(config, '{}') }
    });
  });

  admin.put('/runners/:id', {
    schema: {
      tags: ['Runners'],
      summary: 'Обновить раннер',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      body: runnerBodySchema
    }
  }, async (req: any) => {
    const { config, ...rest } = req.body;
    return await prisma.runner.update({
      where: { id: Number(req.params.id) },
      data: { ...rest, config: safeStringifyJson(config, '{}') }
    });
  });

  admin.delete('/runners/:id', {
    schema: {
      tags: ['Runners'],
      summary: 'Удалить раннер',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
    }
  }, async (req: any) => {
    return await prisma.runner.delete({ where: { id: Number(req.params.id) } });
  });

  // ==========================================
  // --- ИМПОРТ И ЭКСПОРТ (TOOLS & TOOLPACKS) ---
  // ==========================================

  admin.get('/export/tool/:id', {
    schema: {
      tags: ['Import/Export'],
      summary: 'Экспорт одиночного инструмента в JSON',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
    }
  }, async (req: any, reply) => {
    const tool = await prisma.tool.findUnique({
      where: { id: Number(req.params.id) },
      include: { runner: true }
    });
    if (!tool) return reply.status(404).send({ error: 'Tool not found' });

    return {
      kind: 'TOOLHUB_TOOL',
      version: 1,
      tool: {
        name: tool.name,
        slug: tool.slug,
        agentDescription: tool.agentDescription,
        code: tool.code,
        packageJson: tool.packageJson,
        inputSchema: safeParseJson(tool.inputSchema, {}),
        outputSchema: safeParseJson(tool.outputSchema, {}),
        examples: safeParseJson(tool.examples, []),
        timeoutMs: tool.timeoutMs,
        isMcpProxy: tool.isMcpProxy,
        mcpMethodName: tool.mcpMethodName,
        runnerType: tool.runner?.type || 'bun_local',
        runnerName: tool.runner?.name || 'Bun'
      }
    };
  });

  const exportCategoryRecursive = async (catId: number): Promise<any> => {
    const cat = await prisma.category.findUnique({
      where: { id: catId },
      include: {
        tools: { include: { tool: { include: { runner: true } } } },
        children: true
      }
    });

    if (!cat) return null;

    const toolsData = cat.tools.map(rel => ({
      name: rel.tool.name,
      slug: rel.tool.slug,
      agentDescription: rel.tool.agentDescription,
      code: rel.tool.code,
      packageJson: rel.tool.packageJson,
      inputSchema: safeParseJson(rel.tool.inputSchema, {}),
      outputSchema: safeParseJson(rel.tool.outputSchema, {}),
      examples: safeParseJson(rel.tool.examples, []),
      timeoutMs: rel.tool.timeoutMs,
      isMcpProxy: rel.tool.isMcpProxy,
      mcpMethodName: rel.tool.mcpMethodName,
      runnerType: rel.tool.runner?.type || 'bun_local',
      runnerName: rel.tool.runner?.name || 'Bun'
    }));

    const childrenData = await Promise.all(cat.children.map(child => exportCategoryRecursive(child.id)));

    return {
      name: cat.name,
      slug: cat.slug,
      appendPrompt: cat.appendPrompt,
      type: cat.type,
      remoteUrl: cat.remoteUrl,
      remoteToken: cat.remoteToken,
      mcpCommand: cat.mcpCommand,
      mcpArgs: cat.mcpArgs,
      mcpEnv: safeParseJson(cat.mcpEnv, {}),
      mcpIsStateful: cat.mcpIsStateful,
      tools: toolsData,
      children: childrenData.filter(Boolean)
    };
  };

  admin.get('/export/category/:id', {
    schema: {
      tags: ['Import/Export'],
      summary: 'Экспорт всей категории со всеми вложенностями (.toolpack)',
      security: [{ adminAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
    }
  }, async (req: any, reply) => {
    const exported = await exportCategoryRecursive(Number(req.params.id));
    if (!exported) return reply.status(404).send({ error: 'Category not found' });

    return {
      kind: 'TOOLHUB_PACK',
      version: 1,
      category: exported
    };
  });

  admin.post('/import', {
    schema: {
      tags: ['Import/Export'],
      summary: 'Импорт инструмента или пака (.toolpack)',
      security: [{ adminAuth: [] }],
      body: {
        type: 'object',
        required: ['payload'],
        properties: {
          payload: { type: 'object' },
          targetCategoryId: { type: ['integer', 'null'] }
        }
      }
    }
  }, async (req: any, reply) => {
    const { payload, targetCategoryId } = req.body || {};
    if (!payload || !payload.kind) return reply.status(400).send({ error: 'Invalid ToolHub package format. Missing "kind" field.' });

    let defaultRunner = await prisma.runner.findFirst();
    if (!defaultRunner) {
      defaultRunner = await prisma.runner.create({
        data: { name: 'Bun', type: 'bun_local', config: JSON.stringify({ runCmd: 'bun run index.ts', codeFileName: 'index.ts' }) }
      });
    }

    const resolveRunner = async (toolData: any) => {
      const typeKey = (toolData.runnerType || '').trim();
      const nameKey = (toolData.runnerName || '').trim();

      const found = await prisma.runner.findFirst({
        where: {
          OR: [
            ...(typeKey ? [{ type: typeKey }, { name: typeKey }] : []),
            ...(nameKey ? [{ name: nameKey }, { type: nameKey }] : [])
          ]
        }
      });
      return found || defaultRunner;
    };

    if (payload.kind === 'TOOLHUB_TOOL' && payload.tool) {
      const t = payload.tool;
      const runner = await resolveRunner(t);

      let categoryIdToBind = targetCategoryId ? Number(targetCategoryId) : null;

      if (!categoryIdToBind) {
        let importedCat = await prisma.category.findFirst({ where: { fullPath: '/imported' } });
        if (!importedCat) {
          importedCat = await prisma.category.create({
            data: {
              name: 'Imported Tools',
              slug: 'imported',
              fullPath: '/imported',
              type: 'LOCAL',
              isActive: true,
              appendPrompt: 'Папка авто-импортированных одиночных инструментов'
            }
          });
        }
        categoryIdToBind = importedCat.id;
      }

      const created = await prisma.tool.create({
        data: {
          name: t.name,
          slug: slugify(t.slug || t.name, 'imported-tool'),
          agentDescription: t.agentDescription || '',
          code: t.code || '',
          packageJson: t.packageJson || '',
          inputSchema: safeStringifyJson(t.inputSchema, '{}'),
          outputSchema: safeStringifyJson(t.outputSchema, '{}'),
          examples: safeStringifyJson(t.examples, '[]'),
          timeoutMs: t.timeoutMs || 30000,
          isMcpProxy: !!t.isMcpProxy,
          mcpMethodName: t.mcpMethodName,
          runnerId: runner.id,
          categories: { create: { categoryId: categoryIdToBind } }
        }
      });

      await prisma.toolVersion.create({
        data: {
          toolId: created.id,
          code: created.code,
          inputSchema: created.inputSchema,
          agentDescription: created.agentDescription
        }
      });

      return { success: true, importedType: 'TOOL', toolName: created.name, toolId: created.id };
    }

    if (payload.kind === 'TOOLHUB_PACK' && payload.category) {
      const importCategoryNode = async (catData: any, parentId: number | null) => {
        const slug = slugify(catData.slug || catData.name, 'cat');
        let fullPath = `/${slug}`;

        if (parentId) {
          const parent = await prisma.category.findUnique({ where: { id: parentId } });
          if (parent) fullPath = `${parent.fullPath}/${slug}`.replace(/\/+/g, '/');
        }

        const createdCat = await prisma.category.create({
          data: {
            name: catData.name,
            slug,
            fullPath,
            parentId,
            appendPrompt: catData.appendPrompt,
            type: catData.type || 'LOCAL',
            remoteUrl: catData.remoteUrl,
            remoteToken: catData.remoteToken,
            mcpCommand: catData.mcpCommand,
            mcpArgs: catData.mcpArgs,
            mcpEnv: safeStringifyJson(catData.mcpEnv, '{}'),
            mcpIsStateful: !!catData.mcpIsStateful
          }
        });

        if (catData.tools && Array.isArray(catData.tools)) {
          for (const t of catData.tools) {
            const runner = await resolveRunner(t);
            const created = await prisma.tool.create({
              data: {
                name: t.name,
                slug: slugify(t.slug || t.name, 'tool'),
                agentDescription: t.agentDescription || '',
                code: t.code || '',
                packageJson: t.packageJson || '',
                inputSchema: safeStringifyJson(t.inputSchema, '{}'),
                outputSchema: safeStringifyJson(t.outputSchema, '{}'),
                examples: safeStringifyJson(t.examples, '[]'),
                timeoutMs: t.timeoutMs || 30000,
                isMcpProxy: !!t.isMcpProxy,
                mcpMethodName: t.mcpMethodName,
                runnerId: runner.id,
                categories: { create: { categoryId: createdCat.id } }
              }
            });

            await prisma.toolVersion.create({
              data: {
                toolId: created.id,
                code: created.code,
                inputSchema: created.inputSchema,
                agentDescription: created.agentDescription
              }
            });
          }
        }

        if (catData.children && Array.isArray(catData.children)) {
          for (const child of catData.children) {
            await importCategoryNode(child, createdCat.id);
          }
        }
      };

      await importCategoryNode(payload.category, targetCategoryId ? Number(targetCategoryId) : null);
      return { success: true, importedType: 'TOOLPACK' };
    }

    return reply.status(400).send({ error: 'Unsupported import payload' });
  });

}, { prefix: '/admin/api' });

// ==========================================
// --- 3. СТАТИКА АДМИНКИ И АГЕНТСКИЕ РОУТЫ ---
// ==========================================

let adminDistPath = path.join(process.cwd(), 'apps', 'admin', 'dist');
if (!fsSync.existsSync(adminDistPath)) {
  adminDistPath = path.resolve(import.meta.dir, '../../admin/dist');
}

if (fsSync.existsSync(adminDistPath)) {
  await fastify.register(fastifyStatic, {
    root: adminDistPath,
    prefix: '/admin/',
    wildcard: false
  });

  fastify.get('/admin/*', async (req, reply) => {
    if (req.url.startsWith('/admin/api')) {
      return reply.callNotFound();
    }
    return reply.sendFile('index.html');
  });
}

// GET: Выделенный эндпоинт для сборки системного промпта
fastify.get('/prompt', {
  schema: {
    tags: ['Agent API'],
    summary: 'Получение полного скомпилированного системного промпта ToolHub',
    security: [{ agentAuth: [] }]
  }
}, async (req, reply) => {
  if (await checkAgentAuth(req, reply)) return reply;
  const settings = await prisma.systemSetting.findFirst();

  const rootCats = await prisma.category.findMany({
    where: { parentId: null, isActive: true }
  });

  const folderLines = rootCats.map(c => `[Folder] ${c.fullPath} - ${c.name}${c.appendPrompt ? ` | Description: ${c.appendPrompt}` : ''}`);
  const resourcesList = folderLines.join('\n') || '(No root folders)';

  const rawPrompt = settings?.rootPrompt || '';
  const formattedPrompt = rawPrompt.replace('{{AvailableResources}}', resourcesList);

  return {
    prompt: formattedPrompt
  };
});

// GET: Навигация Агента
fastify.get<{ Params: { '*': string } }>('/*', {
  schema: {
    tags: ['Agent API'],
    summary: 'Навигация по категориям и получение схем инструментов агентом',
    security: [{ agentAuth: [] }]
  }
}, async (req, reply) => {
  const pathStr = normalizePath(req.params['*'] || '');

  if (pathStr.startsWith('/admin') || pathStr.startsWith('/docs') || pathStr.startsWith('/documentation')) {
    return reply.callNotFound();
  }

  if (await checkAgentAuth(req, reply)) return reply;
  const settings = await prisma.systemSetting.findFirst();

  // Корень Хаба
  if (pathStr === '/') {
    const rootCats = await prisma.category.findMany({
      where: { parentId: null, isActive: true }
    });

    return {
      path: '/',
      appendPrompt: settings?.rootAppendPrompt || 'Корневой каталог навыков ToolHub. Используй listTools("/folder") для перехода в нужный раздел.',
      categories: rootCats.map(c => ({ 
        name: c.name, 
        path: c.fullPath,
        appendPrompt: c.appendPrompt || undefined
      }))
    };
  }

  // Локальная категория
  const localCat = await prisma.category.findFirst({
    where: { fullPath: pathStr, isActive: true },
    include: {
      children: { where: { isActive: true } },
      tools: {
        where: { tool: { isActive: true } },
        include: { tool: true }
      }
    }
  });

  if (localCat && localCat.type === 'LOCAL') {
    if (localCat.children.length > 0) {
      return {
        path: localCat.fullPath,
        appendPrompt: localCat.appendPrompt,
        categories: localCat.children.map(c => ({ 
          name: c.name, 
          path: c.fullPath,
          appendPrompt: c.appendPrompt || undefined
        })),
        tools: []
      };
    }

    return {
      path: localCat.fullPath,
      appendPrompt: localCat.appendPrompt,
      tools: localCat.tools.map(t => {
        const parsedExamples = safeParseJson(t.tool.examples, []);
        const firstExample = parsedExamples[0]?.input || {};
        return {
          name: t.tool.name,
          path: normalizePath(`${localCat.fullPath}/${t.tool.slug}`),
          description: t.tool.agentDescription,
          inputSchema: safeParseJson(t.tool.inputSchema, {}),
          outputSchema: safeParseJson(t.tool.outputSchema, {}),
          callExample: `<hub>callTool("${normalizePath(localCat.fullPath + '/' + t.tool.slug)}", ${JSON.stringify(firstExample)})</hub>`
        };
      })
    };
  }

  // Шлюзы (REMOTE / MCP)
  const allGateways = await prisma.category.findMany({
    where: { isActive: true, OR: [{ type: 'REMOTE' }, { type: 'MCP' }] }
  });

  const gatewayParent = allGateways
    .filter(c => pathStr.startsWith(c.fullPath))
    .sort((a, b) => b.fullPath.length - a.fullPath.length)[0];

  if (gatewayParent) {
    const subPath = normalizePath(pathStr.replace(gatewayParent.fullPath, '')) || '/';

    if (gatewayParent.type === 'REMOTE') {
      const incomingNodes = ((req.headers['x-hub-nodes'] as string) || '').split(',').filter(Boolean);

      // Если наш ID уже есть в цепочке — режем петлю
      if (incomingNodes.includes(SERVER_NODE_ID) || incomingNodes.length > 10) {
        return {
          path: pathStr,
          appendPrompt: `⚠️ [Cycle Protection] Loop detected for ${gatewayParent.remoteUrl}. Navigation halted.`,
          categories: [],
          tools: [],
          isRemote: true,
          isCycle: true
        };
      }

      const nextNodes = [...incomingNodes, SERVER_NODE_ID].join(',');
      const remoteHub = new HubSDK(gatewayParent.remoteUrl!, gatewayParent.remoteToken!, {
        'x-hub-nodes': nextNodes
      });

      const remoteData = await remoteHub.listTools(subPath);
      return {
        ...remoteData,
        categories: remoteData.categories?.map((c: any) => ({
          ...c,
          path: normalizePath(`${gatewayParent.fullPath}/${c.path.replace(/^\//, '')}`)
        })),
        tools: remoteData.tools?.map((t: any) => ({
          ...t,
          path: normalizePath(`${gatewayParent.fullPath}/${t.path.replace(/^\//, '')}`)
        })),
        isRemote: true
      };
    }

    if (gatewayParent.type === 'MCP') {
      const cache: any = safeParseJson(gatewayParent.mcpToolsCache, {});
      return {
        path: gatewayParent.fullPath,
        appendPrompt: gatewayParent.appendPrompt,
        isRemote: true,
        isMCP: true,
        tools: (cache?.tools || []).map((t: any) => ({
          name: t.name,
          path: normalizePath(`${gatewayParent.fullPath}/${t.name}`),
          description: t.description,
          inputSchema: t.inputSchema,
          outputSchema: t.outputSchema,
          callExample: `<hub>callTool("${normalizePath(gatewayParent.fullPath + '/' + t.name)}", {})</hub>`
        }))
      };
    }
  }

  return reply.status(404).send({ error: `Path not found or inactive: ${pathStr}` });
});

// POST: Выполнение инструмента Агентом
fastify.post<{ Params: { '*': string } }>('/*', {
  schema: {
    tags: ['Agent API'],
    summary: 'Вызов и выполнение инструмента агентом',
    security: [{ agentAuth: [] }]
  }
}, async (req, reply) => {
  const pathStr = normalizePath(req.params['*'] || '');
  console.log(`[POST Agent] ${pathStr}`, req.body);
  if (await checkAgentAuth(req, reply)) return reply;

  const startTime = Date.now();
  const lastSlash = pathStr.lastIndexOf('/');
  const dirPath = lastSlash === 0 ? '/' : pathStr.slice(0, lastSlash);
  const toolSlug = pathStr.slice(lastSlash + 1);

  const dbTool = await prisma.tool.findFirst({
    where: {
      slug: toolSlug,
      isActive: true,
      categories: {
        some: {
          category: { fullPath: dirPath }
        }
      }
    },
    include: { runner: true }
  });

  if (dbTool) {
    let res: any;
    if (dbTool.isMcpProxy && dbTool.mcpSourceId) {
      const mcpSource = await prisma.category.findUnique({ where: { id: dbTool.mcpSourceId } });
      if (!mcpSource) return reply.status(500).send({ error: 'MCP Source category missing' });

      const response = await callMcp(mcpSource, {
        method: 'tools/call',
        params: { name: dbTool.mcpMethodName!, arguments: req.body }
      });

      const parsedData = extractMcpResponse(response);
      res = { success: true, data: parsedData, durationMs: Date.now() - startTime };
    } else {
      res = await executeTool(dbTool, req.body);
    }

    await logExecution({
      toolId: dbTool.id,
      path: pathStr,
      durationMs: res.durationMs || (Date.now() - startTime),
      success: res.success !== false,
      payload: req.body,
      result: res.data || res,
      error: res.error ? (res.details || res.error) : null,
      callerIp: req.ip
    });

    return res;
  }

  const allGateways = await prisma.category.findMany({
    where: { isActive: true, OR: [{ type: 'REMOTE' }, { type: 'MCP' }] }
  });
  const gatewayParent = allGateways
    .filter(c => pathStr.startsWith(c.fullPath))
    .sort((a, b) => b.fullPath.length - a.fullPath.length)[0];

  if (gatewayParent) {
    const subPath = normalizePath(pathStr.replace(gatewayParent.fullPath, '')) || '/';
    let gatewayRes: any;

    if (gatewayParent.type === 'REMOTE') {
      const incomingNodes = ((req.headers['x-hub-nodes'] as string) || '').split(',').filter(Boolean);

      if (incomingNodes.includes(SERVER_NODE_ID) || incomingNodes.length > 10) {
        return reply.status(400).send({
          error: `[Cycle Protection] Execution aborted. Loop detected for target: ${gatewayParent.remoteUrl}`
        });
      }

      const nextNodes = [...incomingNodes, SERVER_NODE_ID].join(',');
      gatewayRes = await new HubSDK(gatewayParent.remoteUrl!, gatewayParent.remoteToken!, {
        'x-hub-nodes': nextNodes
      }).callTool(subPath, req.body);
    } else if (gatewayParent.type === 'MCP') {
      const response = await callMcp(gatewayParent, {
        method: 'tools/call',
        params: { name: subPath.replace(/^\//, ''), arguments: req.body }
      });

      const parsedData = extractMcpResponse(response);
      gatewayRes = { success: true, data: parsedData, durationMs: Date.now() - startTime };
    }

    await logExecution({
      path: pathStr,
      durationMs: Date.now() - startTime,
      success: gatewayRes?.success !== false,
      payload: req.body,
      result: gatewayRes?.data || gatewayRes,
      error: gatewayRes?.error || null,
      callerIp: req.ip
    });

    return gatewayRes;
  }

  return reply.status(404).send({ error: 'Tool not found or inactive' });
});

// ==========================================
// --- 4. SHUTDOWN HOOKS & START ---
// ==========================================

const gracefulShutdown = async () => {
  console.log('\n🛑 Shutting down Tool Hub gracefully...');
  cleanupAllPoolProcesses();
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Tool Hub API is running on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();