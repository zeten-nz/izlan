'use client';

import ReactMarkdown from 'react-markdown';

/**
 * Restricted Markdown renderer. react-markdown does NOT render raw HTML by default (no rehype-raw is used, and none
 * ever will be), so embedded HTML is shown as inert text. This is the ONLY markdown rendering path in the CMS.
 */
export function MarkdownPreview({ markdown }: { markdown: string }) {
  return (
    <div className="prose-sm max-w-none break-words text-sm text-text [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-2 [&_pre]:p-2">
      <ReactMarkdown skipHtml>{markdown || '_Bo‘sh_'}</ReactMarkdown>
    </div>
  );
}
