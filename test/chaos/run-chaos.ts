import 'dotenv/config';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { Client } from 'pg';

const API = process.env.CHAOS_API_URL ?? 'http://localhost:3000';
const RUNS = Number(process.env.CHAOS_RUNS ?? 30);
const WORKERS = Number(process.env.CHAOS_WORKERS ?? 3);
const CRASH_RATE = process.env.CHAOS_CRASH_RATE ?? '0.08';
const KILL_INTERVAL_MS = Number(process.env.CHAOS_KILL_INTERVAL_MS ?? 15_000);
const TIMEOUT_MS = Number(process.env.CHAOS_TIMEOUT_MS ?? 10 * 60_000);
const EXPECTED_STEPS = 7; // llm, tool, llm, tool, llm, tool, llm
const EXPECTED_TOOL_CALLS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const WORKER_ENTRY = ['dist/worker.js', 'dist/src/worker.js'].find((p) => existsSync(p));

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function main() {
  if (!WORKER_ENTRY) throw new Error('worker build not found; run `npm run build` first');

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const one = async (sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows[0] as Record<string, number>;

  // ---- worker supervisor: restarts workers that die, like an orchestrator would ----
  let stopping = false;
  let workerDeaths = 0;
  let externalKills = 0;
  const children = new Set<ChildProcess>();

  const workerEnv = {
    ...process.env,
    LLM_PROVIDER: 'scripted',
    SCRIPTED_LLM_DELAY_MS: process.env.CHAOS_LLM_DELAY_MS ?? '300',
    CHAOS_CRASH_RATE: CRASH_RATE,
    CHAOS_KILL_AFTER_STEP: '',
  };

  const startWorker = () => {
    const child = spawn(process.execPath, [WORKER_ENTRY], { env: workerEnv, stdio: 'ignore' });
    children.add(child);
    child.on('exit', () => {
      children.delete(child);
      if (stopping) return;
      workerDeaths++;
      setTimeout(startWorker, 1000);
    });
  };
  for (let i = 0; i < WORKERS; i++) startWorker();

  // ---- external chaos: SIGKILL a random worker every so often ----
  const killer = setInterval(() => {
    const alive = [...children];
    if (alive.length === 0) return;
    alive[Math.floor(Math.random() * alive.length)].kill('SIGKILL');
    externalKills++;
  }, KILL_INTERVAL_MS);

  // ---- submit runs through the real API ----
  const batch = Date.now();
  const ids: string[] = [];
  try {
    for (let i = 0; i < RUNS; i++) {
      const res = await fetch(`${API}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `chaos-${batch}-${i}` },
        body: JSON.stringify({ agent: 'chaos', input: { task: `chaos [effect] ${i}` } }),
      });
      if (!res.ok) throw new Error(`POST /runs failed: ${res.status} ${await res.text()}`);
      ids.push(((await res.json()) as { id: string }).id);
    }
  } catch (e) {
    stopping = true;
    clearInterval(killer);
    children.forEach((c) => c.kill('SIGKILL'));
    await db.end();
    throw new Error(`could not submit runs (is the API running on ${API}?): ${String(e)}`);
  }
  console.log(`submitted ${ids.length} runs; ${WORKERS} workers; crash rate ${CRASH_RATE} per point`);

  // ---- wait for every run to reach a final state ----
  const deadline = Date.now() + TIMEOUT_MS;
  let counts: Record<string, number> = {};
  while (Date.now() < deadline) {
    const { rows } = await db.query(
      `SELECT status, count(*)::int AS n FROM runs WHERE id = ANY($1::uuid[]) GROUP BY status`,
      [ids],
    );
    counts = Object.fromEntries(rows.map((r) => [r.status as string, r.n as number]));
    const finished = (counts.succeeded ?? 0) + (counts.failed ?? 0) + (counts.dead ?? 0) + (counts.cancelled ?? 0);
    console.log(`  ${JSON.stringify(counts)}  worker deaths so far: ${workerDeaths}`);
    if (finished >= ids.length) break;
    await sleep(3000);
  }

  stopping = true;
  clearInterval(killer);
  children.forEach((c) => c.kill('SIGKILL'));

  // ---- verify invariants straight from the database ----
  const checks: Check[] = [];
  const succeeded = counts.succeeded ?? 0;
  checks.push({
    name: 'all runs succeeded',
    ok: succeeded === ids.length,
    detail: `${succeeded}/${ids.length} succeeded`,
  });

  const badSteps = await one(
    `SELECT count(*)::int AS bad FROM runs r
     WHERE r.id = ANY($1::uuid[]) AND r.status = 'succeeded'
       AND ((SELECT count(*) FROM steps s WHERE s.run_id = r.id) <> $2::int
         OR (SELECT coalesce(max(step_index), -1) FROM steps s WHERE s.run_id = r.id) <> $2::int - 1)`,
    [ids, EXPECTED_STEPS],
  );
  checks.push({
    name: `step history complete and gap-free (${EXPECTED_STEPS} steps per run)`,
    ok: badSteps.bad === 0,
    detail: `${badSteps.bad} runs with a wrong step history`,
  });

  const badTokens = await one(
    `SELECT count(*)::int AS bad FROM runs r
     WHERE r.id = ANY($1::uuid[])
       AND r.tokens_used <> coalesce((SELECT sum(coalesce(tokens_in, 0) + coalesce(tokens_out, 0))
                                      FROM steps s WHERE s.run_id = r.id), 0)`,
    [ids],
  );
  checks.push({
    name: 'token accounting exact (tokens_used equals the sum over steps)',
    ok: badTokens.bad === 0,
    detail: `${badTokens.bad} runs with a mismatch`,
  });

  const badTools = await one(
    `SELECT count(*)::int AS bad FROM runs r
     WHERE r.id = ANY($1::uuid[]) AND r.status = 'succeeded'
       AND (SELECT count(*) FROM tool_calls t WHERE t.run_id = r.id AND t.status = 'done') <> $2::int`,
    [ids, EXPECTED_TOOL_CALLS],
  );
  checks.push({
    name: `tool_calls complete (${EXPECTED_TOOL_CALLS} per run)`,
    ok: badTools.bad === 0,
    detail: `${badTools.bad} runs with a wrong count`,
  });

  const badEffects = await one(
    `SELECT count(*)::int AS bad FROM runs r
     WHERE r.id = ANY($1::uuid[]) AND r.status = 'succeeded'
       AND (SELECT count(*) FROM effects e WHERE e.run_id = r.id) <> 1`,
    [ids],
  );
  checks.push({
    name: 'exactly one side-effect row per run (no duplicate effects)',
    ok: badEffects.bad === 0,
    detail: `${badEffects.bad} runs with zero or several effect rows`,
  });

  const attempts = await one(
    `SELECT (count(*) FILTER (WHERE attempt > 1))::int AS resumed, coalesce(max(attempt), 0)::int AS max_attempt
     FROM runs WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  const reexec = await one(
    `SELECT coalesce(sum(executions - 1), 0)::int AS n FROM effects WHERE run_id = ANY($1::uuid[])`,
    [ids],
  );

  console.log('\n=== CHAOS TEST RESULT ===');
  console.log(`runs: ${ids.length}   worker deaths: ${workerDeaths} (external SIGKILLs: ${externalKills}, rest in-process crashes)`);
  console.log(`runs resumed after a crash (attempt > 1): ${attempts.resumed}   max attempts on one run: ${attempts.max_attempt}`);
  console.log(`tool re-executions after a crash, absorbed by the idempotency key: ${reexec.n}`);
  console.log('');
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  [${c.detail}]`);

  await db.end();
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});