import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Run } from '../runs/run.entity';
import type { RunStatus } from '../runs/run.entity';
import { Step } from '../steps/step.entity';
import type { StepKind } from '../steps/step.entity';
import { ToolCall } from '../tools/tool-call.entity';
import type { ToolResultPayload } from '../tools/tool-call.entity';
import { FencedError } from './errors';

export interface NewStep {
  stepIndex: number;
  kind: StepKind;
  request: unknown;
  response: unknown;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
}

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

// Inserts only if (a) this worker still owns the run and (b) the step doesn't exist yet.
const INSERT_STEP_SQL = `
INSERT INTO steps (run_id, step_index, kind, request, response, tokens_in, tokens_out, latency_ms, status)
SELECT $1::uuid, $2::int, $3::text, $4::jsonb, $5::jsonb, $6::int, $7::int, $8::int, 'done'
WHERE EXISTS (SELECT 1 FROM runs WHERE id = $1::uuid AND attempt = $9::int)
ON CONFLICT (run_id, step_index) DO NOTHING
RETURNING id`;

@Injectable()
export class RunStateRepository {
  constructor(private readonly ds: DataSource) {}

  getRun(id: string) {
    return this.ds.getRepository(Run).findOneBy({ id });
  }

  async getStatus(id: string): Promise<RunStatus | undefined> {
    return (await this.getRun(id))?.status;
  }

  getSteps(runId: string) {
    return this.ds.getRepository(Step).find({ where: { runId }, order: { stepIndex: 'ASC' } });
  }

  /** Saves a step and adds its tokens to the run, atomically. Returns the run's new tokens_used. */
  saveStep(runId: string, attempt: number, s: NewStep): Promise<number> {
    return this.ds.transaction(async (em) => {
      const inserted = await em.query(INSERT_STEP_SQL, [
        runId,
        s.stepIndex,
        s.kind,
        json(s.request),
        json(s.response),
        s.tokensIn ?? null,
        s.tokensOut ?? null,
        s.latencyMs ?? null,
        attempt,
      ]);
      if (inserted.length === 0) throw new FencedError(runId);

      const tokens = Math.trunc((s.tokensIn ?? 0) + (s.tokensOut ?? 0));
      const updated = await em
        .createQueryBuilder()
        .update(Run)
        .set({ tokensUsed: () => `tokens_used + ${tokens}` })
        .where('id = :runId AND attempt = :attempt', { runId, attempt })
        .returning('tokens_used')
        .execute();
      if (!updated.raw[0]) throw new FencedError(runId); // rolls back the step insert too
      return Number(updated.raw[0].tokens_used);
    });
  }

  async finishRun(
    runId: string,
    attempt: number,
    status: RunStatus,
    patch: { result?: Record<string, unknown>; error?: string } = {},
  ) {
    const res = await this.ds
      .getRepository(Run)
      .update({ id: runId, attempt }, { status, result: patch.result as any ?? null, error: patch.error ?? null });
    if (res.affected === 0) throw new FencedError(runId);
  }

  /** true if this call created the row, false if it already existed */
  async beginToolCall(key: string, runId: string, toolName: string, args: unknown): Promise<boolean> {
    const res = await this.ds
      .createQueryBuilder()
      .insert()
      .into(ToolCall)
      .values({ idempotencyKey: key, runId, toolName, args:args as any, status: 'started' })
      .orIgnore()
      .returning('idempotency_key')
      .execute();
    return res.raw.length > 0;
  }

  getToolCall(key: string) {
    return this.ds.getRepository(ToolCall).findOneBy({ idempotencyKey: key });
  }

  async finishToolCall(key: string, result: ToolResultPayload) {
    await this.ds.getRepository(ToolCall).update({ idempotencyKey: key }, { status: 'done', result  });
  }
}