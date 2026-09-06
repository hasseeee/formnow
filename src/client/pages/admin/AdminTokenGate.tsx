import { useEffect, useState, type FormEvent } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { clearAdminToken, getAdminToken, setAdminToken, setUnauthorizedListener } from '../../api';

export default function AdminTokenGate() {
  const [token, setToken] = useState<string | null>(() => getAdminToken());
  const [input, setInput] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setUnauthorizedListener(() => {
      setToken(null);
    });
    return () => setUnauthorizedListener(null);
  }, []);

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
          <p className="muted">管理トークンを入力してください。</p>
          <input
            type="password"
            className="text-input"
            placeholder="管理トークン"
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
        <Link to="/admin" className="admin-brand">
          FormNow 管理
        </Link>
        <button type="button" className="btn btn-ghost" onClick={handleLogout}>
          ログアウト
        </button>
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
