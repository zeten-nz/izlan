'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FiAlertTriangle, FiCheckCircle, FiCircle, FiGift, FiRefreshCw, FiTrendingUp } from 'react-icons/fi';
import { useT, type TFunc } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { isAbortError } from '@/lib/api/errors';
import { fetchLearningIntents } from '@/lib/api/onboarding';
import { getCurrentSkillProfile } from '@/lib/api/skill-profile';
import { fetchV2Roadmap, type V2RoadmapPoint } from '@/lib/api/v2-learning';
import { getXpProgression } from '@/lib/api/xp';
import { getIzlBalance } from '@/lib/api/izl';
import { fetchTodayMissions } from '@/lib/api/rewards';
import type {
  DailyMissionStatus,
  IzlBalance,
  LearningIntent,
  SkillProfileView,
  SkillState,
  XpProgression,
} from '@/lib/api/types';
import { ButtonLink, Card, LinearProgress, MasteryProgress, Select, Spinner } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';

/** A learner-authoritative acquisition summary derived from the V2 roadmap (never recomputed/fabricated). */
interface RoadmapSummary {
  acquired: number; // LEARNED or VALIDATED points
  total: number;
  attention: AttentionEntry[]; // acquired points currently needing repair/review
}
interface AttentionEntry {
  pointId: string;
  title: string;
  kind: 'REPAIR' | 'REVIEW';
  reason: V2RoadmapPoint['attentionReason'];
  skillName: string | null;
}

interface ProgressData {
  intents: LearningIntent[];
  selected: LearningIntent | null;
  skills: SkillProfileView | null; // subject-scoped; null when there is no subject to scope to
  roadmap: RoadmapSummary | null; // null when the subject has no generated roadmap yet
  xp: XpProgression; // global — always a 200 (zeros for a fresh learner)
  izl: IzlBalance; // global — always a 200 ({0,0,0} for a fresh learner)
  missions: DailyMissionStatus[]; // global — the fixed catalog, completed flags per today
}

/** Project the V2 roadmap into an honest acquisition summary: acquired counts LEARNED/VALIDATED; attention is derived. */
function summarize(points: V2RoadmapPoint[]): RoadmapSummary {
  const acquired = points.filter((p) => p.learned || p.validated).length;
  const attention: AttentionEntry[] = points
    .filter((p) => (p.learned || p.validated) && p.attention !== 'NONE')
    .map((p) => ({ pointId: p.roadmapPointId, title: p.title, kind: p.attention === 'REPAIR_REQUIRED' ? 'REPAIR' : 'REVIEW', reason: p.attentionReason, skillName: p.attentionSkill?.name ?? null }));
  return { acquired, total: points.length, attention };
}

async function loadProgress(subjectId: string | null): Promise<ProgressData> {
  // Global (not subject-scoped) reads + the intent list, in parallel. XP/IZL/missions are 200 even for a fresh learner
  // (zeros / pending), so they are calm zero states, never errors.
  const [intents, xp, izl, missions] = await Promise.all([
    fetchLearningIntents(),
    getXpProgression(),
    getIzlBalance(),
    fetchTodayMissions(),
  ]);

  // Subject context is UI-only (Phase 03 pattern): prefer a placed subject (has a track); the selector switches it.
  const withTrack = intents.filter((i) => i.track);
  const pool = withTrack.length ? withTrack : intents;
  const selected = pool.find((i) => i.subject.id === subjectId) ?? pool[0] ?? null;

  let skills: SkillProfileView | null = null;
  let roadmap: RoadmapSummary | null = null;
  if (selected) {
    const [profile, v2] = await Promise.all([
      getCurrentSkillProfile(selected.subject.id, selected.subject.title), // 404 → empty skills (calm, not an error)
      selected.track ? fetchV2Roadmap(selected.subject.id).catch(() => null) : Promise.resolve(null),
    ]);
    skills = profile;
    roadmap = v2 && v2.points.length > 0 ? summarize(v2.points) : null; // no generated roadmap yet → calm no-progress
  }

  return { intents: pool, selected, skills, roadmap, xp, izl, missions: missions.missions };
}

