# agent-relay
Crash-proof runtime for AI agents. Built with NestJS, BullMQ, Postgres, and AWS Bedrock. Every step is checkpointed, tool calls are idempotent, and crashed runs resume on another worker with no duplicate actions.
