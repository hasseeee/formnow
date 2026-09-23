import { useEffect, useState, type FormEvent } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import type { AdminRole } from '../../../shared/types';
import {
  ApiRequestError,
  clearAdminToken,
  getAdminMe,
  getAdminToken,
  setAdminToken,
  setUnauthorizedListener,
} from '../../api';
import { AdminRoleContext } from './adminRole';

export default function AdminTokenGate() {
  const [token, setToken] = useState<string | null>(() => getAdminToken());
  const [input, setInput] = useState('');
  // 役割はどのトークンで取得したかと組にして持つ（入り直したときに古い役割を使わないため）
  const [me, setMe] = useState<{ token: string; role: AdminRole } | null>(null);
  // 役割の取得に失敗したときのトークン（同じトークンのあいだだけエラーを出す）
  const [meFailedToken, setMeFailedToken] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setUnauthorizedListener(() => {
      setToken(null);
    });
    return () => setUnauthorizedListener(null);
  }, []);

  // トークンが変わるたびに役割を問い合わせる。誤ったトークンは 401 でログイン画面に戻る
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getAdminMe()
      .then(({ role }) => {
        if (!cancelled) setMe({ token, role });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.status === 401) return;
        // サーバーの英語メッセージは出さず、利用者向けの日本語にそろえる
        setMeFailedToken(token);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const role = me && me.token === token ? me.role : null;
  const roleError =
    meFailedToken !== null && meFailedToken === token
      ? '役割の取得に失敗しました。ページを再読み込みしてください。'
      : null;

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    setAdminToken(trimmed);
    setToken(trimmed);
    setInput('');
  };

  const handleLogout = () => {
    clearAdminToken();
    setToken(null);
    navigate('/admin');
  };

  if (!token) {
    return (
      <div className="page-container">
        <form className="card token-form" onSubmit={handleLogin}>
          <h1>FormNow 管理画面</h1>
          <p className="muted">管理トークン、または閲覧用トークンを入力してください。</p>
          <input
            type="password"
            className="text-input"
            placeholder="トークン"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
            ログイン
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-header-left">
          <Link to="/admin" className="admin-brand">
            FormNow 管理
          </Link>
          {role === 'viewer' && <span className="role-badge">閲覧専用</span>}
        </div>
        <button type="button" className="btn btn-ghost" onClick={handleLogout}>
          ログアウト
        </button>
      </header>
      <main className="admin-main">
        {role ? (
          <AdminRoleContext.Provider value={role}>
            <Outlet />
          </AdminRoleContext.Provider>
        ) : roleError ? (
          <p className="form-error">{roleError}</p>
        ) : (
          <p className="muted">読み込み中…</p>
        )}
      </main>
    </div>
  );
}
