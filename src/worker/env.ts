// Worker bindings/env の型定義

export interface Env {
  DB: D1Database;
  ADMIN_TOKEN: string;
  MCP_TOKEN: string;
  /** 管理APIの閲覧専用トークン（任意）。未設定・空文字なら閲覧専用ログインは無効 */
  VIEWER_TOKEN?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
}
