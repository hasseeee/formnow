import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <div className="page-container landing">
      <div className="card landing-hero">
        <p className="landing-eyebrow">サークルイベント向け評価フォーム</p>
        <h1 className="landing-title">FormNow</h1>
        <p className="landing-description">
          審査員フォームとメンバー相互評価フォームをまとめて作成・公開し、配点付きの集計とランキングまで一気通貫で行えます。回答者はURLと名前選択だけで、ログインなしにスマホから回答できます。
        </p>
        <Link to="/admin" className="btn btn-primary landing-cta">
          管理画面へ
        </Link>
      </div>
    </div>
  );
}
