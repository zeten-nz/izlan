'use client';

import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/i18n-context';
import { isMarkdownActivity, type LearnerActivity } from '@/lib/api/types';

/**
 * Renders a VIEW-ONLY learner activity — prose (markdown) or a media/deferred placeholder. Objective activities are
 * NOT rendered here (the runner uses the canonical QuestionCard). The markdown renderer is safe BY CONSTRUCTION: it
 * only builds text + React elements and NEVER uses dangerouslySetInnerHTML, so authored raw HTML can never reach the DOM.
 */

/** Inline: bold only (**…**). Everything else is literal text — no HTML passthrough. */
function inlineNodes(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  text.split('**').forEach((part, idx) => {
    if (idx % 2 === 1) out.push(<strong key={`${keyBase}-b${idx}`}>{part}</strong>);
    else if (part.length > 0) out.push(<span key={`${keyBase}-s${idx}`}>{part}</span>);
  });
  return out;
}

function SafeMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') { i++; continue; }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      const cls = level === 1 ? 'text-xl font-bold' : level === 2 ? 'text-lg font-semibold' : 'text-base font-semibold';
      blocks.push(<p key={key} className={`${cls} text-text`}>{inlineNodes(heading[2] ?? '', `h${key}`)}</p>);
      key++; i++; continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) { items.push((lines[i] ?? '').replace(/^\s*[-*]\s+/, '')); i++; }
      blocks.push(
        <ul key={key} className="list-disc space-y-1 pl-5 text-text">
          {items.map((it, j) => <li key={j}>{inlineNodes(it, `li${key}-${j}`)}</li>)}
        </ul>,
      );
      key++; continue;
    }

    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !/^#{1,3}\s+/.test(lines[i] ?? '') && !/^\s*[-*]\s+/.test(lines[i] ?? '')) {
      para.push(lines[i] ?? '');
      i++;
    }
    blocks.push(<p key={key} className="leading-relaxed text-text">{inlineNodes(para.join(' '), `p${key}`)}</p>);
    key++;
  }
  return <div className="flex flex-col gap-3 text-[15px]">{blocks}</div>;
}

export function LessonActivityView({ activity }: { activity: LearnerActivity }) {
  const t = useT();
  if (isMarkdownActivity(activity)) {
    return (
      <div className="rounded-panel border border-border bg-surface p-5">
        <SafeMarkdown source={activity.markdown} />
      </div>
    );
  }
  // Metadata-only (IMAGE / AUDIO / deferred types): the learner projection carries no content in runtime v1 — a safe,
  // honest placeholder rather than a broken media element (§16).
  return <p className="rounded-panel border border-dashed border-border bg-surface-2 p-5 text-sm text-muted">{t('learner.lesson.unsupported')}</p>;
}
