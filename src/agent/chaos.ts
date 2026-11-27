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

export type FreezePoint = 'before_llm_save' | 'tool_executed';

/**
 * Test hook: blocks the whole event loop so this worker's job lock expires, simulating a "zombie".
 * Only the first attempt of a run freezes, so every run can finish.
 */
export function maybeFreeze(point: FreezePoint, stepIndex: number, attempt: number): void {
  const rate = Number(process.env.CHAOS_FREEZE_RATE ?? 0);
  if (attempt !== 1 || !(Math.random() < rate)) return;
  const ms = Number(process.env.CHAOS_FREEZE_MS ?? 25_000);
  console.error(`CHAOS: freezing worker for ${ms}ms at ${point} (step ${stepIndex}, attempt ${attempt})`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  console.error(`CHAOS: resumed after freeze at ${point} (step ${stepIndex})`);
}