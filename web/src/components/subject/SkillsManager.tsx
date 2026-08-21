'use client';

import { useCallback, useState } from 'react';
import { FiEdit2, FiPlus } from 'react-icons/fi';
import { createSkill, listSkills, updateSkill } from '@/lib/api/content';
import type { Skill } from '@/lib/api/types';
import { useResource } from '@/lib/hooks/use-resource';
import { useCapabilities } from '@/lib/cms/cms-context';
import { Button, Card, IconButton, useToast } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';
import { ResourceView, EmptyState } from '@/components/ui/states';
import { EntityFormDialog, type FormValues } from '@/components/forms/EntityFormDialog';

const s = (v?: string) => (v ?? '').trim();

/** Subject Skill manager — create + edit (ACTIVE only). No delete/archive (backend does not expose it). */
export function SkillsManager({ subjectId }: { subjectId: string }) {
  const caps = useCapabilities();
  const { toast } = useToast();
  const res = useResource(useCallback(() => listSkills(subjectId), [subjectId]), [subjectId]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);

  const fields = [
    { name: 'name', label: 'Nomi', type: 'text' as const, required: true },
    { name: 'code', label: 'Kod', type: 'text' as const },
    { name: 'description', label: 'Tavsif', type: 'textarea' as const },
    { name: 'sortOrder', label: 'Tartib', type: 'number' as const },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Ko‘nikmalar</h3>
        {caps.author && (
          <Button size="sm" variant="secondary" leftIcon={<FiPlus aria-hidden />} onClick={() => setCreating(true)}>
            Ko‘nikma qo‘shish
          </Button>
        )}
      </div>

      <ResourceView
        loading={res.loading}
        error={res.error}
        data={res.data}
        onRetry={res.reload}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="Ko‘nikma yo‘q" message="Bu fanda hali ko‘nikma yaratilmagan." />}
      >
        {(skills) => (
          <ul className="grid gap-2 sm:grid-cols-2">
            {skills.map((sk) => (
              <li key={sk.id}>
                <Card className="flex items-start justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-text">{sk.name}</span>
                      <StatusBadge status={sk.status} />
                    </div>
                    {sk.code && <span className="text-xs text-muted">kod: {sk.code}</span>}
                    {sk.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{sk.description}</p>}
                  </div>
                  {caps.author && sk.status === 'ACTIVE' && (
                    <IconButton label="Tahrirlash" onClick={() => setEditing(sk)}>
                      <FiEdit2 aria-hidden />
                    </IconButton>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </ResourceView>

      <EntityFormDialog
        open={creating}
        title="Yangi ko‘nikma"
        fields={fields}
        onSubmit={async (v: FormValues) => {
          await createSkill(subjectId, { name: s(v.name), code: s(v.code) || undefined, description: s(v.description) || undefined, sortOrder: v.sortOrder ? Number(v.sortOrder) : undefined });
          toast('Ko‘nikma yaratildi', 'success');
          res.reload();
        }}
        onClose={() => setCreating(false)}
      />
      <EntityFormDialog
        open={editing !== null}
        title="Ko‘nikmani tahrirlash"
        fields={fields}
        initial={editing ? { name: editing.name, code: editing.code ?? '', description: editing.description ?? '', sortOrder: String(editing.sortOrder) } : {}}
        onSubmit={async (v: FormValues) => {
          if (!editing) return;
          await updateSkill(editing.id, {
            expectedUpdatedAt: editing.updatedAt,
            name: s(v.name),
            code: s(v.code) ? s(v.code) : null,
            description: s(v.description) ? s(v.description) : null,
            sortOrder: v.sortOrder ? Number(v.sortOrder) : undefined,
          });
          toast('Saqlandi', 'success');
          res.reload();
        }}
        onClose={() => setEditing(null)}
        onConflictReload={res.reload}
      />
    </div>
  );
}
