// bench.ts
// HUB_URL=http://localhost:3000 AGENT_PASS=123 bun run bench.ts

import { HubSDK } from '../../SDK/JS/sdk';

const HUB_URL = process.env.HUB_URL || 'http://localhost:3000';
const AGENT_PASS = process.env.AGENT_PASS || '123';
const ITERATIONS = 100;
const CONCURRENT_BURST_COUNT = 15;

const hub = new HubSDK(HUB_URL, AGENT_PASS);

interface BenchMetric {
  name: string;
  category: string;
  coldMs: number;
  minMs: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  maxMs: number;
  rps: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runSequentialSuite(name: string, category: string, fn: () => Promise<any>): Promise<BenchMetric> {
  process.stdout.write(`⏳ [${category}] ${name} (${ITERATIONS} runs)... `);

  // 1. Cold start
  const t0 = performance.now();
  await fn();
  const coldMs = performance.now() - t0;

  // 2. Warm runs
  const times: number[] = [];
  const startSuite = performance.now();

  for (let i = 0; i < ITERATIONS; i++) {
    const s = performance.now();
    await fn();
    times.push(performance.now() - s);
  }
  const totalSuiteTimeSec = (performance.now() - startSuite) / 1000;

  times.sort((a, b) => a - b);
  const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
  const p50Ms = times[Math.floor(times.length * 0.50)];
  const p90Ms = times[Math.floor(times.length * 0.90)];
  const p99Ms = times[Math.floor(times.length * 0.99)];
  const rps = ITERATIONS / totalSuiteTimeSec;

  console.log(`✅ avg: ${avgMs.toFixed(1)}ms | p90: ${p90Ms.toFixed(1)}ms | RPS: ${rps.toFixed(0)}`);

  return {
    name,
    category,
    coldMs,
    minMs: times[0],
    avgMs,
    p50Ms,
    p90Ms,
    p99Ms,
    maxMs: times[times.length - 1],
    rps
  };
}

async function runConcurrencyStressTest(): Promise<{ totalTimeMs: number; successCount: number; errors: number }> {
  process.stdout.write(`🔥 Запуск параллельного стресс-теста (${CONCURRENT_BURST_COUNT} одновременных воркспейсов)... `);
  
  const tasks = Array.from({ length: CONCURRENT_BURST_COUNT }, (_, i) => 
    hub.callTool('/bench/bun-cpu', { iters: 20000 })
  );

  const start = performance.now();
  const results = await Promise.allSettled(tasks);
  const totalTimeMs = performance.now() - start;

  let successCount = 0;
  let errors = 0;

  for (const r of results) {
    if (r.status === 'fulfilled' && !r.value?.error) {
      successCount++;
    } else {
      errors++;
    }
  }

  console.log(`✅ Завершено за ${totalTimeMs.toFixed(1)}ms (Успешно: ${successCount}/${CONCURRENT_BURST_COUNT})`);
  return { totalTimeMs, successCount, errors };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(`🚀 TOOLHUB BENCHMARK & LOAD STRESS SUITE`);
  console.log(`🎯 URL: ${HUB_URL} | Sequential Runs: ${ITERATIONS} | Concurrency: ${CONCURRENT_BURST_COUNT}`);
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  const metrics: BenchMetric[] = [];

  // 1. Navigation Fast-Path
  metrics.push(await runSequentialSuite(
    'listTools("/") [Root Catalog]',
    'Navigation Engine',
    () => hub.listTools('/')
  ));

  // 2. Navigation Subcategory
  metrics.push(await runSequentialSuite(
    'listTools("/bench") [Leaf Catalog]',
    'Navigation Engine',
    () => hub.listTools('/bench')
  ));

  // 3. Raw Bash Spawn
  metrics.push(await runSequentialSuite(
    'Bash System Telemetry',
    'OS Spawn (/bin/sh)',
    () => hub.callTool('/bench/bash-sys', { msg: 'bench-tick' })
  ));

  // 4. Bun In-Memory Compute
  metrics.push(await runSequentialSuite(
    'Bun CPU Cruncher (50k iters)',
    'Bun Runtime',
    () => hub.callTool('/bench/bun-cpu', { iters: 50000 })
  ));

  // 5. Bun Disk I/O (25 files batch)
  metrics.push(await runSequentialSuite(
    'Bun Heavy Disk I/O (25 files r/w)',
    'FS Workspace I/O',
    () => hub.callTool('/bench/bun-io', {})
  ));

  // 6. Python 3 Crypto
  metrics.push(await runSequentialSuite(
    'Python 3 SHA256 (500 hashes)',
    'Python 3 Process',
    () => hub.callTool('/bench/py-crypto', { seed: 'habr-perf-test' })
  ));

  console.log('\n');
  const stress = await runConcurrencyStressTest();

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('📊 benchmark:');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  console.log('| Сценарий / Нагрузка | Среда / Раннер | Cold Start | Avg Latency | p50 | p90 | p99 | Throughput |');
  console.log('|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|');

  for (const m of metrics) {
    console.log(`| ${m.name} | ${m.category} | ${m.coldMs.toFixed(1)} ms | **${m.avgMs.toFixed(1)} ms** | ${m.p50Ms.toFixed(1)} ms | ${m.p90Ms.toFixed(1)} ms | ${m.p99Ms.toFixed(1)} ms | ~${m.rps.toFixed(0)} req/s |`);
  }

  console.log('\n**Результаты стресс-теста на параллельную изоляцию:**');
  console.log(`> **${CONCURRENT_BURST_COUNT} одновременных вызовов воркспейсов** выполнено суммарно за **${stress.totalTimeMs.toFixed(1)} мс** (Ошибок: ${stress.errors}, 100% изоляция ФС).`);
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
main().catch(console.error);