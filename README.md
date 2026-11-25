# agent-relay

Crash-proof runtime for AI agents.

AI agents run multi-step tasks that can take minutes. If a worker crashes
halfway, most systems lose the work or repeat actions (like sending an
email twice). agent-relay checkpoints every step, so another worker
resumes exactly where the last one stopped, and no action runs twice.

## Features
- Durable runs: every LLM call and tool call is saved as a step
- Resume after crash: workers pick up from the last completed step
- Idempotent tool calls: retries never repeat side effects
- Retries with backoff, dead-letter handling, per-run cost and step limits
- Full trace per run (steps, latency, tokens, cost)

## Stack
NestJS · BullMQ (Redis) · PostgreSQL · AWS Bedrock (Converse API)

## Status
Work in progress. See the roadmap below.

## Roadmap
- [ ] Basic agent loop on Bedrock
- [ ] Step checkpointing and resume
- [ ] Idempotent tool calls
- [ ] Retries, backoff, dead-letter
- [ ] Fencing, reconciler, resource locks
- [ ] Observability and cost tracking
- [ ] Chaos test suite (kill workers, verify exactly-once)
- [ ] Demo agent and deployment