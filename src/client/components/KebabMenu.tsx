import { useEffect, useRef, useState } from 'react';

export interface KebabMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  items: KebabMenuItem[];
  ariaLabel?: string;
}

/**
 * 「⋯」ボタンから開く小さなドロップダウンメニュー。
 * 削除など間違って押すと困る操作を一段隠すために使う。
 * クリックで開閉し、外側クリック / Escapeキーで閉じる。
 */
export default function KebabMenu({ items, ariaLabel = 'その他の操作' }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: globalThis.MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="kebab-menu" ref={containerRef}>
      <button
        type="button"
        className="btn btn-ghost btn-sm kebab-trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((cur) => !cur);
        }}
      >
        ⋯
      </button>
      {open && (
        <div className="kebab-dropdown" role="menu" onClick={(e) => e.stopPropagation()}>
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={`kebab-item${item.danger ? ' kebab-item-danger' : ''}`}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
