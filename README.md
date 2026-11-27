# agent-relay

Crash-proof runtime for AI agents.

AI agents run multi-step tasks that can take minutes. If a worker crashes
halfway, most systems lose the work or repeat actions (like sending an email
twice). agent-relay checkpoints every step, so another worker resumes from the
last saved step. Only the step that was in flight is repeated, and side effects
are applied once as long as tools honor the idempotency key.

## Features

- **Durable runs**: every LLM call and tool call is saved as a step in Postgres
- **Resume after crash**: a worker rebuilds the conversation from saved steps and continues
- **Idempotent tool calls**: each call has a stable key, so retries reuse stored results
- **Fenced writes**: a stale worker can't overwrite a run another worker now owns
- **Idempotent submission**: `Idempotency-Key` header on `POST /runs`
- **Limits**: per-run max steps and token budget
- **Provider-agnostic LLM layer**: a deterministic scripted client for tests, and any
  OpenAI-compatible API (Groq, Ollama, and others) for real models
- **Chaos-tested**: an automated suite kills workers at random and verifies invariants in SQL

**Results at a glance:** in a 200-run chaos test with 177 worker deaths, all 200 runs completed
with zero duplicate side effects and exact token accounting. A control run without idempotency
keys duplicated side effects in 15% of runs under the same conditions.

## Stack

NestJS · TypeScript · BullMQ (Redis) · PostgreSQL · TypeORM

## How it works

1. `POST /runs` inserts a run row in Postgres and enqueues a BullMQ job.
2. A worker takes the job and bumps the run's `attempt` counter (the fencing token).
3. The agent loop rebuilds its message history from the `steps` table, then repeats:
   ask the LLM, save the answer as a step, run any requested tools, save each result.
4. Step saves and the run's final state are conditional on the fencing token, and each step
   is saved together with its token count in one transaction. Tool-call records use
   "first stored result wins" instead.
5. If a worker dies, BullMQ detects the stalled job, another worker takes it, and the
   loop continues from the last saved step.

Redis handles delivery and scheduling. Postgres is the source of truth.

## Quickstart

Requires Node 22.22.3 or newer and Docker. (Node 22.21.1 also works, with `npm install` engine warnings.)
```bash
git clone https://github.com/MdIrfan-ul/agent-relay.git
cd agent-relay
cp .env.example .env
docker compose up -d
npm install
npm run migration:run
npm run start:dev        # API on :3000
npm run start:worker     # in a second terminal
```

Submit a run:

```bash
curl -X POST http://localhost:3000/runs \
  -H "Content-Type: application/json" -H "Idempotency-Key: demo-1" \
  -d '{"agent":"demo","input":{"task":"What is 6 times 7? Use the tools."}}'

curl http://localhost:3000/runs/<id>
```

With the default scripted LLM the task text is ignored. Set `LLM_PROVIDER=openai-compat`
(see Configuration) to use a real model.

### Run the chaos suite

Keep the API running (`npm run start:dev`), stop any other workers, then:

```bash
npm run chaos
```

