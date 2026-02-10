import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGoogleAuthToUsers1747000000014 implements MigrationInterface {
    name = 'AddGoogleAuthToUsers1747000000014'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "google_id" text`);
        await queryRunner.query(`ALTER TABLE "users" ADD "google_email" text`);
        await queryRunner.query(`ALTER TABLE "users" ADD "google_name" text`);
        await queryRunner.query(`ALTER TABLE "users" ADD "google_picture" text`);
        await queryRunner.query(`CREATE UNIQUE INDEX "users_google_id_idx" ON "users" ("google_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "users_google_id_idx"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "google_picture"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "google_name"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "google_email"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "google_id"`);
    }

}
