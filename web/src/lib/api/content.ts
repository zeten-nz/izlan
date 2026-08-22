import { apiRequest } from './client';
import type {
  Activity,
  ActivityDeleteResult,
  ActivityMutationResult,
  ActivityType,
  ArchiveView,
  Assignment,
  AssignmentRemoveResult,
  HierarchyPublishResult,
  Lesson,
  LessonTokenResult,
  Level,
  MappedSkill,
  Module,
  PrerequisiteLesson,
  PreviewResponse,
  PublicationView,
  ReadinessReport,
  ReorderResult,
  Revision,
  RevisionTokenResult,
  Skill,
  Subject,
  Topic,
  Track,
} from './types';

const B = '/api/staff/content';

// ── CMS session (capabilities) ──
export { fetchCmsSession } from './auth';

// ── Subjects + assignments ──
export const listSubjects = () => apiRequest<Subject[]>(`${B}/subjects`);
export const getSubject = (id: string) => apiRequest<Subject>(`${B}/subjects/${id}`);
export const createSubject = (body: { slug: string; title: string; description?: string; sortOrder?: number }) =>
  apiRequest<Subject>(`${B}/subjects`, { method: 'POST', body });
export const updateSubject = (
  id: string,
  body: { expectedUpdatedAt: string; slug?: string; title?: string; description?: string | null; sortOrder?: number },
) => apiRequest<Subject>(`${B}/subjects/${id}`, { method: 'PATCH', body });
export const listAssignments = (subjectId: string) => apiRequest<Assignment[]>(`${B}/subjects/${subjectId}/assignments`);
export const assignUser = (subjectId: string, userId: string) =>
  apiRequest<Assignment>(`${B}/subjects/${subjectId}/assignments`, { method: 'POST', body: { userId } });
export const removeAssignment = (subjectId: string, userId: string) =>
  apiRequest<AssignmentRemoveResult>(`${B}/subjects/${subjectId}/assignments/${userId}`, { method: 'DELETE' });

// ── Tracks ──
export const listTracks = (subjectId: string) => apiRequest<Track[]>(`${B}/subjects/${subjectId}/tracks`);
export const getTrack = (id: string) => apiRequest<Track>(`${B}/tracks/${id}`);
export const createTrack = (subjectId: string, body: { slug: string; title: string; description?: string; sortOrder?: number }) =>
  apiRequest<Track>(`${B}/subjects/${subjectId}/tracks`, { method: 'POST', body });
export const updateTrack = (
  id: string,
  body: { expectedUpdatedAt: string; slug?: string; title?: string; description?: string | null; sortOrder?: number },
) => apiRequest<Track>(`${B}/tracks/${id}`, { method: 'PATCH', body });

// ── Levels ──
export const listLevels = (trackId: string) => apiRequest<Level[]>(`${B}/tracks/${trackId}/levels`);
export const getLevel = (id: string) => apiRequest<Level>(`${B}/levels/${id}`);
export const createLevel = (trackId: string, body: { code: string; title: string; sortOrder: number }) =>
  apiRequest<Level>(`${B}/tracks/${trackId}/levels`, { method: 'POST', body });
export const updateLevel = (id: string, body: { expectedUpdatedAt: string; code?: string; title?: string; sortOrder?: number }) =>
  apiRequest<Level>(`${B}/levels/${id}`, { method: 'PATCH', body });

// ── Modules ──
export const listModules = (levelId: string) => apiRequest<Module[]>(`${B}/levels/${levelId}/modules`);
export const getModule = (id: string) => apiRequest<Module>(`${B}/modules/${id}`);
export const createModule = (levelId: string, body: { title: string; description?: string; sortOrder: number }) =>
  apiRequest<Module>(`${B}/levels/${levelId}/modules`, { method: 'POST', body });
export const updateModule = (
  id: string,
  body: { expectedUpdatedAt: string; title?: string; description?: string | null; sortOrder?: number },
) => apiRequest<Module>(`${B}/modules/${id}`, { method: 'PATCH', body });

