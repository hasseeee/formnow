// 評価画面のチーム名付きステップ表示。評価中以外のチップを押すとそのチームへ移る。
// 状態はすべて props で受け取る（自前で持つのは横スクロール位置合わせ用の ref のみ）。
import { useEffect, useRef } from 'react';
import { getTeamStepStatus, type TeamStepStatus } from '../../../shared/evalFlow';
import type { Team } from '../../../shared/types';

interface Props {
  teams: Team[];
  currentIndex: number;
  completedTeamIds: ReadonlySet<number>;
  onJump: (index: number) => void;
  /** 保存中はチップを押せない */
  disabled: boolean;
}

const STATUS_LABEL: Record<TeamStepStatus, string> = {
  current: '評価中',
  done: '評価済み',
  todo: '未回答',
};

export default function TeamStepNav({
  teams,
  currentIndex,
  completedTeamIds,
  onJump,
  disabled,
}: Props) {
  const listRef = useRef<HTMLOListElement>(null);

  // 評価中のチップがチップ列の中央に来るよう横スクロール位置を合わせる。
  // scrollIntoView は画面全体が縦に動くことがあるため使わず、scrollLeft を直接設定する。
  useEffect(() => {
    const list = listRef.current;
    const chip = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !chip) return;
    const listRect = list.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    const offset = chipRect.left + chipRect.width / 2 - (listRect.left + listRect.width / 2);
    list.scrollLeft += offset;
  }, [currentIndex, teams]);

  const doneCount = teams.filter((t) => completedTeamIds.has(t.id)).length;

  return (
    <nav className="team-step-nav" aria-label="評価するチーム">
      <p className="team-step-count">
        評価済み {doneCount} / {teams.length}
      </p>
      <ol className="team-step-list" ref={listRef}>
        {teams.map((t, i) => {
          const status = getTeamStepStatus(t.id, i, currentIndex, completedTeamIds);
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`team-step-chip is-${status}`}
                aria-current={status === 'current' ? 'step' : undefined}
                aria-label={`${t.name}、${STATUS_LABEL[status]}`}
                title={t.name}
                disabled={disabled}
                onClick={() => {
                  if (status !== 'current') onJump(i);
                }}
              >
                {status === 'done' && (
                  <span className="team-step-check" aria-hidden="true">
                    ✓
                  </span>
                )}
                <span className="team-step-name">{t.name}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
