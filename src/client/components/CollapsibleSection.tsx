import { useState, type ReactNode } from 'react';

interface Props {
  title: string;
  /** 初期表示時のみ参照される（マウント後の変化には追従しない） */
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Googleフォーム風の折りたたみセクション。ネイティブ <details> をラップする。 */
export default function CollapsibleSection({ title, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      className="accordion-section"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="accordion-summary">{title}</summary>
      <div className="accordion-body">{children}</div>
    </details>
  );
}
