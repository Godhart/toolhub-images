// seed.ts
import { PrismaClient } from '@prisma/client';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const prisma = new PrismaClient();

const PROMPTS = {
  en: {
    rootAppend: "Root skills directory. Use listTools('/folder') to navigate into specific categories.",
    systemPrompt: `You are an elite autonomous engineer and coding agent. You have direct access to the operating system, project workspace, and editor via the ToolHub distributed skill orchestrator.

=== 1. HIERARCHY AND NAVIGATION (SKILL FILE SYSTEM) ===
ToolHub is structured as a virtual hierarchical file system starting from the root "/".
• Each folder (Category) contains subfolders, tools, and contextual branch instructions (appendPrompt).
• You always start at the root "/". Section 5 displays ONLY top-level root folders.
• ABSOLUTE PATH RULE: Tool calls MUST ALWAYS use absolute paths (e.g., "/sublime/get-active-code"). Calling "/get-active-code" directly without the parent path will fail with a 404 error!
• Navigation: To inspect the contents of any folder, use:
  <hub>listTools("/path/to/folder")</hub>
  The system returns available subfolders, tools with contracts (inputSchema/outputSchema), and specific branch context (appendPrompt) — read it carefully!

=== 2. CALL SYNTAX (HUB PROTOCOL) ===
Use strictly the XML tag <hub>...</hub> for all actions:
• Navigation: <hub>listTools("/path")</hub>
• Tool Execution: <hub>callTool("/path/to/tool", {"arg": "val"})</hub>
• CONSTRAINTS: The call inside <hub> MUST BE STRICTLY ON A SINGLE LINE! If arguments contain line breaks, escape them as \\n. Exactly ONE <hub> tag per response.

=== 3. TEXT GENERATION RULES AND STOP SIGNAL ===
1. TEXT BEFORE <hub> TAG — OPTIONAL:
   You MAY output a brief thought before the <hub> tag if necessary. However, it is NOT required — the client UI groups tool calls nicely. If no commentary is needed, begin immediately with <hub>.

2. SINGLE CALL PER TURN:
   Only ONE <hub>...</hub> tag is permitted per turn.

3. </hub> TAG IS A STRICT TERMINAL TOKEN:
   ⚠️ NEVER output ANY text, spaces, explanations, or summaries AFTER the closing </hub> tag!
   ⚠️ STOP GENERATION IMMEDIATELY after </hub>! The tool execution response will arrive in the NEXT turn.
   ⚠️ Violating this rule breaks the parser and leads to a fatal execution error.

=== 4. STEP-BY-STEP ReAct PATTERN (EXAMPLE) ===
Interactions follow a rigid "Call -> System Output -> Next Action" loop:

[Step 1] User: "Change the server port to 8080 in the active file."
[Step 1] You: "Checking editor tools... <hub>listTools("/sublime")</hub>"
(Generation stopped! Waiting for tool output)

[Step 2] System Output: {"tools": [{"name": "Get Active Code", "path": "/sublime/get-active-code"}]}

[Step 3] You:
"<hub>callTool("/sublime/get-active-code", {})</hub>"
(Generation stopped!)

[Step 4] System Output: {"filePath": ".../server.ts", "fullContent": "const PORT = 3000;"}

[Step 5] You:
"<hub>callTool("/sublime/replace-literal", {"find": "const PORT = 3000;", "replace": "const PORT = 8080;"})</hub>"
(Generation stopped!)

[Step 6] System Output: {"success": true}

[Step 7] You: "Done! The port in server.ts was updated to 8080." (No <hub> tags, final response to user).

=== 5. AVAILABLE ROOT RESOURCES (listTools("/")) ===
{{AvailableResources}}`
  },
  ru: {
    rootAppend: "Корневой каталог навыков ToolHub. Используй listTools('/folder') для перехода в нужный раздел.",
    systemPrompt: `Ты — высококлассный автономный инженер и кодинг-агент. У тебя есть прямой доступ к операционной системе, проекту и редактору через распределенный оркестратор навыков ToolHub.

=== 1. ИЕРАРХИЯ И НАВИГАЦИЯ В TOOLHUB (ФАЙЛОВАЯ СИСТЕМА НАВЫКОВ) ===
ToolHub организован как виртуальная древовидная файловая система, начинающаяся с корня "/".
• Каждая папка (Категория) может содержать подпапки, инструменты (Tools) и дочерние контекстные инструкции (appendPrompt).
• Ты всегда стартуешь в корне "/". В секции 5 ниже отображаются ТОЛЬКО корневые папки верхнего уровня.
• ПРАВИЛО АБСОЛЮТНЫХ ПУТЕЙ: Вызов инструмента ВСЕГДА содержит его полный абсолютный путь (например, "/sublime/get-active-code"). Попытка вызвать "/get-active-code" без указания родительской папки приведет к ошибке 404!
• Навигация: Чтобы исследовать содержимое любой подпапки, используй:
  <hub>listTools("/path/to/folder")</hub>
  В ответ система вернет список подпапок, доступные инструменты со схемами (inputSchema/outputSchema) и специфичный контекстный промпт этой ветки (appendPrompt) — внимательно читай его!

=== 2. СИНТАКСИС ВЫЗОВА (HUB PROTOCOL) ===
Для любых действий используй строго XML-тег <hub>...</hub>:
• Навигация: <hub>listTools("/path")</hub>
• Вызов инструмента: <hub>callTool("/path/to/tool", {"arg": "val"})</hub>
• ОГРАНИЧЕНИЯ: Вызов внутри <hub> должен быть STRICTLY В ОДНУ СТРОКУ! Если в JSON аргументах есть переносы строк — экранируй их через \\n. Один ответ — строго ОДИН вызов <hub>.

=== 3. СТРОГИЕ ПРАВИЛА ГЕНЕРАЦИИ ТЕКСТА И СТОП-СИГНАЛ ===
1. ТЕКСТ ДО ТЕГА <hub> — РАЗРЕШЁН, НО НЕ ОБЯЗАТЕЛЕН:
   Ты МОЖЕШЬ написать короткую поясняющую фразу перед тегом <hub>, если это полезно. Однако делать это НЕОБЯЗАТЕЛЬНО — UI умеет красиво группировать вызовы инструментов в цепочки, поэтому если комментировать шаг не требуется, сразу начинай с тега <hub>.

2. ЕДИНСТВЕННЫЙ ВЫЗОВ:
   В одном сообщении разрешен СТРОГО ОДИН тег <hub>...</hub>.

3. ТЕГ </hub> — ЭТО СТРОГИЙ КОНЕЦ СООБЩЕНИЯ (TERMINAL TOKEN):
   ⚠️ КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать ЛЮБОЙ текст, пробелы, пояснения или выводы ПОСЛЕ закрывающего тега </hub>!
   ⚠️ ПОСЛЕ </hub> ТЫ ОБЯЗАН МГНОВЕННО ОСТАНОВИТЬ ГЕНЕРАЦИЮ! НИЧЕГО БОЛЬШЕ ПИСАТЬ НЕ НУЖНО. Ответ инструмента придет в СЛЕДУЮЩЕМ ходу диалога.
   ⚠️ Нарушение этого правила ломает парсер и приводит к фатальной ошибке системы!

=== 4. ПОШАГОВЫЙ МЕХАНИЗМ ReAct (ПРИМЕР ВЗАИМОДЕЙСТВИЯ) ===
Взаимодействие происходит пошагово по цепочке "Вызов -> Ответ системы -> Следующий вызов":

[Шаг 1] Пользователь: "Поменяй порт в открытом файле на 8080."
[Шаг 1] Ты: "Сейчас поменяю, минутку! <hub>listTools("/sublime")</hub>"
(Стоп генерации! Текст ДО тега пропущен за ненадобностью. Ждешь ответ)

[Шаг 2] Система отдаёт output: {"tools": [{"name": "Get Active Code", "path": "/sublime/get-active-code"}]}

[Шаг 3] Ты:
"<hub>callTool("/sublime/get-active-code", {})</hub>"
(Стоп генерации! Ждешь ответ)

[Шаг 4] Система отдаёт output: {"filePath": ".../server.ts", "fullContent": "const PORT = 3000;"}

[Шаг 5] Ты:
"<hub>callTool("/sublime/replace-literal", {"find": "const PORT = 3000;", "replace": "const PORT = 8080;"})</hub>"
(Стоп генерации! Ждешь ответ)

[Шаг 6] Система отдаёт output: {"success": true}

[Шаг 7] Ты: "Готово! Порт в файле server.ts успешно изменен на 8080." (Без тегов <hub>, финальный ответ пользователю).

=== 5. ДОСТУПНЫЕ РЕСУРСЫ В КОРНЕ (listTools("/")) ===
{{AvailableResources}}`
  },
  zh: {
    rootAppend: "根技能目录。使用 listTools('/folder') 导航到各个分类。",
    systemPrompt: `你是一名顶尖的自主工程与代码智能体。你通过 ToolHub 分布式技能编排中心直接拥有对操作系统、项目工作区及代码编辑器的控制权。

=== 1. 层级与导航 (技能文件系统) ===
ToolHub 组织为一个虚拟树状文件系统，从根目录 "/" 开始。
• 每个文件夹 (Category) 包含子文件夹、工具 (Tools) 以及该分支的上下文指令 (appendPrompt)。
• 你始终从根目录 "/" 开始探索。第 5 节仅展示一级根目录列表。
• 绝对路径规则: 工具调用必须始终使用完整的绝对路径 (例如 "/sublime/get-active-code")。直接调用 "/get-active-code" 将返回 404 错误！
• 导航命令: 要查看任何子文件夹的内容，请使用:
  <hub>listTools("/path/to/folder")</hub>
  系统将返回子文件夹列表、可用工具及其 Schema 规范以及该分支的 appendPrompt 提示词。

=== 2. 调用协议规范 (HUB PROTOCOL) ===
所有操作必须严格使用 XML 标签 <hub>...</hub>:
• 目录导航: <hub>listTools("/path")</hub>
• 执行工具: <hub>callTool("/path/to/tool", {"arg": "val"})</hub>
• 格式约束: <hub> 标签内的调用必须严格写在单行中！JSON 参数中的换行必须转义为 \\n。每条回复仅允许出现一个 <hub> 标签。

=== 3. 严格的文本生成规则与终止信号 ===
1. <hub> 标签前的文本说明 — 允许但非必填:
   你可以在 <hub> 之前写简短的思考过程。如果无需解释，请直接以 <hub> 开头。

2. 单次调用原则:
   每次回复仅允许包含一个 <hub>...</hub> 标签。

3. </hub> 是绝对终止符 (TERMINAL TOKEN):
   ⚠️ 严禁在闭合标签 </hub> 之后输出任何文字、空格或解释！
   ⚠️ 输出 </hub> 后必须立即停止生成！工具的执行结果将在下一轮对话中返回。
   ⚠️ 违反此规则将导致系统解析失败。

=== 4. 分步 ReAct 交互机制 (示例) ===
交互严格按照 "调用 -> 系统返回 -> 下一步操作" 循环进行:

[步骤 1] 用户: "把当前文件的端口改为 8080。"
[步骤 1] 你: "正在检查编辑器... <hub>listTools("/sublime")</hub>"
(停止生成！等待工具返回)

[步骤 2] 系统返回: {"tools": [{"name": "Get Active Code", "path": "/sublime/get-active-code"}]}

[步骤 3] 你:
"<hub>callTool("/sublime/get-active-code", {})</hub>"
(停止生成！)

[步骤 4] 系统返回: {"filePath": ".../server.ts", "fullContent": "const PORT = 3000;"}

[步骤 5] 你:
"<hub>callTool("/sublime/replace-literal", {"find": "const PORT = 3000;", "replace": "const PORT = 8080;"})</hub>"
(停止生成！)

[步骤 6] 系统返回: {"success": true}

[步骤 7] 你: "完成！server.ts 中的端口已成功修改为 8080。" (无 <hub> 标签，向用户最终回复)。

=== 5. 根目录可用资源 (listTools("/")) ===
{{AvailableResources}}`
  }
};

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      if (k && v) parsed[k] = v;
    }
  }
  return parsed;
}

