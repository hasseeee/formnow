import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useMemo } from 'react';

interface Props {
  source: string;
  className?: string;
}

/** Markdown文字列を marked でHTML化し、DOMPurifyでサニタイズして描画する */
export default function Markdown({ source, className }: Props) {
  const html = useMemo(() => {
    if (!source || source.trim() === '') return '';
    const rendered = marked.parse(source) as string;
    return DOMPurify.sanitize(rendered);
  }, [source]);

  if (!html) return null;

  return (
    <div
      className={['markdown-body', className].filter(Boolean).join(' ')}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
