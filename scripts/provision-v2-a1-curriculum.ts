/**
 * Developer command: `ALLOW_DEV_FIXTURE=true npm run dev:provision:v2-a1-curriculum`
 *
 * DEV/QA ONLY. Authors the English A1 FOUNDATION EXPANSION (articles, plurals, there is/are, prepositions of place,
 * can/can't, frequency adverbs) on top of the pilot + base roadmap, entirely through the REAL content workflow —
 * import → publish → point-authoring draft → APPROVED review → publish. Every new point passes the Content Quality
 * gate; there is no "insert published curriculum" shortcut.
 *
 * Run AFTER: db:seed:runtime → dev:provision:english-a1 → dev:provision:v2-english-a1-roadmap. Idempotent.
 * Forbidden in production; requires ALLOW_DEV_FIXTURE=true. Prints a SAFE summary only.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { ImportService } from '../src/content-import/import.service';
import { SubjectService } from '../src/content-authoring/subject.service';
import { HierarchyService } from '../src/content-authoring/hierarchy.service';
import { HierarchyPublishService } from '../src/content-authoring/publish/hierarchy-publish.service';
import { PublicationService } from '../src/content-authoring/publish/publication.service';
import { PointAuthoringService } from '../src/point-authoring/point-authoring.service';
import { provisionA1Curriculum } from '../src/bootstrap/provision-v2-a1-curriculum';

async function main(): Promise<void> {
  const logger = new Logger('ProvisionA1Curriculum');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const r = await provisionA1Curriculum(
      {
        prisma: app.get(PrismaService),
        subjects: app.get(SubjectService, { strict: false }),
        hierarchy: app.get(HierarchyService, { strict: false }),
        importer: app.get(ImportService, { strict: false }),
        hierarchyPublish: app.get(HierarchyPublishService, { strict: false }),
        publication: app.get(PublicationService, { strict: false }),
        points: app.get(PointAuthoringService, { strict: false }),
      },
      { nodeEnv: process.env.NODE_ENV, allowDevFixture: process.env.ALLOW_DEV_FIXTURE },
    );
    logger.log(
      `A1 curriculum provisioned — subject=${r.subjectId} topicsCreated=${r.topicsCreated} lessonsPublished=${r.lessonsPublished}/6 ` +
        `skillsMappedToDomain=${r.skillsMappedToDomain} pointsPublished=${r.pointsPublished}/6 points=[${r.pointKeys.join(', ')}]`,
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    new Logger('ProvisionA1Curriculum').error(`Provisioning failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
