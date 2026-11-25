import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'dead';

@Entity('runs')
@Index(['status', 'createdAt'])
export class Run {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'idempotency_key', unique: true, nullable: true })
  idempotencyKey: string | null;

  @Column({ type: 'text', name: 'agent_name' })
  agentName: string;

  @Column({ type: 'jsonb' })
  input: Record<string, unknown>;

  @Column({ type: 'text', default: 'queued' })
  status: RunStatus;

  // fencing token: bumped each time a worker starts this run
  @Column({ type: 'int', default: 0 })
  attempt: number;

  @Column({ type: 'int', name: 'max_steps', default: 20 })
  maxSteps: number;

  @Column({ type: 'int', name: 'token_budget', default: 50000 })
  tokenBudget: number;

  @Column({ type: 'int', name: 'tokens_used', default: 0 })
  tokensUsed: number;

  @Column({ type: 'numeric', name: 'cost_usd', precision: 10, scale: 5, default: 0 })
  costUsd: string;

  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}