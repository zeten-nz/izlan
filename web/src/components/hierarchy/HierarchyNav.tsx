'use client';

import { Fragment, useState } from 'react';
import { FiChevronRight, FiHome } from 'react-icons/fi';
import * as api from '@/lib/api/content';
import type { Level, Module, Subject, Topic, Track } from '@/lib/api/types';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useT } from '@/lib/i18n/i18n-context';
import { ContainerColumn } from './ContainerColumn';
import { LessonsColumn } from './LessonsColumn';
import type { FieldSpec, FormValues } from '@/components/forms/EntityFormDialog';

const s = (v?: string) => (v ?? '').trim();
const numReq = (v?: string) => Number((v ?? '0').trim() || '0') || 0;
const numOpt = (v?: string) => (v && v.trim() !== '' ? Number(v) : undefined);
const descOpt = (v?: string) => (s(v) ? s(v) : undefined);
const descOrNull = (v?: string) => (s(v) ? s(v) : null);

interface Sel {
  track?: Track;
  level?: Level;
  module?: Module;
  topic?: Topic;
}

export function HierarchyNav({ subject }: { subject: Subject }) {
  const caps = useCapabilities();
  const t = useT();
  const [sel, setSel] = useState<Sel>({});
  const canManage = caps.author;
  const canPublish = caps.publish;

  const crumbs: { label: string; onClick: () => void }[] = [{ label: subject.title, onClick: () => setSel({}) }];
  if (sel.track) crumbs.push({ label: sel.track.title, onClick: () => setSel({ track: sel.track }) });
  if (sel.level) crumbs.push({ label: sel.level.title, onClick: () => setSel({ track: sel.track, level: sel.level }) });
  if (sel.module) crumbs.push({ label: sel.module.title, onClick: () => setSel({ track: sel.track, level: sel.level, module: sel.module }) });
  if (sel.topic) crumbs.push({ label: sel.topic.title, onClick: () => setSel(sel) });

  const trackFields: FieldSpec[] = [
    { name: 'slug', label: t('subjects.slug'), type: 'text', required: true },
    { name: 'title', label: t('hierarchy.title'), type: 'text', required: true },
    { name: 'description', label: t('hierarchy.description'), type: 'textarea' },
    { name: 'sortOrder', label: t('common.order'), type: 'number' },
  ];
  const levelFields: FieldSpec[] = [
    { name: 'code', label: t('hierarchy.code'), type: 'text', required: true, hint: t('hierarchy.codeHint') },
    { name: 'title', label: t('hierarchy.title'), type: 'text', required: true },
    { name: 'sortOrder', label: t('common.order'), type: 'number', required: true },
  ];
  const titleDescOrder: FieldSpec[] = [
    { name: 'title', label: t('hierarchy.title'), type: 'text', required: true },
    { name: 'description', label: t('hierarchy.description'), type: 'textarea' },
    { name: 'sortOrder', label: t('common.order'), type: 'number', required: true },
  ];
  const orderMeta = (n: number) => t('hierarchy.metaOrder', { n });

  return (
    <div className="space-y-4">
      <nav aria-label={t('hierarchy.breadcrumbLabel')} className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <FiChevronRight className="text-muted" aria-hidden />}
            <button
              type="button"
              onClick={c.onClick}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-surface-2 ${i === crumbs.length - 1 ? 'font-semibold text-text' : 'text-muted'}`}
            >
              {i === 0 && <FiHome aria-hidden />}
              {c.label}
            </button>
          </Fragment>
        ))}
      </nav>

      {sel.topic ? (
        <LessonsColumn topicId={sel.topic.id} />
      ) : sel.module ? (
        <ContainerColumn<Topic>
          heading={t('hierarchy.topics')}
          reloadKey={`topic:${sel.module.id}`}
          loader={() => api.listTopics(sel.module!.id)}
          title={(e) => e.title}
          meta={(e) => orderMeta(e.sortOrder)}
          onSelect={(e) => setSel((p) => ({ ...p, topic: e }))}
          createLabel={t('hierarchy.addTopic')}
          createFields={titleDescOrder}
          onCreate={(v) => api.createTopic(sel.module!.id, { title: s(v.title), description: descOpt(v.description), sortOrder: numReq(v.sortOrder) }).then(() => {})}
          canManage={canManage}
          editFields={titleDescOrder}
          toInitial={(e) => ({ title: e.title, description: e.description ?? '', sortOrder: String(e.sortOrder) })}
          onEdit={(e, v) => api.updateTopic(e.id, { expectedUpdatedAt: e.updatedAt, title: s(v.title), description: descOrNull(v.description), sortOrder: numOpt(v.sortOrder) }).then(() => {})}
          canPublish={canPublish}
          onPublish={(e) => api.publishTopic(e.id, { expectedUpdatedAt: e.updatedAt }).then(() => {})}
        />
      ) : sel.level ? (
        <ContainerColumn<Module>
          heading={t('hierarchy.modules')}
          reloadKey={`module:${sel.level.id}`}
          loader={() => api.listModules(sel.level!.id)}
          title={(e) => e.title}
          meta={(e) => orderMeta(e.sortOrder)}
          onSelect={(e) => setSel((p) => ({ ...p, module: e, topic: undefined }))}
          createLabel={t('hierarchy.addModule')}
          createFields={titleDescOrder}
          onCreate={(v) => api.createModule(sel.level!.id, { title: s(v.title), description: descOpt(v.description), sortOrder: numReq(v.sortOrder) }).then(() => {})}
          canManage={canManage}
          editFields={titleDescOrder}
          toInitial={(e) => ({ title: e.title, description: e.description ?? '', sortOrder: String(e.sortOrder) })}
          onEdit={(e, v) => api.updateModule(e.id, { expectedUpdatedAt: e.updatedAt, title: s(v.title), description: descOrNull(v.description), sortOrder: numOpt(v.sortOrder) }).then(() => {})}
          canPublish={canPublish}
          onPublish={(e) => api.publishModule(e.id, { expectedUpdatedAt: e.updatedAt }).then(() => {})}
        />
      ) : sel.track ? (
        <ContainerColumn<Level>
          heading={t('hierarchy.levels')}
          reloadKey={`level:${sel.track.id}`}
          loader={() => api.listLevels(sel.track!.id)}
          title={(e) => e.title}
          meta={(e) => t('hierarchy.metaCode', { code: e.code })}
          onSelect={(e) => setSel((p) => ({ ...p, level: e, module: undefined, topic: undefined }))}
          createLabel={t('hierarchy.addLevel')}
          createFields={levelFields}
          onCreate={(v) => api.createLevel(sel.track!.id, { code: s(v.code), title: s(v.title), sortOrder: numReq(v.sortOrder) }).then(() => {})}
          canManage={canManage}
          editFields={levelFields}
          toInitial={(e) => ({ code: e.code, title: e.title, sortOrder: String(e.sortOrder) })}
          onEdit={(e, v) => api.updateLevel(e.id, { expectedUpdatedAt: e.updatedAt, code: s(v.code), title: s(v.title), sortOrder: numOpt(v.sortOrder) }).then(() => {})}
          canPublish={canPublish}
          onPublish={(e) => api.publishLevel(e.id, { expectedUpdatedAt: e.updatedAt }).then(() => {})}
        />
      ) : (
        <ContainerColumn<Track>
          heading={t('hierarchy.tracks')}
          reloadKey={`track:${subject.id}`}
          loader={() => api.listTracks(subject.id)}
          title={(e) => e.title}
          meta={(e) => `/${e.slug}`}
          onSelect={(e) => setSel({ track: e })}
          createLabel={t('hierarchy.addTrack')}
          createFields={trackFields}
          onCreate={(v) => api.createTrack(subject.id, { slug: s(v.slug), title: s(v.title), description: descOpt(v.description), sortOrder: numOpt(v.sortOrder) }).then(() => {})}
          canManage={canManage}
          editFields={trackFields}
          toInitial={(e) => ({ slug: e.slug, title: e.title, description: e.description ?? '', sortOrder: String(e.sortOrder) })}
          onEdit={(e, v) => api.updateTrack(e.id, { expectedUpdatedAt: e.updatedAt, slug: s(v.slug), title: s(v.title), description: descOrNull(v.description), sortOrder: numOpt(v.sortOrder) }).then(() => {})}
          canPublish={canPublish}
          onPublish={(e) => api.publishTrack(e.id, { expectedUpdatedAt: e.updatedAt }).then(() => {})}
        />
      )}
    </div>
  );
}
