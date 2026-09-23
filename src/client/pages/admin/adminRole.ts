// 管理画面の役割（管理者 / 閲覧専用）を配下の画面に渡すためのコンテキスト。
// 役割は AdminTokenGate が GET /api/admin/me で取得して入れる。
import { createContext, useContext } from 'react';
import type { AdminRole } from '../../../shared/types';

/** Provider の外で使われたときは、書き込み操作を隠す側（viewer）に倒す */
export const AdminRoleContext = createContext<AdminRole>('viewer');

export function useAdminRole(): AdminRole {
  return useContext(AdminRoleContext);
}
