import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_CLIENT } from '../llm/llm.types';
import type { LlmClient, LlmResponse, Message, ToolCallRequest } from '../llm/llm.types';
import { Run } from '../runs/run.entity';
import { Step } from '../steps/step.entity';
import { TOOLS } from '../tools/tools';
import { RunStateRepository } from './run-state.repository';
import { maybeCrash } from './chaos';

function pendingToolCalls(messages: Message[]): ToolCallRequest[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant') {
      const answered = new Set(messages.slice(i + 1).flatMap((x) => (x.role === 'tool' ? [x.toolCallId] : [])));
      return (m.toolCalls ?? []).filter((c) => !answered.has(c.id));
    }
  }
  return [];
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly state: RunStateRepository,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
  ) {}

  async run(runId: string, attempt: number): Promise<void> {
    const run = await this.state.getRun(runId);
    if (!run) throw new Error(`run ${runId} not found`);

    // Replay: the steps table is the single source of truth for where we are.
    const steps = await this.state.getSteps(runId);
    const messages = this.rebuildMessages(run, steps);
    let stepIndex = steps.length;
    let tokensUsed = run.tokensUsed;
    const specs = TOOLS.map((t) => t.spec);
    this.logger.log(`run ${runId} attempt ${attempt}: resuming at step ${stepIndex}`);

    while (true) {
      if ((await this.state.getStatus(runId)) === 'cancelled') return;

      // 1. finish any tool calls the last assistant turn asked for
      const pending = pendingToolCalls(messages);
      if (pending.length > 0) {
        for (const call of pending) {
          const content = await this.runToolOnce(runId, attempt, stepIndex, call);
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
          stepIndex++;
        }
        continue;
      }

      // 2. the last turn was a final answer that is already saved
      const last = messages[messages.length - 1];
      if (last.role === 'assistant') {
        return this.state.finishRun(runId, attempt, 'succeeded', { result: { text: last.content } });
      }

      // 3. limits
      if (stepIndex >= run.maxSteps || tokensUsed >= run.tokenBudget) {
        return this.state.finishRun(runId, attempt, 'failed', { error: 'step or token limit exceeded' });
      }

      // 4. ask the LLM, then checkpoint the answer
      const started = Date.now();
      const resp = await this.llm.generate(messages, specs);
      tokensUsed = await this.state.saveStep(runId, attempt, {
        stepIndex,
        kind: 'llm_call',
        request: { messageCount: messages.length },
        response: resp,
        tokensIn: resp.tokensIn,
        tokensOut: resp.tokensOut,
        latencyMs: Date.now() - started,
      });
      maybeCrash('llm_saved', stepIndex, attempt);
      messages.push({ role: 'assistant', content: resp.text, toolCalls: resp.toolCalls });
      stepIndex++;
    }
  }

    private async runToolOnce(runId: string, attempt: number, stepIndex: number, call: ToolCallRequest): Promise<string> {
    // Stable across attempts: built from ids, not from args (jsonb may reorder keys).
    const key = `${runId}:${stepIndex}:${call.id}`;
    const started = Date.now();

    const created = await this.state.beginToolCall(key, runId, call.name, call.args);
    const existing = created ? null : await this.state.getToolCall(key);

    let content: string;
    if (existing?.status === 'done' && existing.result) {
      // A previous attempt already ran this tool; reuse its result, don't run it again.
      content = existing.result.content;
    } else {
      // Fresh, or a previous attempt died mid-execution (outcome unknown).
      // Run it, passing the key so the side effect can dedupe downstream.
      let out: unknown;
      try {
        const tool = TOOLS.find((t) => t.spec.name === call.name);
        if (!tool) throw new Error(`unknown tool: ${call.name}`);
        const result = await tool.execute(call.args, {
          idempotencyKey: key,
          runId,
          recordEffect: (label) => this.state.recordEffect(key, runId, label),
        });
        out = { ok: true, result };
      } catch (e) {
        out = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      maybeCrash('tool_executed', stepIndex, attempt); // effect done, result not yet saved
      content = JSON.stringify(out);
      await this.state.finishToolCall(key, { content });
    }

    // Stored as a string so a replayed run sees exactly the same text.
    await this.state.saveStep(runId, attempt, {
      stepIndex,
      kind: 'tool_call',
      request: call,
      response: { content },
      latencyMs: Date.now() - started,
    });
    maybeCrash('tool_saved', stepIndex, attempt);
    return content;
  }

  private rebuildMessages(run: Run, steps: Step[]): Message[] {
    const task = typeof run.input.task === 'string' ? run.input.task : JSON.stringify(run.input);
    const messages: Message[] = [{ role: 'user', content: task }];
    for (const s of steps) {
      if (s.status !== 'done') continue;
      if (s.kind === 'llm_call') {
        const r = s.response as LlmResponse;
        messages.push({ role: 'assistant', content: r.text, toolCalls: r.toolCalls });
      } else {
        const req = s.request as ToolCallRequest;
        messages.push({
          role: 'tool',
          toolCallId: req.id,
          name: req.name,
          content: (s.response as { content: string }).content,
        });
      }
    }
    return messages;
  }
//     /** Test hook: simulates a hard crash right after a step is saved. Fires only on the first attempt. */
//   private maybeCrash(stepIndex: number, attempt: number): void {
//     const target = process.env.CHAOS_KILL_AFTER_STEP;
//     if (target !== undefined && target !== '' && attempt === 1 && stepIndex === Number(target)) {
//       this.logger.error(`CHAOS: killing worker after step ${stepIndex}`);
//       process.kill(process.pid, 'SIGKILL'); // abrupt: no graceful shutdown, no lock release
//     }
//   }
}