export default function ProgressPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[50vh] place-items-center"><Spinner /></div>}>
      <ProgressInner />
    </Suspense>
  );
}

function ProgressInner() {
  const t = useT();
  const params = useSearchParams();
  const [subjectId, setSubjectId] = useState<string | null>(params.get('subject'));
  const res = useResource(useCallback(() => loadProgress(subjectId), [subjectId]), [subjectId]);

  // A cancelled/superseded read is NOT a failure (§26/§33): keep it in the calm loading state instead of surfacing an
  // error banner — the taxonomy already maps an AbortError to no message.
  const aborted = res.error !== null && isAbortError(res.error);

  return (
    <ResourceView loading={res.loading || aborted} error={aborted ? null : res.error} data={res.data} onRetry={res.reload}>
      {(d) => (
        <div className="space-y-8">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t('learner.progress.title')}</h1>
              <p className="mt-0.5 text-muted">{t('learner.progress.subtitle')}</p>
            </div>
            {d.intents.length > 1 && d.selected && (
              <label className="flex items-center gap-2 text-sm text-muted">
                <span>{t('learner.progress.subjectLabel')}</span>
                <Select
                  aria-label={t('learner.progress.subjectLabel')}
                  value={d.selected.subject.id}
                  onChange={(e) => setSubjectId(e.target.value)}
                  className="h-9 w-auto"
                >
                  {d.intents.map((i) => (
                    <option key={i.subject.id} value={i.subject.id}>{i.subject.title}</option>
                  ))}
                </Select>
              </label>
            )}
          </header>

          <OverallProgress roadmap={d.roadmap} hasSubject={d.selected !== null} />
          {d.roadmap && d.roadmap.attention.length > 0 && <AttentionSection attention={d.roadmap.attention} />}
          <Skills profile={d.skills} hasSubject={d.selected !== null} />

          {/* XP and IZL are DISTINCT systems (§19): separate cards, labels and descriptions — never one combined score. */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('learner.progress.rewardsTitle')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <XpCard xp={d.xp} />
              <IzlCard izl={d.izl} />
            </div>
          </section>

          <Missions missions={d.missions} />
        </div>
      )}
    </ResourceView>
  );
}

/** "How far have I come?" — real V2 roadmap acquisition (LEARNED/VALIDATED points), never recomputed/fabricated. */
function OverallProgress({ roadmap, hasSubject }: { roadmap: RoadmapSummary | null; hasSubject: boolean }) {
  const t = useT();
  const bp = roadmap && roadmap.total > 0 ? Math.round((roadmap.acquired / roadmap.total) * 10000) : 0;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('learner.progress.overallTitle')}</h2>
      <Card className="p-6">
        {!hasSubject ? (
          <EmptyBlock title={t('learner.progress.noSubjectTitle')} body={t('learner.progress.noSubjectBody')} />
        ) : !roadmap ? (
          <EmptyBlock title={t('learner.progress.noProgressTitle')} body={t('learner.progress.noProgressBody')} />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted">{t('learner.progress.overallProgress', { completed: roadmap.acquired, total: roadmap.total })}</span>
            </div>
            <LinearProgress value={bp} max={10000} label={t('learner.progress.overallTitle')} showValue />
          </div>
        )}
      </Card>
    </section>
  );
}

