import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** The "real world" the tool touches. One row per idempotency key, however many times the tool ran. */
@Entity('effects')
export class Effect {
  @PrimaryColumn({ type: 'text', name: 'idempotency_key' })
  idempotencyKey: string;

  @Column({ type: 'uuid', name: 'run_id' })
  runId: string;

  @Column({ type: 'text' })
  label: string;

  /** How many times the tool executed for this key. More than 1 means it re-ran after a crash. */
  @Column({ type: 'int', default: 1 })
  executions: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}