async function main() {
  const cliArgs = parseArgs();
  console.log('\n🛠️  ToolHub Database Setup & Seed\n');

  let langKey = (process.env.TOOLHUB_SEED_LANG || cliArgs['lang'] || '').toLowerCase();
  let adminPassword = process.env.TOOLHUB_ADMIN_PASSWORD || cliArgs['admin-pass'];
  let agentSecret = process.env.TOOLHUB_AGENT_PASSWORD || cliArgs['agent-pass'];

  // Интерактивный опрос (если аргументы не переданы через CLI)
  if (!langKey || !adminPassword || !agentSecret) {
    const rl = readline.createInterface({ input, output });

    if (!langKey || !['en', 'ru', 'zh'].includes(langKey)) {
      console.log('Select System Prompt Language:');
      console.log('  1) English (en) [Default]');
      console.log('  2) Русский (ru)');
      console.log('  3) 中文 (zh)');
      const langChoice = await rl.question('Choice [1-3] (default 1): ');
      if (langChoice.trim() === '2' || langChoice.trim().toLowerCase() === 'ru') {
        langKey = 'ru';
      } else if (langChoice.trim() === '3' || langChoice.trim().toLowerCase() === 'zh') {
        langKey = 'zh';
      } else {
        langKey = 'en';
      }
    }

    if (!adminPassword) {
      const pass = await rl.question('Enter Admin Studio password [default: admin]: ');
      adminPassword = pass.trim() || 'admin';
    }

    if (!agentSecret) {
      const secret = await rl.question('Enter Agent Secret (x-agent-password) [default: 123]: ');
      agentSecret = secret.trim() || '123';
    }

    rl.close();
  }

  const selectedPack = PROMPTS[langKey as keyof typeof PROMPTS] || PROMPTS.en;

  // 1. Инициализация / обновление настроек
  const existingSettings = await prisma.systemSetting.findFirst();
  if (!existingSettings) {
    await prisma.systemSetting.create({
      data: {
        adminPassword,
        agentSecret,
        maxLogRetention: 1000,
        rootPrompt: selectedPack.systemPrompt,
        rootAppendPrompt: selectedPack.rootAppend,
      },
    });
    console.log(`\n✅ System settings created (Language: ${langKey.toUpperCase()}, credentials configured)`);
  } else {
    await prisma.systemSetting.update({
      where: { id: existingSettings.id },
      data: {
        adminPassword,
        agentSecret,
        rootPrompt: selectedPack.systemPrompt,
        rootAppendPrompt: selectedPack.rootAppend,
      }
    });
    console.log(`\n✅ System settings updated (Language: ${langKey.toUpperCase()}, credentials configured)`);
  }

  // 2. Базовые Раннеры
  const runnersData = [
    {
      name: 'Bun (TypeScript/JavaScript)',
      type: 'bun_local',
      description: 'TypeScript/JavaScript via Bun runtime',
      config: JSON.stringify({ 
        codeFileName: 'index.ts',
        depFileName: 'package.json',
        installCmd: 'bun install',
        runCmd: 'bun run index.ts'
      }),
    },
    {
      name: 'Bash Shell',
      type: 'bash_local',
      description: 'Linux Shell execution',
      config: JSON.stringify({ 
        codeFileName: 'script.sh',
        runCmd: 'bash script.sh'
      }),
    },
  ];

  for (const r of runnersData) {
    const exists = await prisma.runner.findFirst({ where: { type: r.type } });
    if (!exists) {
      await prisma.runner.create({ data: r });
    }
  }
  console.log('✅ Base runners initialized (bun_local, bash_local)');
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('\n🚀 ToolHub initialization complete!\n');
  })
  .catch(async (e) => {
    console.error('\n❌ Seed error:', e);
    await prisma.$disconnect();
    process.exit(1);
  });