// ── Topics ──
export const listTopics = (moduleId: string) => apiRequest<Topic[]>(`${B}/modules/${moduleId}/topics`);
export const getTopic = (id: string) => apiRequest<Topic>(`${B}/topics/${id}`);
export const createTopic = (moduleId: string, body: { title: string; description?: string; sortOrder: number }) =>
  apiRequest<Topic>(`${B}/modules/${moduleId}/topics`, { method: 'POST', body });
export const updateTopic = (
  id: string,
  body: { expectedUpdatedAt: string; title?: string; description?: string | null; sortOrder?: number },
) => apiRequest<Topic>(`${B}/topics/${id}`, { method: 'PATCH', body });

// ── Lessons ──
export const listLessons = (topicId: string) => apiRequest<Lesson[]>(`${B}/topics/${topicId}/lessons`);
export const getLesson = (id: string) => apiRequest<Lesson>(`${B}/lessons/${id}`);
export const createLesson = (topicId: string, body: { contentKey: string; sortOrder: number; slug?: string }) =>
  apiRequest<Lesson>(`${B}/topics/${topicId}/lessons`, { method: 'POST', body });
export const updateLesson = (id: string, body: { expectedUpdatedAt: string; slug?: string | null; sortOrder?: number }) =>
  apiRequest<Lesson>(`${B}/lessons/${id}`, { method: 'PATCH', body });
export const moveLesson = (id: string, body: { expectedUpdatedAt: string; toTopicId: string }) =>
  apiRequest<Lesson>(`${B}/lessons/${id}/move`, { method: 'POST', body });

// ── Revisions ──
export const listRevisions = (lessonId: string) => apiRequest<Revision[]>(`${B}/lessons/${lessonId}/revisions`);
export const getRevision = (id: string) => apiRequest<Revision>(`${B}/revisions/${id}`);
export const createRevision = (lessonId: string, body: { title: string; description?: string }) =>
  apiRequest<Revision>(`${B}/lessons/${lessonId}/revisions`, { method: 'POST', body });
export const updateRevision = (id: string, body: { expectedUpdatedAt: string; title?: string; description?: string | null }) =>
  apiRequest<Revision>(`${B}/revisions/${id}`, { method: 'PATCH', body });

// ── Activities (owning DRAFT revision is the concurrency aggregate) ──
export const listActivities = (revisionId: string) => apiRequest<Activity[]>(`${B}/revisions/${revisionId}/activities`);
export const getActivity = (id: string) => apiRequest<Activity>(`${B}/activities/${id}`);
export const createActivity = (
  revisionId: string,
  body: { expectedRevisionUpdatedAt: string; type: ActivityType; position: number; payload: unknown; estimatedDurationMin?: number },
) => apiRequest<ActivityMutationResult>(`${B}/revisions/${revisionId}/activities`, { method: 'POST', body });
export const updateActivity = (
  id: string,
  body: { expectedRevisionUpdatedAt: string; payload?: unknown; estimatedDurationMin?: number },
) => apiRequest<ActivityMutationResult>(`${B}/activities/${id}`, { method: 'PATCH', body });
export const deleteActivity = (id: string, body: { expectedRevisionUpdatedAt: string }) =>
  apiRequest<ActivityDeleteResult>(`${B}/activities/${id}`, { method: 'DELETE', body });
export const reorderActivities = (revisionId: string, body: { expectedRevisionUpdatedAt: string; orderedActivityIds: string[] }) =>
  apiRequest<ReorderResult>(`${B}/revisions/${revisionId}/activities/order`, { method: 'PUT', body });

// ── Skills ──
export const listSkills = (subjectId: string) => apiRequest<Skill[]>(`${B}/subjects/${subjectId}/skills`);
export const getSkill = (id: string) => apiRequest<Skill>(`${B}/skills/${id}`);
export const createSkill = (subjectId: string, body: { name: string; code?: string; description?: string; sortOrder?: number }) =>
  apiRequest<Skill>(`${B}/subjects/${subjectId}/skills`, { method: 'POST', body });
export const updateSkill = (
  id: string,
  body: { expectedUpdatedAt: string; name?: string; code?: string | null; description?: string | null; sortOrder?: number },
) => apiRequest<Skill>(`${B}/skills/${id}`, { method: 'PATCH', body });

