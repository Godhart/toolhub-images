-- Generated test fixture from ToolHub 61c19ca0, Prisma 5.22; see THIRD_PARTY.md.
-- CreateTable
CREATE TABLE "Category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fullPath" TEXT NOT NULL,
    "parentId" INTEGER,
    "appendPrompt" TEXT,
    "type" TEXT NOT NULL DEFAULT 'LOCAL',
    "remoteUrl" TEXT,
    "remoteToken" TEXT,
    "mcpCommand" TEXT,
    "mcpArgs" TEXT,
    "mcpEnv" TEXT,
    "mcpToolsCache" TEXT,
    "mcpIsStateful" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tool" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "isMcpProxy" BOOLEAN NOT NULL DEFAULT false,
    "mcpMethodName" TEXT,
    "mcpSourceId" INTEGER,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "descriptionMd" TEXT,
    "agentDescription" TEXT NOT NULL,
    "code" TEXT,
    "packageJson" TEXT,
    "inputSchema" TEXT,
    "outputSchema" TEXT,
    "examples" TEXT DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "runnerId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Tool_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ToolVersion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "toolId" INTEGER NOT NULL,
    "code" TEXT,
    "inputSchema" TEXT,
    "agentDescription" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ToolVersion_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ToolCategory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "toolId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    CONSTRAINT "ToolCategory_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ToolCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Runner" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "config" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rootPrompt" TEXT NOT NULL,
    "rootAppendPrompt" TEXT DEFAULT 'Root folder of the Toolhub. Use listTools("/folder") to navigate.',
    "agentSecret" TEXT NOT NULL DEFAULT '123',
    "adminPassword" TEXT NOT NULL DEFAULT 'admin',
    "maxLogRetention" INTEGER NOT NULL DEFAULT 1000
);

-- CreateTable
CREATE TABLE "ExecutionLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "toolId" INTEGER,
    "path" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "payload" TEXT,
    "result" TEXT,
    "error" TEXT,
    "callerIp" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecutionLog_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_fullPath_key" ON "Category"("fullPath");

-- CreateIndex
CREATE UNIQUE INDEX "ToolCategory_toolId_categoryId_key" ON "ToolCategory"("toolId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Runner_name_key" ON "Runner"("name");
