# agent-relay

Crash-proof runtime for AI agents.

AI agents run multi-step tasks that can take minutes. If a worker crashes
halfway, most systems lose the work or repeat actions (like sending an email
twice). agent-relay checkpoints every step, so another worker resumes from the
last saved step. Only the step that was in flight is repeated, and side effects
are protected by idempotency keys, so they are applied once.

## Features

- **Durable runs**: every LLM call and tool call is saved as a step in Postgres
- **Resume after crash**: a worker rebuilds the conversation from saved steps and continues
- **Idempotent tool calls**: each call has a stable key, so retries reuse stored results
- **Fenced writes**: a stale worker can't overwrite a run another worker now owns
- **Idempotent submission**: `Idempotency-Key` header on `POST /runs`
- **Limits**: per-run max steps and token budget
- **Provider-agnostic LLM layer**: a deterministic scripted client for tests, and any
  OpenAI-compatible API (Groq, Ollama, and others) for real models
- **Chaos-tested**: automated suite kills workers at random and verifies invariants in SQL.

## Stack

NestJS · TypeScript · BullMQ (Redis) · PostgreSQL · TypeORM

## How it works

1. `POST /runs` inserts a run row in Postgres and enqueues a BullMQ job.
2. A worker takes the job and bumps the run's `attempt` counter (the fencing token).
3. The agent loop rebuilds its message history from the `steps` table, then repeats:
   ask the LLM, save the answer as a step, run any requested tools, save each result.
4. Every progress write is conditional on the fencing token and runs in a transaction.
5. If a worker dies, BullMQ detects the stalled job, another worker takes it, and the
   loop continues from the last saved step.

Redis handles delivery and scheduling. Postgres is the source of truth.

## Quickstart

Requires Node 20+ and Docker.

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
### Run the chaos suite

Keep the API running (`npm run start:dev`), stop any other workers, then:

```bash
npm run chaos
```

Optional knobs: `CHAOS_RUNS`, `CHAOS_WORKERS`, `CHAOS_CRASH_RATE`, `CHAOS_KILL_INTERVAL_MS`,
`CHAOS_TIMEOUT_MS`. To run the control experiment, use
`CHAOS_NAIVE_EFFECTS=1 npm run chaos` (on the command line, not in `.env`).
## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_HOST`, `REDIS_PORT` | Redis for BullMQ |
| `LLM_PROVIDER` | `scripted` (default, no network) or `openai-compat` |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | Used when `LLM_PROVIDER=openai-compat` |
| `CHAOS_KILL_AFTER_STEP` | Test hook: the worker kills itself after saving this step |

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
- **Fencing token**: `runs.attempt` is bumped at the start of each attempt, and every write
  checks it, so a slow worker that lost its job can't corrupt state.
- **Stable tool-call keys**: built from run id, step index, and call id, not from the
  arguments, because JSON column storage can reorder object keys.
- **History-derived test LLM**: the scripted client decides from the message history,
  not from in-memory state, so it behaves the same after a resume.

## Known limitations

- If a worker dies after a tool runs but before its result is saved, the tool runs again.
  Tools that touch the outside world should pass the idempotency key downstream.
- If the API crashes between the database insert and the enqueue, the run stays `queued`.
  A reconciler for this is on the roadmap.

## Roadmap

- [x] Agent loop with a provider-agnostic LLM layer
- [x] Step checkpointing and resume after crash
- [x] Idempotent tool calls and fenced writes
- [ ] Retries and dead-letter handling (implemented, not yet tested)
- [ ] Cancel endpoint, reconciler, resource locks
- [ ] Observability: per-run trace, cost tracking
- [x] Automated chaos test suite (random worker kills, verify exactly-once)
- [ ] Demo agent with a side-effecting tool, and deployment

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

### Control experiment

With `CHAOS_NAIVE_EFFECTS=1` the tool ignores the idempotency key, like a tool with no
downstream deduplication. Everything else is identical, and only the side-effect check fails:

| | 200 runs | 30 runs |
|---|---|---|
| Worker deaths | 160 | 24 |
| Runs with duplicate side effects | 30 (15%) | 3 (10%) |

So the suite can fail, and the idempotency key is what makes the difference.

### What the suite does not cover

- It uses a scripted LLM, not a real model.
- It kills processes outright. It never pauses a worker so its lock expires and then wakes it up (a "zombie" worker), so the fencing check, which only matters when a stale worker keeps writing, is implemented but not yet tested.
- Redis and Postgres never restart or fail over.
- In-process crashes stop after the third attempt of a run; external kills are not capped.
- It runs on one machine at a scale of hundreds of runs. It's evidence, not proof.