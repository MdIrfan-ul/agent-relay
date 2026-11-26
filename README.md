# agent-relay

Crash-proof runtime for AI agents.

AI agents run multi-step tasks that can take minutes. If a worker crashes
halfway, most systems lose the work or repeat actions (like sending an email
twice). agent-relay checkpoints every step, so another worker resumes exactly
where the last one stopped, and a finished step is never paid for or executed
twice.

## Features

- **Durable runs**: every LLM call and tool call is saved as a step in Postgres
- **Resume after crash**: a worker rebuilds the conversation from saved steps and continues
- **Idempotent tool calls**: each call has a stable key, so retries reuse stored results
- **Fenced writes**: a stale worker can't overwrite a run another worker now owns
- **Idempotent submission**: `Idempotency-Key` header on `POST /runs`
- **Limits**: per-run max steps and token budget
- **Provider-agnostic LLM layer**: a deterministic scripted client for tests, and any
  OpenAI-compatible API (Groq, Ollama, and others) for real models

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
- [ ] Automated chaos test suite (random worker kills, verify exactly-once)
- [ ] Demo agent with a side-effecting tool, and deployment

## Chaos test results

_To be added after the automated suite is built._