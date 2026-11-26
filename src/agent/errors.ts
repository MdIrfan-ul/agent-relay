export class FencedError extends Error {
  constructor(runId: string) {
    super(`run ${runId}: lost ownership (fenced)`);
    this.name = 'FencedError';
  }
}