/** Areas needing attention — acquired points that now need repair/review. Honest (only real signals), routes to the roadmap. */
function AttentionSection({ attention }: { attention: AttentionEntry[] }) {
  const t = useT();
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('learner.progress.attentionTitle')}</h2>
      <Card className="p-4">
        <ul className="flex flex-col divide-y divide-border">
          {attention.map((a) => {
            const isRepair = a.kind === 'REPAIR';
            const Icon = isRepair ? FiAlertTriangle : FiRefreshCw;
            const cls = isRepair ? 'text-warning' : 'text-primary';
            return (
              <li key={a.pointId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><Icon aria-hidden className={cls} size={15} /><span className={`text-xs font-semibold ${cls}`}>{isRepair ? t('learner.v2.attention.repairBadge') : t('learner.v2.attention.reviewBadge')}</span></div>
                  <span className="mt-0.5 block min-w-0 font-medium text-text">{a.title}</span>
                  {a.reason && a.skillName && <span className="text-xs text-muted">{attentionReasonCopy(t, a.reason, a.skillName)}</span>}
                </div>
                <ButtonLink href="/learn/roadmap" variant="secondary" size="sm" className="shrink-0">{isRepair ? t('learner.v2.attention.repairCta') : t('learner.v2.attention.reviewCta')}</ButtonLink>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

function attentionReasonCopy(t: TFunc, reason: V2RoadmapPoint['attentionReason'], skillName: string): string {
  const key =
    reason === 'REPEATED_MISTAKE'
      ? 'learner.v2.attention.reasonRepeatedMistake'
      : reason === 'PERSISTENT_WEAKNESS'
        ? 'learner.v2.attention.reasonWeakness'
        : 'learner.v2.attention.reasonRetention';
  return t(key, { skill: skillName });
}

/** "Qaysi ko'nikmalarim kuchli / ustida ishlashim kerak?" — mastery + confidence (distinct) + evidence, backend-derived. */
function Skills({ profile, hasSubject }: { profile: SkillProfileView | null; hasSubject: boolean }) {
  const t = useT();
  const skills = profile?.skills ?? [];
  // Sort a copy strongest → weakest for the highlight; never mutate the source order.
  const sorted = useMemo(() => [...skills].sort((a, b) => b.masteryScoreBp - a.masteryScoreBp), [skills]);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('learner.progress.skillsTitle')}</h2>
      {!hasSubject ? (
        <Card className="p-6"><EmptyBlock title={t('learner.progress.noSubjectTitle')} body={t('learner.progress.noSubjectBody')} /></Card>
      ) : skills.length === 0 ? (
        <Card className="p-6"><EmptyBlock title={t('learner.progress.noSkillsTitle')} body={t('learner.progress.noSkillsBody')} /></Card>
      ) : (
        <div className="space-y-4">
          {strongest && weakest && strongest.skillId !== weakest.skillId && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 rounded-panel bg-success-tint p-4">
                <span className="text-xs font-bold uppercase tracking-wide text-success">{t('learner.progress.strength')}</span>
                <span className="text-[14.5px] font-semibold text-text">{strongest.name}</span>
              </div>
              <div className="flex flex-col gap-1 rounded-panel bg-surface-2 p-4">
                <span className="text-xs font-bold uppercase tracking-wide text-muted">{t('learner.progress.focus')}</span>
                <span className="text-[14.5px] font-semibold text-text">{weakest.name}</span>
              </div>
            </div>
          )}
          <Card className="p-6">
            <ul className="flex flex-col gap-5">
              {sorted.map((s) => <SkillRow key={s.skillId} skill={s} />)}
            </ul>
          </Card>
        </div>
      )}
    </section>
  );
}

function SkillRow({ skill }: { skill: SkillState }) {
  const t = useT();
  return (
    <li className="flex flex-col gap-1.5">
      {/* Mastery = how well the skill is currently demonstrated. displayLevel is null in v1, so NEVER a fabricated level. */}
      <MasteryProgress value={skill.masteryScoreBp / 100} label={skill.name} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted">
        {/* Confidence is a DISTINCT measure (evidence supporting the estimate), never relabelled as mastery. */}
        {skill.confidenceBp !== null && (
          <span>{t('learner.progress.confidence')}: {Math.round(skill.confidenceBp / 100)}%</span>
        )}
        {skill.evidenceCount > 0 && <span>{t('learner.progress.evidence', { n: skill.evidenceCount })}</span>}
      </div>
    </li>
  );
}

/** XP — a learning-progress score. Levels + next-level thresholds are REAL backend values (not fabricated). */
function XpCard({ xp }: { xp: XpProgression }) {
  const t = useT();
  const total = Math.max(0, xp.totalXp);
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-border bg-primary-tint/40 p-5">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <FiTrendingUp aria-hidden />
        </span>
        <div className="flex flex-col">
          <span className="text-xs font-bold uppercase tracking-wide text-primary">{t('learner.progress.xpTitle')}</span>
          <span className="text-xs text-muted">{t('learner.progress.xpDescription')}</span>
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-extrabold tracking-tight text-text">{total.toLocaleString('en-US')}</span>
        <span className="text-sm font-semibold text-muted">XP</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {/* The bar's visible label carries the (real backend) level; the caption shows the remaining XP to the next level. */}
        <LinearProgress value={xp.progressBp} max={10000} label={t('learner.progress.xpLevel', { level: xp.currentLevel })} />
        <span className="text-xs text-muted">{t('learner.progress.xpToNext', { n: xp.xpToNextLevel.toLocaleString('en-US') })}</span>
      </div>
    </div>
  );
}

/** IZL — the platform reward currency wallet. Read-only. Reserved funds are shown as held, never as spendable. */
function IzlCard({ izl }: { izl: IzlBalance }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-border bg-surface-2 p-5">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-text">
          <FiGift aria-hidden />
        </span>
        <div className="flex flex-col">
          <span className="text-xs font-bold uppercase tracking-wide text-text">{t('learner.progress.izlTitle')}</span>
          <span className="text-xs text-muted">{t('learner.progress.izlDescription')}</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted">{t('learner.progress.izlAvailable')}</span>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-extrabold tracking-tight text-text">{izl.availableIzl.toLocaleString('en-US')}</span>
          <span className="text-sm font-semibold text-muted">IZL</span>
        </div>
      </div>
      {/* Only surface total/reserved when a hold actually exists, so a plain wallet stays uncluttered. */}
      {izl.reservedIzl > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
          <span>{t('learner.progress.izlTotal')}: {izl.balanceIzl.toLocaleString('en-US')}</span>
          <span>{t('learner.progress.izlReserved')}: {izl.reservedIzl.toLocaleString('en-US')}</span>
        </div>
      )}
    </div>
  );
}

