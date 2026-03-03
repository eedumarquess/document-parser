import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';
import { DocumentEntity } from './document.entity';
import { CreateDocumentsTable1700000000000 } from './migrations/1700000000000-create-documents-table';

const baseConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
  database: process.env.POSTGRES_DB ?? 'document_parser',
  entities: [DocumentEntity],
  migrations: [CreateDocumentsTable1700000000000],
  synchronize: false,
  logging: false,
};

export function getTypeOrmModuleOptions(): TypeOrmModuleOptions {
  return {
    ...baseConfig,
    autoLoadEntities: false,
  };
}

export const appDataSource = new DataSource(baseConfig);
