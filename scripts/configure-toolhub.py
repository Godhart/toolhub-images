#!/usr/bin/env python3
"""Small fail-fast container adaptations; upstream source remains on GitHub."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
def replace_once(path, old, new):
    text = path.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f"Upstream layout changed: {path.name}; review container adaptation")
    path.write_text(text.replace(old, new))

replace_once(root / "prisma/schema.prisma", 'url      = "file:../hub.db"', 'url      = env("DATABASE_URL")')
seed = root / "prisma/seed.ts"
replace_once(seed, "cliArgs['lang'] || ''", "process.env.TOOLHUB_SEED_LANG || cliArgs['lang'] || ''")
replace_once(seed, "cliArgs['admin-pass'];", "process.env.TOOLHUB_ADMIN_PASSWORD || cliArgs['admin-pass'];")
replace_once(seed, "cliArgs['agent-pass'];", "process.env.TOOLHUB_AGENT_PASSWORD || cliArgs['agent-pass'];")
text = seed.read_text()
old = 'Admin: ${adminPassword}, Agent: ${agentSecret}'
if text.count(old) != 2:
    raise RuntimeError("Upstream credential logging changed; review seed adaptation")
seed.write_text(text.replace(old, 'credentials configured'))

# Separate runner cwd subtree from business workspace; mkdir remains recursive.
replace_once(root / "apps/api/src/index.ts",
    "path.join(os.tmpdir(), `hub_run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`)",
    "path.join(process.env.TOOLHUB_RUN_ROOT || os.tmpdir(), `hub_run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`)")

# Root-mounted source packs use the existing fullPath='/' tool binding.
# Expose their tools in root discovery alongside ordinary root categories.
replace_once(root / "apps/api/src/index.ts",
    "categories: rootCats.map(c => ({",
    """tools: (await prisma.toolCategory.findMany({
        where: { category: { fullPath: '/', isActive: true }, tool: { isActive: true } },
        include: { tool: true }
      })).map(({ tool }) => ({
        name: tool.name, path: normalizePath('/' + tool.slug),
        description: tool.agentDescription,
        inputSchema: safeParseJson(tool.inputSchema, {}),
        outputSchema: safeParseJson(tool.outputSchema, {}),
        callExample: `<hub>callTool("/${tool.slug}", {})</hub>`
      })),
      categories: rootCats.filter(c => c.fullPath !== '/').map(c => ({""")
