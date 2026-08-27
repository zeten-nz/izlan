import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AssessmentAuthoringRepository } from './assessment-authoring.repository';
import { isObjectiveFormat, parseItemPayload, type PlacementItemPayload } from '../assessment/scoring/item-payload';
import { parsePlacementConfig } from '../assessment/engine/placement-config';
import { type PlacementConfig } from '../assessment/engine/placement-engine.types';

export interface ReadinessBlocker {
  code: string; // stable machine code — never a raw English sentence
  itemId?: string;
  skillId?: string;
}
export interface ReadinessWarning {
  code: string;
  skillId?: string;
}
export interface ReadinessReport {
  publishReady: boolean;
  checks: {
    hasItems: boolean;
    allPayloadsValid: boolean;
    allObjective: boolean;
    optionsWellFormed: boolean;
    allSkillsActiveAndSameSubject: boolean;
    difficultyInScale: boolean;
    configValid: boolean;
    coveredSkillsMeetItemsPerSkill: boolean;
    maxItemsCanCoverIncludedSkills: boolean;
  };
  coverage: {
    activeSubjectSkillIds: string[];
    coveredSkillIds: string[];
    uncoveredSkillIds: string[];
    itemsPerSkill: Record<string, number>;
    requiredItemsPerSkill: number | null;
  };
  blockers: ReadinessBlocker[];
  warnings: ReadinessWarning[];
}

/**
 * Deterministic, read-only publish readiness for a version (§16/17). HARD checks gate publish; an ACTIVE subject skill
 * with zero items is a WARNING only (decision C) — never a blocker, and never special-cased by skill code. Feasibility
 * uses the skills that actually PARTICIPATE in this version's pool. All authority is stable codes + safe metadata (ids/
 * counts) — never answerKey/prompt/config internals.
 */
@Injectable()
export class AssessmentReadinessService {
  constructor(private readonly repo: AssessmentAuthoringRepository) {}

  async evaluate(versionId: string, tx?: Prisma.TransactionClient): Promise<ReadinessReport | null> {
    const version = await this.repo.findVersion(versionId, tx);
    if (!version) return null;
    const def = await this.repo.findDefinition(version.definitionId, tx);
    if (!def) return null;

    const rows = await this.repo.listItems(versionId, tx);
    const activeSubjectSkillIds = (await this.repo.listActiveSubjectSkillIds(def.subjectId, tx)).map((s) => s.id);
    const activeSet = new Set(activeSubjectSkillIds);

    let config: PlacementConfig | null = null;
    try {
      config = parsePlacementConfig(version.config);
    } catch {
      config = null;
    }
    const configValid = config !== null;

    const blockers: ReadinessBlocker[] = [];
    const warnings: ReadinessWarning[] = [];

    let allPayloadsValid = true;
    let allObjective = true;
    let optionsWellFormed = true;
    let allSkillsActiveAndSameSubject = true;
    let difficultyInScale = true;
    const itemsPerSkill: Record<string, number> = {};
    const coveredSet = new Set<string>();

    for (const row of rows) {
      const it = row.item;
      let payload: PlacementItemPayload | null = null;
      try {
        payload = parseItemPayload(it.payload);
      } catch {
        payload = null;
      }
      if (!payload) {
        allPayloadsValid = false;
        optionsWellFormed = false;
        blockers.push({ code: 'INVALID_ITEM_PAYLOAD', itemId: it.id });
      } else {
        if (!isObjectiveFormat(payload.format)) {
          allObjective = false;
          blockers.push({ code: 'NON_OBJECTIVE_ITEM', itemId: it.id });
        }
        const optionsOk = payload.format !== 'open_ended' && !!payload.options && payload.options.length >= 2 && !!payload.answerKey && payload.answerKey.correctOptionIds.length > 0;
        if (!optionsOk) optionsWellFormed = false;
      }

      if (!activeSet.has(it.skillId)) {
        allSkillsActiveAndSameSubject = false;
        blockers.push({ code: 'INACTIVE_OR_FOREIGN_SKILL', itemId: it.id, skillId: it.skillId });
      }

      const effectiveDifficulty = row.difficultyOverride ?? it.difficulty;
      if (config && (effectiveDifficulty < config.profileScale.minDifficulty || effectiveDifficulty > config.profileScale.maxDifficulty)) {
        difficultyInScale = false;
        blockers.push({ code: 'DIFFICULTY_OUT_OF_SCALE', itemId: it.id });
      }

      coveredSet.add(it.skillId); // participation is by presence, independent of validity
      itemsPerSkill[it.skillId] = (itemsPerSkill[it.skillId] ?? 0) + 1;
    }

    if (!configValid) {
      difficultyInScale = false;
      blockers.push({ code: 'INVALID_CONFIG' });
    }

    const hasItems = rows.length > 0;
    if (!hasItems) blockers.push({ code: 'NO_ITEMS' });

    const coveredSkillIds = [...coveredSet];
    let coveredSkillsMeetItemsPerSkill = true;
    let maxItemsCanCoverIncludedSkills = true;
    if (config) {
      for (const sid of coveredSkillIds) {
        if ((itemsPerSkill[sid] ?? 0) < config.coverage.itemsPerSkill) {
          coveredSkillsMeetItemsPerSkill = false;
          blockers.push({ code: 'INSUFFICIENT_ITEMS_FOR_COVERED_SKILL', skillId: sid });
        }
      }
      // Feasibility over the skills that PARTICIPATE in this version (§17), not the whole subject.
      if (coveredSkillIds.length * config.coverage.itemsPerSkill > config.stopping.maxItems) {
        maxItemsCanCoverIncludedSkills = false;
        blockers.push({ code: 'CONFIG_MAX_ITEMS_INFEASIBLE' });
      }
    } else {
      coveredSkillsMeetItemsPerSkill = false;
      maxItemsCanCoverIncludedSkills = false;
    }

    // Uncovered ACTIVE subject skills → WARNING only (decision C). No skill-code special-casing.
    const uncoveredSkillIds = activeSubjectSkillIds.filter((s) => !coveredSet.has(s));
    for (const sid of uncoveredSkillIds) warnings.push({ code: 'UNCOVERED_ACTIVE_SKILL', skillId: sid });

    const checks = {
      hasItems,
      allPayloadsValid,
      allObjective,
      optionsWellFormed,
      allSkillsActiveAndSameSubject,
      difficultyInScale,
      configValid,
      coveredSkillsMeetItemsPerSkill,
      maxItemsCanCoverIncludedSkills,
    };
    const publishReady = Object.values(checks).every((v) => v === true);

    return {
      publishReady,
      checks,
      coverage: { activeSubjectSkillIds, coveredSkillIds, uncoveredSkillIds, itemsPerSkill, requiredItemsPerSkill: config ? config.coverage.itemsPerSkill : null },
      blockers,
      warnings,
    };
  }
}
