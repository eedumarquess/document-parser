import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDocumentsTable1700000000000 implements MigrationInterface {
  name = 'CreateDocumentsTable1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        original_filename text NOT NULL,
        stored_filename text NOT NULL,
        storage_path text NOT NULL,
        mime_type text NOT NULL,
        size_bytes bigint NOT NULL,
        checksum_sha256 text NOT NULL,
        metadata jsonb NULL,
        status text NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        last_error text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz NULL
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS documents_status_idx ON documents(status)',
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS documents_set_updated_at ON documents;
      CREATE TRIGGER documents_set_updated_at
      BEFORE UPDATE ON documents
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS documents_set_updated_at ON documents',
    );
    await queryRunner.query('DROP FUNCTION IF EXISTS set_updated_at');
    await queryRunner.query('DROP INDEX IF EXISTS documents_status_idx');
    await queryRunner.query('DROP TABLE IF EXISTS documents');
  }
}
