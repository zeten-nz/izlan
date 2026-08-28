'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useT } from '@/lib/i18n/i18n-context';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useResource } from '@/lib/hooks/use-resource';
import { describeError } from '@/lib/ui/error-text';
import * as api from '@/lib/api/point-studio';
import type { PointDetail, PointReadinessReport, BindableActivity, SubjectSkill } from '@/lib/api/point-studio';
import { StudioHeader } from '@/components/shell/StudioHeader';
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { ConfirmDialog } from '@/components/ui/dialog';

export default function PointEditorPage() {
  const { pointId } = useParams<{ pointId: string }>();
  const res = useResource(useCallback(() => api.getPoint(pointId), [pointId]));
  return (
    <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
      {(d) => <Editor initial={d} />}
    </ResourceView>
  );
}

function Editor({ initial }: { initial: PointDetail }) {
  const t = useT();
  const caps = useCapabilities();
  const [detail, setDetail] = useState<PointDetail>(initial);
  const editable = detail.revision.editable && caps.author;

  return (
    <div className="space-y-6">
      <StudioHeader
        breadcrumb={[{ label: t('pointStudio.title'), href: '/staff/content/points' }]}
        title={detail.revision.title}
        status={detail.revision.status}
        meta={`${detail.point.pointKey} · v${detail.revision.versionNo}`}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <MetadataSection detail={detail} editable={editable} onReload={setDetail} />
          <SkillsSection detail={detail} editable={editable} onReload={setDetail} />
          <BlueprintSection detail={detail} editable={editable} onReload={setDetail} />
          <MasterySection detail={detail} editable={editable} onReload={setDetail} />
          <SourcesSection detail={detail} editable={editable} onReload={setDetail} />
          <IssuesSection detail={detail} editable={editable} onReload={setDetail} />
        </div>
        <div className="space-y-5">
          <WorkflowRail detail={detail} caps={caps} onReload={setDetail} />
          <ReadinessPanel detail={detail} />
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function useSaver(onReload: (d: PointDetail) => void) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<PointDetail>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onReload(await fn());
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function MetadataSection({ detail, editable, onReload }: { detail: PointDetail; editable: boolean; onReload: (d: PointDetail) => void }) {
  const t = useT();
  const { busy, error, run } = useSaver(onReload);
  const [title, setTitle] = useState(detail.revision.title);
  const [canDo, setCanDo] = useState(detail.revision.canDo.join('\n'));
  const [effort, setEffort] = useState(String(detail.revision.estimatedEffortMin ?? ''));
  useEffect(() => { setTitle(detail.revision.title); setCanDo(detail.revision.canDo.join('\n')); setEffort(String(detail.revision.estimatedEffortMin ?? '')); }, [detail.revision.updatedAt]);

  return (
    <Section title={t('pointStudio.sections.metadata')}>
      {error && <Err text={error} />}
      <div className="space-y-3">
        <Field label={t('pointStudio.fields.title')}><Input value={title} disabled={!editable} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label={t('pointStudio.learn')}><Textarea rows={3} value={canDo} disabled={!editable} onChange={(e) => setCanDo(e.target.value)} /></Field>
        <Field label={t('pointStudio.fields.effort')}><Input type="number" value={effort} disabled={!editable} onChange={(e) => setEffort(e.target.value)} /></Field>
        {editable && (
          <Button loading={busy} onClick={() => run(() => api.updatePointRevision(detail.revision.id, { expectedUpdatedAt: detail.revision.updatedAt, title, canDo: canDo.split('\n').map((s) => s.trim()).filter(Boolean), estimatedEffortMin: Number(effort) || undefined }))}>
            {t('common.save')}
          </Button>
        )}
      </div>
    </Section>
  );
}

function SkillsSection({ detail, editable, onReload }: { detail: PointDetail; editable: boolean; onReload: (d: PointDetail) => void }) {
  const t = useT();
  const { busy, error, run } = useSaver(onReload);
  const skillsRes = useResource<SubjectSkill[]>(useCallback(() => (editable ? api.listSubjectSkills(detail.point.subjectId) : Promise.resolve([])), [detail.point.subjectId, editable]), [detail.point.subjectId]);
  const current = detail.skills.map((s) => s.skillId);
  const save = (skillIds: string[]) => run(() => api.setPointSkills(detail.revision.id, { expectedUpdatedAt: detail.revision.updatedAt, skills: skillIds.map((id) => ({ skillId: id, role: 'REQUIRED' })) }));

  return (
    <Section title={t('pointStudio.sections.skills')}>
      {error && <Err text={error} />}
      {detail.skills.length === 0 ? <p className="text-sm text-muted">{t('pointStudio.skills.empty')}</p> : (
        <ul className="space-y-1">
          {detail.skills.map((s) => (
            <li key={s.skillId} className="flex items-center justify-between rounded-control bg-surface-2 px-3 py-1.5 text-sm">
              <span>{s.skillName} <span className="text-xs text-muted">· {s.role}</span></span>
              {editable && <button type="button" className="text-xs text-danger" disabled={busy} onClick={() => save(current.filter((id) => id !== s.skillId))}>{t('pointStudio.skills.remove')}</button>}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="mt-3">
          <Select disabled={busy} value="" onChange={(e) => { if (e.target.value) save([...current, e.target.value]); }}>
            <option value="">+ {t('pointStudio.skills.add')}</option>
            {(skillsRes.data ?? []).filter((s) => !current.includes(s.id)).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>
      )}
    </Section>
  );
}

function BlueprintSection({ detail, editable, onReload }: { detail: PointDetail; editable: boolean; onReload: (d: PointDetail) => void }) {
  const t = useT();
  const { busy, error, run } = useSaver(onReload);
  const bpRev = detail.blueprint?.revision;
  const actsRes = useResource<BindableActivity[]>(useCallback(() => (editable ? api.listBindableActivities(detail.point.subjectId) : Promise.resolve([])), [detail.point.subjectId, editable]), [detail.point.subjectId]);
  const [stages, setStages] = useState(() => bpRev?.stages.map((s) => ({ stageType: s.stageType, title: s.title, bindings: s.bindings.map((b) => ({ activityId: b.activityId ?? '', role: b.role })) })) ?? []);
  useEffect(() => { setStages(bpRev?.stages.map((s) => ({ stageType: s.stageType, title: s.title, bindings: s.bindings.map((b) => ({ activityId: b.activityId ?? '', role: b.role })) })) ?? []); }, [bpRev?.updatedAt]);
  if (!bpRev) return null;

  const addStage = () => setStages([...stages, { stageType: 'concept', title: 'Stage', bindings: [] }]);
  const save = () => run(() => api.setBlueprintStages(bpRev.id, { expectedUpdatedAt: bpRev.updatedAt, stages: stages.map((s) => ({ stageType: s.stageType, title: s.title, bindings: s.bindings.filter((b) => b.activityId) })) }));

  return (
    <Section title={t('pointStudio.sections.blueprint')} action={editable ? <Button size="sm" variant="secondary" onClick={addStage}>{t('pointStudio.blueprint.addStage')}</Button> : undefined}>
      {error && <Err text={error} />}
      <p className="mb-3 text-xs text-muted">{t('pointStudio.blueprint.evidenceHint')}</p>
      {stages.length === 0 ? <p className="text-sm text-muted">{t('pointStudio.blueprint.empty')}</p> : (
        <ol className="space-y-3">
          {stages.map((st, i) => (
            <li key={i} className="rounded-control border border-border p-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('pointStudio.blueprint.stageType')}><Input value={st.stageType} disabled={!editable} onChange={(e) => setStages(stages.map((s, j) => (j === i ? { ...s, stageType: e.target.value } : s)))} /></Field>
                <Field label={t('pointStudio.blueprint.stageTitle')}><Input value={st.title} disabled={!editable} onChange={(e) => setStages(stages.map((s, j) => (j === i ? { ...s, title: e.target.value } : s)))} /></Field>
              </div>
              <div className="mt-2 space-y-1">
                {st.bindings.map((b, k) => (
                  <div key={k} className="text-xs text-text">· {(actsRes.data ?? []).find((a) => a.id === b.activityId)?.lessonContentKey ?? b.activityId} <span className="text-muted">[{b.role}]</span></div>
                ))}
                {editable && (
                  <div className="mt-1 flex gap-2">
                    <Select value="" onChange={(e) => { if (e.target.value) setStages(stages.map((s, j) => (j === i ? { ...s, bindings: [...s.bindings, { activityId: e.target.value, role: st.stageType === 'mastery' ? ('EVIDENCE' as const) : ('TEACH' as const) }] } : s))); }}>
                      <option value="">+ {t('pointStudio.blueprint.pickActivities')}</option>
                      {(actsRes.data ?? []).map((a) => (
                        <option key={a.id} value={a.id}>{a.lessonContentKey} · {a.type}</option>
                      ))}
                    </Select>
                    <Button size="sm" variant="ghost" onClick={() => setStages(stages.filter((_, j) => j !== i))}>×</Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {editable && <div className="mt-3"><Button loading={busy} onClick={save}>{t('pointStudio.blueprint.save')}</Button></div>}
    </Section>
  );
}

function MasterySection({ detail, editable, onReload }: { detail: PointDetail; editable: boolean; onReload: (d: PointDetail) => void }) {
  const t = useT();
  const { busy, error, run } = useSaver(onReload);
  const mrRev = detail.mastery?.revision;
  const gates = (mrRev?.gates as { thresholdBp?: number; minIndependence?: number } | undefined) ?? {};
  const [threshold, setThreshold] = useState(String(gates.thresholdBp ?? 8000));
  const [minInd, setMinInd] = useState(String(gates.minIndependence ?? 1));
  const [kinds, setKinds] = useState<Record<string, string>>({});
  useEffect(() => { setThreshold(String(gates.thresholdBp ?? 8000)); setMinInd(String(gates.minIndependence ?? 1)); }, [mrRev?.updatedAt]);
  if (!mrRev) return null;

  const requiredSkills = detail.skills.filter((s) => s.role === 'REQUIRED');
  const kindFor = (skillId: string) => kinds[skillId] ?? (mrRev.skillGates.find((g) => g.skillId === skillId)?.requiredEvidenceKinds.join(', ') ?? 'controlled-production, free-production');
  const save = () => run(() => api.setMastery(mrRev.id, {
    expectedUpdatedAt: mrRev.updatedAt,
    gates: { thresholdBp: Number(threshold) || 8000, minIndependence: Number(minInd) || 1, requireAllRequiredSkills: true },
    skillGates: requiredSkills.map((s) => ({ skillId: s.skillId, role: 'REQUIRED', requiredEvidenceKinds: kindFor(s.skillId).split(',').map((x) => x.trim()).filter(Boolean), minIndependence: Number(minInd) || 1 })),
  }));

  return (
    <Section title={t('pointStudio.sections.mastery')}>
      {error && <Err text={error} />}
      {requiredSkills.length === 0 ? <p className="text-sm text-muted">{t('pointStudio.mastery.empty')}</p> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('pointStudio.mastery.thresholdBp')}><Input type="number" value={threshold} disabled={!editable} onChange={(e) => setThreshold(e.target.value)} /></Field>
            <Field label={t('pointStudio.mastery.minIndependence')}><Input type="number" value={minInd} disabled={!editable} onChange={(e) => setMinInd(e.target.value)} /></Field>
          </div>
          {requiredSkills.map((s) => (
            <Field key={s.skillId} label={`${s.skillName} — ${t('pointStudio.mastery.evidenceKinds')}`}>
              <Input value={kindFor(s.skillId)} disabled={!editable} onChange={(e) => setKinds({ ...kinds, [s.skillId]: e.target.value })} />
            </Field>
          ))}
          {editable && <Button loading={busy} onClick={save}>{t('pointStudio.mastery.save')}</Button>}
        </div>
      )}
    </Section>
  );
}

function SourcesSection({ detail, editable, onReload }: { detail: PointDetail; editable: boolean; onReload: (d: PointDetail) => void }) {
  const t = useT();
  const { busy, error, run } = useSaver(onReload);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('reference-grammar');
  const [locator, setLocator] = useState('');
  const addAndAttach = async () => {
    const src = await api.createSource({ title, kind, locator: locator || undefined });
    await run(() => api.attachSource(detail.revision.id, { sourceReferenceId: src.id, claimRole: 'rule-basis' }));
    setTitle(''); setLocator('');
  };
  return (
    <Section title={t('pointStudio.sections.sources')}>
      {error && <Err text={error} />}
      {detail.sources.length === 0 ? <p className="text-sm text-muted">{t('pointStudio.sources.empty')}</p> : (
        <ul className="space-y-1">
          {detail.sources.map((s) => (
            <li key={s.id} className="rounded-control bg-surface-2 px-3 py-1.5 text-sm">{s.title} <span className="text-xs text-muted">· {s.kind}{s.locator ? ` · ${s.locator}` : ''}</span></li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Input placeholder={t('pointStudio.sources.title')} value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input placeholder={t('pointStudio.sources.kind')} value={kind} onChange={(e) => setKind(e.target.value)} />
          <Input placeholder={t('pointStudio.sources.locator')} value={locator} onChange={(e) => setLocator(e.target.value)} />
          <Button className="sm:col-span-3" loading={busy} disabled={!title} onClick={addAndAttach}>{t('pointStudio.sources.add')}</Button>
        </div>
      )}
    </Section>
  );
}

function IssuesSection({ detail, editable, onReload }: { detail: PointDetail; editable: boolean; onReload: (d: PointDetail) => void }) {
  const t = useT();
  const { busy, error, run } = useSaver(onReload);
  const [summary, setSummary] = useState('');
  const [severity, setSeverity] = useState('BLOCKER');
  const raise = async () => { await api.raiseIssue({ severityCode: severity, summary, roadmapPointRevisionId: detail.revision.id }); await run(() => api.getPoint(detail.point.id)); setSummary(''); };
  const resolve = async (id: string, status: 'RESOLVED' | 'DISMISSED') => { await api.resolveIssue(id, { status }); await run(() => api.getPoint(detail.point.id)); };

  return (
    <Section title={t('pointStudio.sections.issues')}>
      {error && <Err text={error} />}
      {detail.issues.length === 0 ? <p className="text-sm text-muted">{t('pointStudio.issues.empty')}</p> : (
        <ul className="space-y-1">
          {detail.issues.map((iss) => (
            <li key={iss.id} className="flex items-center justify-between rounded-control bg-surface-2 px-3 py-1.5 text-sm">
              <span><span className="font-semibold text-danger">{iss.severityCode}</span> · {iss.summary} <span className="text-xs text-muted">[{iss.status}]</span></span>
              {editable && iss.status === 'OPEN' && <button type="button" className="text-xs text-primary" disabled={busy} onClick={() => resolve(iss.id, 'RESOLVED')}>{t('pointStudio.issues.resolve')}</button>}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="mt-3 flex gap-2">
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-32"><option>BLOCKER</option><option>MAJOR</option><option>MINOR</option></Select>
          <Input placeholder={t('pointStudio.issues.summary')} value={summary} onChange={(e) => setSummary(e.target.value)} />
          <Button disabled={busy || !summary} onClick={raise}>{t('pointStudio.issues.raise')}</Button>
        </div>
      )}
    </Section>
  );
}

function WorkflowRail({ detail, caps, onReload }: { detail: PointDetail; caps: { author: boolean; publish: boolean }; onReload: (d: PointDetail) => void }) {
  const t = useT();
  const { busy, error, run } = useSaver(onReload);
  const rev = detail.revision;
  const [confirmPublish, setConfirmPublish] = useState(false);
  const readinessRes = useResource<PointReadinessReport>(useCallback(() => api.getPointReadiness(detail.point.id), [detail.point.id, rev.updatedAt]), [detail.point.id, rev.updatedAt]);
  const publishReady = readinessRes.data?.publishReady ?? false;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold uppercase tracking-wide text-muted">{detail.point.pointKey}</h2><StatusBadge status={rev.status} /></div>
      {error && <Err text={error} />}
      <div className="space-y-2">
        {rev.status === 'DRAFT' && caps.author && (
          <Button className="w-full" loading={busy} onClick={() => run(() => api.submitPointReview(rev.id, { expectedUpdatedAt: rev.updatedAt }))}>{t('pointStudio.workflow.submit')}</Button>
        )}
        {rev.status === 'REVIEW' && caps.publish && (
          <>
            <Button className="w-full" variant="secondary" loading={busy} onClick={() => run(() => api.reviewPoint(rev.id, { expectedUpdatedAt: rev.updatedAt, outcome: 'APPROVED' }))}>{t('pointStudio.workflow.approve')}</Button>
            <Button className="w-full" variant="ghost" loading={busy} onClick={() => run(() => api.reviewPoint(rev.id, { expectedUpdatedAt: rev.updatedAt, outcome: 'CHANGES_REQUESTED' }))}>{t('pointStudio.workflow.requestChanges')}</Button>
            <Button className="w-full" loading={busy} disabled={!publishReady} onClick={() => setConfirmPublish(true)}>{t('pointStudio.workflow.publish')}</Button>
          </>
        )}
        {rev.status === 'PUBLISHED' && !rev.editable && caps.author && (
          <Button className="w-full" variant="secondary" loading={busy} onClick={() => run(() => api.revisePoint(detail.point.id))}>{t('pointStudio.workflow.revise')}</Button>
        )}
      </div>
      {confirmPublish && (
        <ConfirmDialog open onClose={() => setConfirmPublish(false)} title={t('pointStudio.workflow.publish')} message={t('pointStudio.workflow.publishConfirm')} confirmLabel={t('pointStudio.workflow.publish')} onConfirm={() => { setConfirmPublish(false); run(() => api.publishPoint(rev.id, { expectedUpdatedAt: rev.updatedAt })); }} />
      )}
    </Card>
  );
}

function ReadinessPanel({ detail }: { detail: PointDetail }) {
  const t = useT();
  const res = useResource<PointReadinessReport>(useCallback(() => api.getPointReadiness(detail.point.id), [detail.point.id, detail.revision.updatedAt]), [detail.point.id, detail.revision.updatedAt]);
  const code = (c: string) => t(`pointStudio.codes.${c}`) || c;
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">{t('pointStudio.sections.readiness')}</h2>
      <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
        {(r) => (
          <div className="space-y-3 text-sm">
            <div className="flex gap-4">
              <span className={r.reviewReady ? 'text-success' : 'text-muted'}>● {t('pointStudio.ready.reviewReady')}</span>
              <span className={r.publishReady ? 'text-success' : 'text-muted'}>● {t('pointStudio.ready.publishReady')}</span>
            </div>
            {r.blockers.length > 0 && (
              <div>
                <div className="text-xs font-bold text-danger">{t('pointStudio.ready.blockers')}</div>
                <ul className="mt-1 space-y-0.5">{r.blockers.map((b, i) => <li key={i} className="text-danger">✕ {code(b.code)}</li>)}</ul>
              </div>
            )}
            {r.warnings.length > 0 && (
              <div>
                <div className="text-xs font-bold text-warning">{t('pointStudio.ready.warnings')}</div>
                <ul className="mt-1 space-y-0.5">{r.warnings.map((w, i) => <li key={i} className="text-warning">▲ {code(w.code)}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </ResourceView>
    </Card>
  );
}

function Err({ text }: { text: string }) {
  return <p role="alert" className="mb-2 rounded-control bg-danger-tint px-3 py-2 text-sm text-danger">{text}</p>;
}
