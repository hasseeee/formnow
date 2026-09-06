import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="page-container">
      <div className="card centered-message">
        <h1>ページが見つかりません</h1>
        <p className="muted">お探しのページは存在しないか、移動した可能性があります。</p>
        <Link to="/" className="btn btn-secondary">
          トップへ戻る
        </Link>
      </div>
    </div>
  );
}
