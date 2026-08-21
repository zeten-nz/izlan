import * as api from './content';
import type { Lesson } from './types';

/**
 * Resolve a lesson's owning Subject id by walking UP the hierarchy (Topic → Module → Level → Track → subjectId).
 * Used to scope Skill/prerequisite candidate lists to the same Subject (the backend is the final authority).
 */
export async function resolveLessonSubjectId(lesson: Lesson): Promise<string> {
  const topic = await api.getTopic(lesson.topicId);
  const mod = await api.getModule(topic.moduleId);
  const level = await api.getLevel(mod.levelId);
  const track = await api.getTrack(level.trackId);
  return track.subjectId;
}

/**
 * Collect every Lesson in a Subject by walking DOWN the hierarchy (existing reads only — no new search endpoint).
 * Used to build same-Subject prerequisite candidate lists.
 */
export async function collectSubjectLessons(subjectId: string): Promise<Lesson[]> {
  const tracks = await api.listTracks(subjectId);
  const levelLists = await Promise.all(tracks.map((t) => api.listLevels(t.id)));
  const levels = levelLists.flat();
  const moduleLists = await Promise.all(levels.map((l) => api.listModules(l.id)));
  const modules = moduleLists.flat();
  const topicLists = await Promise.all(modules.map((m) => api.listTopics(m.id)));
  const topics = topicLists.flat();
  const lessonLists = await Promise.all(topics.map((tp) => api.listLessons(tp.id)));
  return lessonLists.flat();
}
