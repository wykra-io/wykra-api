import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReasoningEffortToUsers1747000000013 implements MigrationInterface {
    name = 'AddReasoningEffortToUsers1747000000013'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "reasoning_effort" text DEFAULT 'none'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "reasoning_effort"`);
    }

}
