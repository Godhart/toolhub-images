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
