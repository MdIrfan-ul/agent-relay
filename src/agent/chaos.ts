export type ChaosPoint = 'llm_saved' | 'tool_executed' | 'tool_saved';

/**
 * Test hook: simulates a hard crash (SIGKILL) so tests can verify recovery.
 * Does nothing unless CHAOS_KILL_AFTER_STEP or CHAOS_CRASH_RATE is set.
 * Stops crashing after CHAOS_MAX_CRASH_ATTEMPTS attempts so every run can finish.
 */
export function maybeCrash(point: ChaosPoint, stepIndex: number, attempt: number): void {
  const maxAttempts = Number(process.env.CHAOS_MAX_CRASH_ATTEMPTS ?? 3);
  if (attempt > maxAttempts) return;

  const target = process.env.CHAOS_KILL_AFTER_STEP;
  const deterministic =
    target !== undefined &&
    target !== '' &&
    attempt === 1 &&
    point !== 'tool_executed' &&
    stepIndex === Number(target);

  const rate = Number(process.env.CHAOS_CRASH_RATE ?? 0);
  if (deterministic || Math.random() < rate) {
    console.error(`CHAOS: killing worker at ${point} (step ${stepIndex}, attempt ${attempt})`);
    process.kill(process.pid, 'SIGKILL');
  }
}