// Human-readable labels for the two fixed mission codes (the read model carries no title). Unknown codes fall back to a
// generic label — the internal code is never rendered.
const MISSION_LABEL_KEY: Record<string, string> = {
  LEARN_TODAY: 'learner.progress.missionLearnToday',
  MASTERY_TEST_90: 'learner.progress.missionMasteryTest90',
};

/** Today's missions — read-only status (no "Claim": rewards are granted automatically by the backend). */
function Missions({ missions }: { missions: DailyMissionStatus[] }) {
  const t = useT();
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('learner.progress.missionsTitle')}</h2>
      <Card className="p-4">
        {missions.length === 0 ? (
          <EmptyBlock title={t('learner.progress.missionsEmpty')} />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {missions.map((m) => {
              const labelKey = MISSION_LABEL_KEY[m.code];
              const label = labelKey ? t(labelKey) : t('learner.progress.missionGeneric');
              const Icon = m.completed ? FiCheckCircle : FiCircle;
              return (
                <li key={m.code} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="min-w-0 font-medium text-text">{label}</span>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold ${m.completed ? 'text-success' : 'text-muted'}`}>
                    <Icon aria-hidden size={15} />
                    {m.completed ? t('learner.progress.missionDone') : t('learner.progress.missionPending')}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}

function EmptyBlock({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col gap-1 text-center sm:text-left">
      <p className="font-medium text-text">{title}</p>
      {body && <p className="text-sm text-muted">{body}</p>}
    </div>
  );
}