Optional knobs: `CHAOS_RUNS`, `CHAOS_WORKERS`, `CHAOS_CRASH_RATE`, `CHAOS_KILL_INTERVAL_MS`,
`CHAOS_TIMEOUT_MS`, `CHAOS_FREEZE_RATE`. Put them on the command line, not in `.env`, so
a leftover setting can't silently change a run. The two control experiments are described
below.

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_HOST`, `REDIS_PORT` | Redis for BullMQ |
| `LLM_PROVIDER` | `scripted` (default, no network) or `openai-compat` |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | Used when `LLM_PROVIDER=openai-compat` |
| `SCRIPTED_LLM_DELAY_MS` | Latency of each scripted LLM call (default 500) |
| `CHAOS_KILL_AFTER_STEP` | Test hook: the worker kills itself after saving this step on its first attempt |
| `CHAOS_CRASH_RATE`, `CHAOS_MAX_CRASH_ATTEMPTS` | Random crash chance per point, and the last attempt on which crashes can occur (default 3) |
| `CHAOS_FREEZE_RATE`, `CHAOS_FREEZE_MS` | Zombie mode: chance that a first attempt freezes, and for how long (ms) |
| `CHAOS_NAIVE_EFFECTS` | Control experiment only: the tool ignores its idempotency key (command line only) |
| `CHAOS_DISABLE_FENCING` | Control experiment only: removes the ownership check (command line only) |

## Crash-recovery demo

With `CHAOS_KILL_AFTER_STEP=2` set, the worker kills itself (SIGKILL) right after
saving step 2 of its first attempt. After you restart it, BullMQ notices the
dead lock (about 10 to 15 seconds), another attempt picks up the run, and it
finishes from step 3.

Result of this test with the scripted LLM:

| Check | Result |
|---|---|
| Final status | `succeeded` on `attempt = 2` |
| Steps saved | 5 (5 distinct, no duplicates) |
| Tokens counted | 287, the same as an uninterrupted run |
| Tool executions recorded | 2 |

## Design notes

- **At-least-once delivery plus idempotency**: BullMQ may deliver a job again. Saved steps
  and stored tool results make the repeat harmless.
- **Fencing token**: `runs.attempt` is bumped at the start of each attempt. Step saves and the
  final run state check it, so a slow worker that lost its job can't write over the new owner.
- **Stable tool-call keys**: built from run id, step index, and call id, not from the
  arguments, because JSON column storage can reorder object keys.
- **First stored tool result wins**: if two attempts both execute a tool, the result stored first
  is the one every later attempt uses.
- **History-derived test LLM**: the scripted client decides from the message history,
  not from in-memory state, so it behaves the same after a resume.
- **Redis persistence**: Redis runs with AOF enabled (see `docker-compose.yml`). Without
  persistence, a Redis restart would lose queued jobs.

## Known limitations

- If a worker dies after a tool runs but before its result is saved, the tool runs again.
  Tools that touch the outside world should pass the idempotency key downstream.
- If the API crashes between the database insert and the enqueue, the run stays `queued`.
  A reconciler for this is on the roadmap.
- Tokens for an LLM call whose answer was lost in a crash are not counted, so `tokens_used`
  can undercount real spend.
- A stale worker that was taken over may still spend LLM tokens before its writes are rejected.

## Roadmap

- [x] Agent loop with a provider-agnostic LLM layer
- [x] Step checkpointing and resume after crash
- [x] Idempotent tool calls and fenced writes
- [x] Automated chaos test suite (random worker kills, verify exactly-once side effects)
- [x] Zombie-worker test (event-loop freeze past lock expiry), with a fencing-disabled control
- [ ] Retries and dead-letter handling (implemented, not yet tested)
- [ ] Cancel endpoint, reconciler, resource locks
- [ ] Observability: per-run trace, cost tracking
- [ ] Demo agent using a real model, and deployment

## Chaos test results

`npm run chaos` starts 3 worker processes under a supervisor that restarts any worker
that dies, submits runs through the real API, and kills workers while they run:

- random in-process SIGKILLs at three points: after an LLM step is saved, after a tool has
  executed but before its result is saved, and after a tool step is saved
  (8% per point, on the first three attempts of each run)
- an external SIGKILL of a random worker every 15 seconds

Every run has 7 steps and 3 tool calls, one of them a side-effecting tool. When all runs
finish, the suite checks invariants directly in Postgres. It uses the scripted LLM, so the
test is deterministic and free.

| | 200 runs | 30 runs |
|---|---|---|
| Worker deaths | 177 (15 external SIGKILLs) | 25 (3 external) |
| Runs resumed after a crash | 158 | 24 |
| Max attempts on one run | 6 | 4 |
| Runs succeeded | 200 / 200 | 30 / 30 |
| Runs with a wrong step history | 0 | 0 |
| Runs with a token-accounting mismatch | 0 | 0 |
| Runs with a wrong side-effect count | 0 | 0 |
| Tool re-executions absorbed by the idempotency key | 10 | 8 |

**What this shows:** side effects happen exactly once, while tool executions are
at-least-once. On 10 occasions a worker died after a tool ran but before its call was
marked done, so the tool ran again after the crash. The idempotency key kept each effect
from being written twice.

### Control experiment: no idempotency key

With `CHAOS_NAIVE_EFFECTS=1` the tool ignores the idempotency key, like a tool with no
downstream deduplication. Everything else is identical, and only the side-effect check fails:

| | 200 runs | 30 runs |
|---|---|---|
| Worker deaths | 160 | 24 |
| Runs with duplicate side effects | 30 (15%) | 3 (10%) |

So the suite can fail, and the idempotency key is what makes the difference.

### Zombie workers and fencing

`CHAOS_FREEZE_RATE=0.1` makes a worker block its entire event loop (`Atomics.wait`, 25 seconds by
default) at a random point on a run's first attempt. BullMQ can't renew the job lock, so the lock
expires and another worker takes the run. When the frozen worker wakes up, it still believes it
owns the run and keeps writing. A takeover can also cause a tool re-execution, which the
idempotency key absorbs the same way.

```bash
CHAOS_RUNS=20 CHAOS_FREEZE_RATE=0.1 CHAOS_CRASH_RATE=0 CHAOS_KILL_INTERVAL_MS=0 npm run chaos
```

Control: the same command with `CHAOS_DISABLE_FENCING=1` removes the ownership check.

| | Fencing on | Fencing disabled (control) |
|---|---|---|
| Runs | 20 | 20 |
| Workers frozen / resumed | 13 / 13 | 11 / 11 |
| Runs taken over by another worker (attempt > 1) | 6 | 8 |
| Stale writes rejected by the fencing check | 6 (on 6 distinct runs) | 0 |
| Runs succeeded | 20 / 20 | 20 / 20 |
| Runs with a token-accounting mismatch | 0 | 8 |
| Step history, tool calls, side effects | all correct | all correct |

**What this shows:** without fencing, a woken zombie double-counted tokens on 8 runs, the same
number as runs taken over. With fencing, its writes were rejected and accounting stayed exact.
Step history and side effects stayed correct either way, because the unique constraint on
`(run_id, step_index)` and the idempotency key protect them independently (defense in depth).

Small sample (20 runs per mode). The scripted LLM is deterministic, so a zombie's duplicate
step is identical to the real one. A zombie writing a *different* step, as a real model could,
is not tested.

### What the suite does not cover

- It uses a scripted LLM, not a real model.
- The zombie test uses 20 runs per mode and a deterministic LLM, so it can't show a stale worker
  forking a run's history with different content.
- Redis and Postgres never restart or fail over.
- In-process crashes stop after the third attempt of a run; external kills are not capped.
- It runs on one machine at a scale of hundreds of runs. It's evidence, not proof.