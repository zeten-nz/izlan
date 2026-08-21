import { Injectable } from '@nestjs/common';
import { ContainerStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Narrow read-only content catalog (§34). Faqat learner discovery — methodist CRUD YO'Q.
 * Har query lifecycle'ni EXPLICIT hurmat qiladi (§35): faqat PUBLISHED (DRAFT/ARCHIVED yashirin).
 */
@Injectable()
export class OnboardingContentRepository {
  constructor(private readonly prisma: PrismaService) {}

  listPublishedSubjects() {
    return this.prisma.subject.findMany({
      where: { status: ContainerStatus.PUBLISHED },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }], // deterministik (§36)
      select: { id: true, slug: true, title: true, description: true },
    });
  }

  findPublishedSubject(id: string) {
    return this.prisma.subject.findFirst({ where: { id, status: ContainerStatus.PUBLISHED }, select: { id: true } });
  }

  /** Track published + parent subject aniqlash (track↔subject consistency uchun, LI-03/05). */
  findPublishedTrack(id: string) {
    return this.prisma.track.findFirst({ where: { id, status: ContainerStatus.PUBLISHED }, select: { id: true, subjectId: true } });
  }

  listPublishedTracks(subjectId: string) {
    return this.prisma.track.findMany({
      where: { subjectId, status: ContainerStatus.PUBLISHED },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: { id: true, slug: true, title: true, description: true },
    });
  }
}
