import type { PreviewActivity } from '../api/types';
import { activityCategory } from './activity-meta';

/**
 * Learner-preview SAFE view model (merge-blocker: preview must never expose answerKey / correctOptionIds / storageKey).
 *
 * This is an explicit ALLOWLIST projection: it copies ONLY the named learner-safe fields off the (already
 * answerKey-stripped) backend preview object. It never reads `answerKey`, `correctOptionIds`, or `storageKey`, and the
 * preview component renders THIS model — it never stringifies or spreads the raw preview payload. So even if a payload
 * were malformed or carried extra secret fields, they cannot reach the DOM.
 */

export interface SafePreviewOption {
  id: string;
  text: string;
}
export type SafePreviewActivity =
  | { kind: 'objective'; id: string; type: string; position: number; format: string | null; prompt: string; options: SafePreviewOption[] }
  | { kind: 'markdown'; id: string; type: string; position: number; markdown: string }
  | { kind: 'media'; id: string; type: string; position: number }
  | { kind: 'unknown'; id: string; type: string; position: number };

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function toSafePreviewActivity(a: PreviewActivity): SafePreviewActivity {
  const id = str(a.id);
  const type = str(a.type);
  const position = num(a.position);
  const category = activityCategory(a.type);

  if (category === 'objective') {
    const rawOptions = Array.isArray((a as Record<string, unknown>).options) ? ((a as Record<string, unknown>).options as unknown[]) : [];
    const options: SafePreviewOption[] = rawOptions.map((o) => {
      const oo = (o ?? {}) as Record<string, unknown>;
      return { id: str(oo.id), text: str(oo.text) }; // ONLY id + text — never any answer/correctness field
    });
    const fmt = (a as Record<string, unknown>).format;
    return { kind: 'objective', id, type, position, format: typeof fmt === 'string' ? fmt : null, prompt: str((a as Record<string, unknown>).prompt), options };
  }

  if (category === 'markdown') {
    return { kind: 'markdown', id, type, position, markdown: str((a as Record<string, unknown>).markdown) };
  }

  if (category === 'media') {
    return { kind: 'media', id, type, position };
  }

  return { kind: 'unknown', id, type, position };
}
