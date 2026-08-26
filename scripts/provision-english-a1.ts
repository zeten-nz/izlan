/**
 * Developer command: `ALLOW_DEV_FIXTURE=true npm run dev:provision:english-a1`
 *
 * DEV/QA ONLY. Reconstructs the working English A1 development curriculum + placement bridge in the current dev DB:
 *  - imports the real pilot (content/pilots/english-a1/v1) via the CANONICAL authoring/import services
 *    (validate → apply DRAFT → submit-review → publish), and
 *  - ensures the placement DIAGNOSTIC measures all 13 pilot skills (Prisma model APIs only — assessment has no
 *    authoring API), so Placement → Roadmap surfaces the 12 real lessons.
 *
 * Assumes the runtime seed already ran (subject/track/level/module + ADMIN actor). Idempotent. Forbidden in production;
 * requires ALLOW_DEV_FIXTURE=true. Prints a SAFE summary only — never passwords/tokens/OTP.
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
import { provisionEnglishA1 } from '../src/bootstrap/provision-english-a1';

async function main(): Promise<void> {
  const logger = new Logger('ProvisionEnglishA1');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const r = await provisionEnglishA1(
      {
        prisma: app.get(PrismaService),
        subjects: app.get(SubjectService, { strict: false }),
        hierarchy: app.get(HierarchyService, { strict: false }),
        importer: app.get(ImportService, { strict: false }),
        hierarchyPublish: app.get(HierarchyPublishService, { strict: false }),
        publication: app.get(PublicationService, { strict: false }),
      },
      { nodeEnv: process.env.NODE_ENV, allowDevFixture: process.env.ALLOW_DEV_FIXTURE },
    );
    logger.log(
      `English A1 provisioned — subject=${r.subjectId} topics=${r.topics} pilotLessonsPublished=${r.pilotLessonsPublished}/12 ` +
        `pilotSkills=${r.pilotSkills}/13 diagnostic=v${r.diagnostic.versionNo} pool=${r.diagnostic.poolSize} skills=${r.diagnostic.distinctSkills} ` +
        `(${r.diagnostic.createdNewVersion ? 'created new version' : 'reused existing version'})`,
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    new Logger('ProvisionEnglishA1').error(`Provisioning failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
