import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClientSession, Db, MongoClientOptions } from 'mongodb';
import { MongoClient } from 'mongodb';

export class MongoSessionContext {
  private readonly storage = new AsyncLocalStorage<ClientSession>();

  public runWithSession<T>(session: ClientSession, work: () => Promise<T>): Promise<T> {
    return this.storage.run(session, work);
  }

  public getCurrentSession(): ClientSession | undefined {
    return this.storage.getStore();
  }
}

export class MongoDatabaseProvider {
  private client?: MongoClient;
  private database?: Db;

  public constructor(
    private readonly uri: string,
    private readonly clientOptions: MongoClientOptions = {}
  ) {}

  public async getClient(): Promise<MongoClient> {
    if (this.client === undefined) {
      this.client = new MongoClient(this.uri, this.clientOptions);
      await this.client.connect();
    }

    return this.client;
  }

  public async getDatabase(): Promise<Db> {
    if (this.database === undefined) {
      const client = await this.getClient();
      this.database = client.db();
    }

    return this.database;
  }

  public async close(): Promise<void> {
    if (this.client !== undefined) {
      await this.client.close();
      this.client = undefined;
      this.database = undefined;
    }
  }
}

export class MongoUnitOfWorkAdapter {
  public constructor(
    private readonly provider: MongoDatabaseProvider,
    private readonly sessionContext: MongoSessionContext
  ) {}

  public async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    const client = await this.provider.getClient();
    const session = client.startSession();
    let result!: T;

    try {
      await this.sessionContext.runWithSession(session, async () => {
        await session.withTransaction(async () => {
          result = await work();
        });
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
}
