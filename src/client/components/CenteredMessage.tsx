import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  tone?: 'default' | 'error';
}

export default function CenteredMessage({ children, tone = 'default' }: Props) {
  return (
    <div className="page-container">
      <div className={`card centered-message${tone === 'error' ? ' tone-error' : ''}`}>
        {children}
      </div>
    </div>
  );
}
