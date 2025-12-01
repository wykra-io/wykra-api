import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAnalysisToInstagramSearchProfiles1747000000002
  implements MigrationInterface
{
  public get _tableName(): string {
    return 'instagram_search_profiles';
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns(this._tableName, [
      new TableColumn({
        name: 'analysis_summary',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'analysis_score',
        type: 'int',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn(this._tableName, 'analysis_score');
    await queryRunner.dropColumn(this._tableName, 'analysis_summary');
  }
}


