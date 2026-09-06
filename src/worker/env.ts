// Worker bindings/env の型定義

export interface Env {
  DB: D1Database;
  ADMIN_TOKEN: string;
  MCP_TOKEN: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
}
