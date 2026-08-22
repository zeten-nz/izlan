/**
 * Developer command: `npm run content:pilot:a1:validate`
 *
 * Validates the English A1 pilot content using the EXISTING canonical importer parser plus the pilot-level cross-file
 * invariants (src/content-import/pilot/english-a1-pilot.ts). Prints a SAFE summary only — never answerKey, full
 * objective payloads, or Markdown bodies. Exits non-zero if anything is invalid (usable in CI).
 */
import { validatePilot } from '../src/content-import/pilot/english-a1-pilot';

function main(): void {
  const { ok, summary, issues } = validatePilot();

  // Safe output — counts only.
  console.log('English A1 pilot');
  console.log(`Version:    ${summary.pilotVersion}`);
  console.log(`Topics:     ${summary.topics}`);
  console.log(`Lessons:    ${summary.lessons}`);
  console.log(`Activities: ${summary.activities} (objective: ${summary.objectiveActivities})`);
  console.log(`Skills:     ${summary.skills}`);
  console.log(`Estimated duration: ${summary.estimatedDurationMin} min`);
  console.log(`Status:     ${ok ? 'VALID' : 'INVALID'}`);

  if (!ok) {
    console.error(`\n${issues.length} issue(s):`);
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }
}

main();
