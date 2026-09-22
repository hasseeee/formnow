// テスト用のD1互換アダプタ。Node組み込みのSQLite（インメモリ）の上に、
// このアプリが使うD1のAPI（prepare/bind/first/all/run/batch）だけを実装する。
import { DatabaseSync } from 'node:sqlite';
import schema from '../../migrations/0001_init.sql?raw';

type Param = string | number | null;

function toParam(value: unknown): Param {
  if (value === undefined) throw new Error('D1_TYPE_ERROR: undefined はバインドできません');
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as Param;
}

class FakeStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: Param[] = [],
  ) {}

  bind(...values: unknown[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, values.map(toParam));
  }

  async first<T>(): Promise<T | null> {
    const rows = this.db.prepare(this.sql).all(...this.params);
    return (rows[0] as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    return { results: this.allSync<T>(), success: true, meta: {} };
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const info = this.db.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }

  /** batch() から同期的に呼ぶための入口 */
  allSync<T>(): T[] {
    return this.db.prepare(this.sql).all(...this.params) as T[];
  }
}

class FakeD1 {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this.db, sql);
  }

  /** 本物のD1と同じく、batch は1トランザクション。途中で失敗したら全体を巻き戻す */
  async batch(
    statements: FakeStatement[],
  ): Promise<{ results: unknown[]; success: true; meta: Record<string, unknown> }[]> {
    this.db.exec('BEGIN');
    try {
      const out = statements.map((s) => ({
        results: s.allSync(),
        success: true as const,
        meta: {},
      }));
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}

/** マイグレーション適用済みの空のDBを作る。テストごとに呼べば互いに干渉しない */
export function createTestDb(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  return new FakeD1(db) as unknown as D1Database;
}
