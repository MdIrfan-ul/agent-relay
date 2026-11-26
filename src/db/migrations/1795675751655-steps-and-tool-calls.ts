import { MigrationInterface, QueryRunner } from "typeorm";

export class StepsAndToolCalls1795675751655 implements MigrationInterface {
    name = 'StepsAndToolCalls1795675751655'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "steps" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "run_id" uuid NOT NULL, "step_index" integer NOT NULL, "kind" text NOT NULL, "request" jsonb, "response" jsonb, "tokens_in" integer, "tokens_out" integer, "latency_ms" integer, "status" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_a4a63b74eeef011be2d94eced75" UNIQUE ("run_id", "step_index"), CONSTRAINT "PK_65f86ac8996204d11f915f66a5b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "tool_calls" ("idempotency_key" text NOT NULL, "run_id" uuid NOT NULL, "tool_name" text NOT NULL, "args" jsonb, "result" jsonb, "status" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1d83d314f6cc60558c12aa5b557" PRIMARY KEY ("idempotency_key"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fb18eec0a2a2aa4f4dd3a716a6" ON "tool_calls"  ("run_id") `);
        await queryRunner.query(`ALTER TABLE "steps" ADD CONSTRAINT "FK_96f5f2c0a8aaade96bafe0a97dc" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "steps" DROP CONSTRAINT "FK_96f5f2c0a8aaade96bafe0a97dc"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fb18eec0a2a2aa4f4dd3a716a6"`);
        await queryRunner.query(`DROP TABLE "tool_calls"`);
        await queryRunner.query(`DROP TABLE "steps"`);
    }

}
