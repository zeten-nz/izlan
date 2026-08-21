import { Injectable } from '@nestjs/common';
import { AssessmentPurposeScope, ContainerStatus, Prisma, RevisionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Narrow read-only resolver for placement (initial DIAGNOSTIC) definitions (§8/38/39/40).
 * Runtime is read-only against authoring data — no create/publish/edit here (§40/41).
 */
@Injectable()
export class AssessmentDefinitionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  /**
   * All PUBLISHED DIAGNOSTIC definitions for a subject. Returns a LIST on purpose: exactly-one
   * per subject is NOT a schema invariant (OPEN, §8) — the service decides (0 → not available,
   * >1 → configuration invalid) rather than silently picking one.
   */
  findPublishedDiagnosticDefinitions(subjectId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentDefinition.findMany({
      where: { subjectId, purposeScope: AssessmentPurposeScope.DIAGNOSTIC, status: ContainerStatus.PUBLISHED },
      select: { id: true, currentVersionId: true },
    });
  }

  /** Load a version and confirm it is PUBLISHED and belongs to the expected definition (§39). NEW attempts only. */
  findPublishedVersion(versionId: string, definitionId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentDefinitionVersion.findFirst({
      where: { id: versionId, definitionId, status: RevisionStatus.PUBLISHED },
      select: { id: true, definitionId: true, config: true },
    });
  }

  /**
   * Load a pinned version's config by id ONLY — no status filter (§7/38). Resume/submit read the
   * exact version the attempt was pinned to, even if it was ARCHIVED after the attempt started.
   */
  findVersionConfig(versionId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentDefinitionVersion.findUnique({
      where: { id: versionId },
      select: { id: true, config: true },
    });
  }
}
