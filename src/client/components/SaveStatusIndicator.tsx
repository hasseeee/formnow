export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  status: SaveStatus;
  onRetry: () => void;
}

/** フォーム編集画面ヘッダー用の自動保存インジケーター */
export default function SaveStatusIndicator({ status, onRetry }: Props) {
  if (status === 'saving') {
    return <span className="save-indicator save-indicator-saving">保存中…</span>;
  }
  if (status === 'error') {
    return (
      <span className="save-indicator save-indicator-error">
        保存に失敗しました
        <button type="button" className="btn btn-link save-retry-btn" onClick={onRetry}>
          再試行
        </button>
      </span>
    );
  }
  if (status === 'saved') {
    return <span className="save-indicator save-indicator-saved">保存済み ✓</span>;
  }
  return null;
}
