import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
try {
  if (!(await db.systemSetting.findFirst())) {
    if (!process.env.TOOLHUB_ADMIN_PASSWORD || !process.env.TOOLHUB_AGENT_PASSWORD)
      throw new Error('First start requires TOOLHUB_ADMIN_PASSWORD and TOOLHUB_AGENT_PASSWORD');
    const result = Bun.spawnSync(['bun', 'run', 'prisma/seed.ts'], {
      cwd: import.meta.dir,
      env: {...process.env, TOOLHUB_SEED_LANG: process.env.TOOLHUB_SEED_LANG || 'ru'},
      stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
    });
    if (result.exitCode !== 0) throw new Error('ToolHub initialization failed');
  }
  const runners = [
    {name: 'TWYLT Python (preinstalled)', type: 'twylt_python_preinstalled',
     config: {codeFileName:'tool.py', depFileName:'requirements.txt', installCmd:'', runCmd:'python tool.py < /dev/null'}},
    {name: 'TWYLT TypeScript (preinstalled)', type: 'twylt_ts_preinstalled',
     config: {codeFileName:'tool.mts', depFileName:'package.json', installCmd:'', runCmd:'tsx tool.mts < /dev/null'}},
  ];
  for (const r of runners) {
    if (!(await db.runner.findFirst({where: {type:r.type}})))
      await db.runner.create({data: {...r, config:JSON.stringify(r.config)}});
  }
} finally { await db.$disconnect(); }