// ── Skill mappings ──
export const listLessonSkills = (lessonId: string) => apiRequest<MappedSkill[]>(`${B}/lessons/${lessonId}/skills`);
export const addLessonSkill = (lessonId: string, body: { expectedLessonUpdatedAt: string; skillId: string }) =>
  apiRequest<LessonTokenResult>(`${B}/lessons/${lessonId}/skills`, { method: 'POST', body });
export const removeLessonSkill = (lessonId: string, skillId: string, body: { expectedLessonUpdatedAt: string }) =>
  apiRequest<LessonTokenResult>(`${B}/lessons/${lessonId}/skills/${skillId}`, { method: 'DELETE', body });
export const listActivitySkills = (activityId: string) => apiRequest<MappedSkill[]>(`${B}/activities/${activityId}/skills`);
export const addActivitySkill = (activityId: string, body: { expectedRevisionUpdatedAt: string; skillId: string }) =>
  apiRequest<RevisionTokenResult>(`${B}/activities/${activityId}/skills`, { method: 'POST', body });
export const removeActivitySkill = (activityId: string, skillId: string, body: { expectedRevisionUpdatedAt: string }) =>
  apiRequest<RevisionTokenResult>(`${B}/activities/${activityId}/skills/${skillId}`, { method: 'DELETE', body });

// ── Prerequisites (source Lesson.updatedAt is the OCC token) ──
export const listPrerequisites = (lessonId: string) => apiRequest<PrerequisiteLesson[]>(`${B}/lessons/${lessonId}/prerequisites`);
export const addPrerequisite = (lessonId: string, body: { expectedLessonUpdatedAt: string; prerequisiteLessonId: string }) =>
  apiRequest<LessonTokenResult>(`${B}/lessons/${lessonId}/prerequisites`, { method: 'POST', body });
export const removePrerequisite = (lessonId: string, prerequisiteLessonId: string, body: { expectedLessonUpdatedAt: string }) =>
  apiRequest<LessonTokenResult>(`${B}/lessons/${lessonId}/prerequisites/${prerequisiteLessonId}`, { method: 'DELETE', body });

// ── Hierarchy publication (content.publish + scope) ──
type PublishBody = { expectedUpdatedAt: string };
export const publishSubject = (id: string, body: PublishBody) => apiRequest<HierarchyPublishResult>(`${B}/subjects/${id}/publish`, { method: 'POST', body });
export const publishTrack = (id: string, body: PublishBody) => apiRequest<HierarchyPublishResult>(`${B}/tracks/${id}/publish`, { method: 'POST', body });
export const publishLevel = (id: string, body: PublishBody) => apiRequest<HierarchyPublishResult>(`${B}/levels/${id}/publish`, { method: 'POST', body });
export const publishModule = (id: string, body: PublishBody) => apiRequest<HierarchyPublishResult>(`${B}/modules/${id}/publish`, { method: 'POST', body });
export const publishTopic = (id: string, body: PublishBody) => apiRequest<HierarchyPublishResult>(`${B}/topics/${id}/publish`, { method: 'POST', body });

// ── Review + publication workflow ──
export const getReadiness = (revisionId: string) => apiRequest<ReadinessReport>(`${B}/revisions/${revisionId}/readiness`);
export const getPreview = (revisionId: string) => apiRequest<PreviewResponse>(`${B}/revisions/${revisionId}/preview`);
export const submitReview = (revisionId: string, body: { expectedUpdatedAt: string }) =>
  apiRequest<Revision>(`${B}/revisions/${revisionId}/submit-review`, { method: 'POST', body });
export const returnToDraft = (revisionId: string, body: { expectedUpdatedAt: string; reason: string }) =>
  apiRequest<Revision>(`${B}/revisions/${revisionId}/return-to-draft`, { method: 'POST', body });
export const publishRevision = (revisionId: string, body: { expectedRevisionUpdatedAt: string; expectedLessonUpdatedAt: string }) =>
  apiRequest<PublicationView>(`${B}/revisions/${revisionId}/publish`, { method: 'POST', body });
export const archiveLesson = (lessonId: string, body: { expectedLessonUpdatedAt: string; reason: string }) =>
  apiRequest<ArchiveView>(`${B}/lessons/${lessonId}/archive`, { method: 'POST', body });
