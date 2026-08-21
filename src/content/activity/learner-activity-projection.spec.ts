import { ActivityType } from '@prisma/client';
import { projectActivityForLearnerRuntime } from './learner-activity-projection';
import { LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION } from '../../lesson-execution/activity/objective-activity-payload';
import { LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION } from './markdown-activity-payload';
import { LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION } from './media-activity-payload';

const SECRET = 'a';
const objective = { schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: [SECRET] } };

describe('projectActivityForLearnerRuntime (shared learner-safe projector, §32)', () => {
  it('PV-03 objective → learner-safe question, answerKey/correctOptionIds STRIPPED', () => {
    const v = projectActivityForLearnerRuntime({ id: 'a1', type: ActivityType.MINI_QUESTION, position: 0, payload: objective });
    expect(v).toMatchObject({ id: 'a1', type: 'MINI_QUESTION', position: 0, format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] });
    const json = JSON.stringify(v);
    expect(json).not.toContain('answerKey');
    expect(json).not.toContain('correctOptionIds');
  });

  it('PV-05/07 markdown types → validated { schemaVersion, markdown } body', () => {
    for (const t of [ActivityType.TEXT, ActivityType.EXPLANATION, ActivityType.EXAMPLE]) {
      const v = projectActivityForLearnerRuntime({ id: 'm', type: t, position: 1, payload: { schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown: '# Hi' } });
      expect(v).toMatchObject({ id: 'm', type: t, position: 1, schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown: '# Hi' });
    }
  });

  it('PV-08 IMAGE/AUDIO → metadata only (no markdown/body/storageKey)', () => {
    for (const t of [ActivityType.IMAGE, ActivityType.AUDIO]) {
      const v = projectActivityForLearnerRuntime({ id: 'md', type: t, position: 2, payload: { schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION } });
      expect(v).toEqual({ id: 'md', type: t, position: 2 });
    }
  });

  it('PV-09 a payload carrying storageKey never surfaces in projection', () => {
    const v = projectActivityForLearnerRuntime({ id: 'x', type: ActivityType.IMAGE, position: 0, payload: { schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION, storageKey: 'secret-key' } as unknown });
    expect(JSON.stringify(v)).not.toContain('secret-key');
  });

  it('malformed objective/markdown payload → safe metadata-only fallback (no leak)', () => {
    expect(projectActivityForLearnerRuntime({ id: 'a', type: ActivityType.MINI_QUESTION, position: 0, payload: { schemaVersion: 'x' } })).toEqual({ id: 'a', type: 'MINI_QUESTION', position: 0 });
    expect(projectActivityForLearnerRuntime({ id: 'b', type: ActivityType.TEXT, position: 0, payload: { schemaVersion: 'x' } })).toEqual({ id: 'b', type: 'TEXT', position: 0 });
  });
});
