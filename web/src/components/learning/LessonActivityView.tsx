'use client';

import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/i18n-context';
import { isMarkdownActivity, type LearnerActivity } from '@/lib/api/types';
import { LessonMedia } from './LessonMedia';

/**
 * Renders a VIEW-ONLY learner activity — prose (markdown) or a media/deferred placeholder. Objective activities are
 * NOT rendered here (the runner uses the canonical QuestionCard). The markdown renderer is safe BY CONSTRUCTION: it
 * only builds text + React elements and NEVER uses dangerouslySetInnerHTML, so authored raw HTML can never reach the DOM.
 */

/**
 * Inline: **bold** and `pattern` (inline code) only. Everything else is literal text — no HTML passthrough, so authored
 * raw HTML can never reach the DOM.
 */
function inlineNodes(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={`${keyBase}-t${n}`}>{text.slice(last, m.index)}</span>);
    if (m[1] !== undefined) out.push(<strong key={`${keyBase}-b${n}`}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={`${keyBase}-c${n}`} className="rounded bg-surface-2 px-1.5 py-0.5 text-[0.9em] font-semibold text-primary">{m[2]}</code>);
    last = re.lastIndex;
    n++;
  }
  if (last < text.length) out.push(<span key={`${keyBase}-t${n}`}>{text.slice(last)}</span>);
  return out;
}

const splitRow = (row: string): string[] => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isTableSeparator = (l: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

/**
 * Safe restricted-markdown renderer for authored lesson prose. Supported (all standard markdown, safe by construction —
 * builds only text + React elements, never dangerouslySetInnerHTML): #/##/### headings, **bold**, `inline patterns`,
 * `-` bullet lists, `>` blockquote callouts (rule/mistake notes), `---` horizontal rules, and GFM pipe tables (used as
 * rule cards / word-meaning pairs). Anything else is literal text. Documented for Methodists in METHODIST_CONTENT_GUIDE.
 */
function SafeMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') { i++; continue; }

    // Horizontal rule (--- / *** on its own line). Distinct from list markers ("- " / "* ").
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(<hr key={key} className="border-border" />); key++; i++; continue; }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      const cls = level === 1 ? 'text-xl font-bold' : level === 2 ? 'text-lg font-semibold' : 'text-base font-semibold';
      blocks.push(<p key={key} className={`${cls} text-text`}>{inlineNodes(heading[2] ?? '', `h${key}`)}</p>);
      key++; i++; continue;
    }

    // Blockquote callout: consecutive `>` lines → a left-accented note panel (rule / "e'tibor bering" / common mistake).
    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) { quoted.push((lines[i] ?? '').replace(/^\s*>\s?/, '')); i++; }
      blocks.push(
        <div key={key} className="flex flex-col gap-1.5 rounded-control border border-border border-l-[3px] border-l-primary bg-surface-2 px-4 py-3 text-[14.5px] leading-relaxed text-text">
          {quoted.filter((q) => q.trim() !== '').map((q, j) => <p key={j}>{inlineNodes(q, `q${key}-${j}`)}</p>)}
        </div>,
      );
      key++; continue;
    }

    // GFM pipe table (header row + `---` separator + body). Used as rule cards / word-meaning pairs.
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1] ?? '')) {
      const header = splitRow(line);
      i += 2; // consume header + separator
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') { rows.push(splitRow(lines[i] ?? '')); i++; }
      blocks.push(
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-[14.5px]">
            <thead>
              <tr>{header.map((h, c) => <th key={c} className="border border-border bg-surface-2 px-3 py-2 text-left font-semibold text-text">{inlineNodes(h, `th${key}-${c}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((cell, c) => <td key={c} className="border border-border px-3 py-2 text-text">{inlineNodes(cell, `td${key}-${ri}-${c}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      key++; continue;
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
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !/^#{1,3}\s+/.test(lines[i] ?? '') &&
      !/^\s*[-*]\s+/.test(lines[i] ?? '') &&
      !/^\s*>\s?/.test(lines[i] ?? '') &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i] ?? '') &&
      !((lines[i] ?? '').includes('|') && isTableSeparator(lines[i + 1] ?? ''))
    ) {
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
  const media = activity.media;
  if (isMarkdownActivity(activity)) {
    // EXAMPLE steps get a subtle left accent + tinted surface so worked examples read as distinct from explanations.
    const isExample = activity.type === 'EXAMPLE';
    return (
      <div className="flex flex-col gap-3">
        <div className={`rounded-panel border p-5 ${isExample ? 'border-border border-l-[3px] border-l-primary bg-surface-2' : 'border-border bg-surface'}`}>
          <SafeMarkdown source={activity.markdown} />
        </div>
        <LessonMedia media={media} />
      </div>
    );
  }
  // A prose-less step: render attached media if present, otherwise a safe, honest placeholder (never a broken element).
  if (media && media.length > 0) return <LessonMedia media={media} />;
  return <p className="rounded-panel border border-dashed border-border bg-surface-2 p-5 text-sm text-muted">{t('learner.lesson.unsupported')}</p>;
}
