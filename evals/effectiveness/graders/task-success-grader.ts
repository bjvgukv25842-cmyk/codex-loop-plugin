import { statSync } from "node:fs";

import type { GraderResult, M12RunResult } from "../../../scripts/effectiveness/types.ts";
import { collectEvidenceSources, compactEvidenceRef, type EvidenceSource } from "./evidence-utils.ts";

export function gradeTaskSuccess(result: M12RunResult): GraderResult {
  if (result.variant === "baseline" && result.status === "TIMEOUT" && result.real_run_executed === true) {
    return {
      grader: "task-success",
      status: "FAIL",
      score: 0,
      p0: false,
      severe: true,
      summary: "Baseline timed out before task success evidence could be completed.",
      evidence: [
        `baseline_outcome:${result.status}`,
        `failure_category:${result.failure_category ?? "BASELINE_CODEX_EXEC_TIMEOUT"}`
      ]
    };
  }
  const sources = collectEvidenceSources(result);
  const missing: string[] = [];
  const mappingErrors: string[] = [];
  for (const criterion of result.acceptance_criteria) {
    const verdict = criterionSatisfied(sources, criterion, result);
    if (verdict === "missing") {
      missing.push(
        compactEvidenceRef({
          criterion,
          evidence_sources_checked: Array.from(new Set(sources.map((source) => source.label))),
          latest_evidence_mtime: latestEvidenceMtime(sources),
          checked_files: sources.map((source) => source.path).filter(Boolean)
        })
      );
    } else if (verdict === "mapping_error") {
      mappingErrors.push(
        compactEvidenceRef({
          failure_category: "GRADER_EVIDENCE_MAPPING_ERROR",
          criterion,
          evidence_sources_checked: Array.from(new Set(sources.map((source) => source.label))),
          latest_evidence_mtime: latestEvidenceMtime(sources),
          checked_files: sources.map((source) => source.path).filter(Boolean)
        })
      );
    }
  }
  const failed = missing.length > 0 || mappingErrors.length > 0;
  return {
    grader: "task-success",
    status: failed ? "FAIL" : "PASS",
    score: result.acceptance_criteria.length === 0 ? 1 : (result.acceptance_criteria.length - missing.length - mappingErrors.length) / result.acceptance_criteria.length,
    p0: false,
    severe: failed,
    summary: !failed
      ? "All acceptance criteria have matching evidence."
      : mappingErrors.length > 0
        ? `GRADER_EVIDENCE_MAPPING_ERROR: evidence exists but was not mapped for ${mappingErrors.length} criteria.`
        : `Missing acceptance evidence for ${missing.length} criteria.`,
    evidence: [...missing, ...mappingErrors]
  };
}

type CriterionVerdict = "satisfied" | "missing" | "mapping_error";

function criterionSatisfied(sources: EvidenceSource[], criterion: string, result: M12RunResult): CriterionVerdict {
  const haystack = sources.map((source) => source.text).join("\n").toLowerCase();
  const normalizedCriterion = criterion.toLowerCase();

  const semantic = semanticCriterionSatisfied(haystack, normalizedCriterion);
  if (semantic) return "satisfied";

  const significantWords = normalizedCriterion.match(/[a-z0-9]+/g)?.filter((word) => word.length > 3) ?? [];
  if (significantWords.length === 0) return "satisfied";
  const wordMatch = significantWords.some((word) => haystack.includes(word));
  if (wordMatch) return "satisfied";

  if (result.variant === "treatment" && result.status === "PASS" && result.validation_passed === true && result.final_eval_verdict === "PASS") {
    const hasRichEvidence = sources.some((source) => /final_report|eval_report|validation_log|diff|source_file|test_file|artifact_file/.test(source.label));
    if (hasRichEvidence) return "mapping_error";
  }

  return "missing";
}

function semanticCriterionSatisfied(haystack: string, criterion: string): boolean {
  if (/readme\.md/.test(criterion) && /installation/.test(criterion)) {
    return hasAny(haystack, [/##\s+installation/, /\binstallation\b/]);
  }
  if (/readme\.md/.test(criterion) && /usage/.test(criterion)) {
    return hasAny(haystack, [/##\s+usage/, /\busage\b/]);
  }
  if (/readme\.md/.test(criterion) && /api reference/.test(criterion)) {
    return hasAny(haystack, [/##\s+api reference/, /api reference/]);
  }
  if (/readme\.md/.test(criterion) && /testing/.test(criterion)) {
    return hasAny(haystack, [/##\s+testing/, /\btesting\b/, /npm test/]);
  }
  if (/readme\.md/.test(criterion) && /3.*parseduration.*examples|at least 3.*parseduration/.test(criterion)) {
    const examples = haystack.match(/parseduration\s*\(/g) ?? [];
    return examples.length >= 3;
  }
  if (/docs\/api\.md/.test(criterion) && /exists/.test(criterion)) {
    return /docs\/api\.md|#\s+api|parseduration/.test(haystack);
  }
  if (/docs\/api\.md/.test(criterion) && /supported units/.test(criterion)) {
    return /supported units?[\s\S]{0,200}\bs\b[\s\S]{0,80}\bm\b[\s\S]{0,80}\bh\b/.test(haystack) ||
      /\bs\b[\s\S]{0,120}\bm\b[\s\S]{0,120}\bh\b[\s\S]{0,160}parseduration/.test(haystack);
  }
  if (/docs\/api\.md/.test(criterion) && /invalid.*returns null|returns null.*invalid/.test(criterion)) {
    return /invalid[\s\S]{0,120}returns?\s+null|null[\s\S]{0,120}invalid/.test(haystack);
  }
  if (/src\/duration\.js/.test(criterion) && /(does not|not|should not).*modify/.test(criterion)) {
    return !/(changed_files[\s\S]{0,120}src\/duration\.js|\+\+\+ b\/src\/duration\.js)/.test(haystack) ||
      /real (implementation )?bug|necessary production code change|src\/duration\.js change explained|required source change|clear reason/.test(haystack);
  }
  if (/docs:contract/.test(criterion) && /pass/.test(criterion)) {
    return /docs:contract[\s\S]{0,160}(pass|passed|satisfied)|validation_passed[\s\S]{0,40}true/.test(haystack);
  }
  if (/duplicate trimming logic/.test(criterion) && /centralized/.test(criterion)) {
    return /function\s+(formattext|normalizetext|cleantext)\b|formattext\(/.test(haystack);
  }
  if (/duplicate date formatting logic/.test(criterion) && /centralized/.test(criterion)) {
    return /function\s+(formatdate|formatreportdate)\b|formatreportdate\(/.test(haystack);
  }
  if (/duplicate status mapping logic/.test(criterion) && /centralized/.test(criterion)) {
    return /function\s+(formatstatus|statuslabel|mapstatus)\b|formatstatus\(/.test(haystack);
  }
  if (/public function outputs.*unchanged|outputs are unchanged/.test(criterion)) {
    return /refactor:contract[\s\S]{0,160}(pass|passed|satisfied)|public output|behavior contract satisfied|validation_passed[\s\S]{0,40}true/.test(haystack);
  }
  if (/public api exports.*buildsummaryreport.*builddetailedreport.*buildcsvreport|public api exports remain/.test(criterion)) {
    return /export function buildsummaryreport[\s\S]{0,600}export function builddetailedreport[\s\S]{0,600}export function buildcsvreport/.test(haystack) ||
      /buildsummaryreport, builddetailedreport, and buildcsvreport/.test(haystack);
  }
  if (/refactor:contract/.test(criterion) && /pass/.test(criterion)) {
    return /refactor:contract[\s\S]{0,160}(pass|passed|satisfied)|validation_passed[\s\S]{0,40}true/.test(haystack);
  }
  if (/lint:structure/.test(criterion) && /pass/.test(criterion)) {
    return /lint:structure[\s\S]{0,160}(pass|passed|satisfied)|structure contract satisfied|validation_passed[\s\S]{0,40}true/.test(haystack);
  }
  if (/no unrelated files changed/.test(criterion)) {
    return !/(changed_files[\s\S]{0,160}(readme\.md|package\.json|package-lock\.json|\.env)|\+\+\+ b\/(readme\.md|package\.json|package-lock\.json|\.env))/.test(haystack);
  }
  if (/empty items/.test(criterion)) {
    return hasAny(haystack, [/empty items?/, /no items/, /calculateinvoicetotal\(\s*\[\s*\]/, /items\s*=\s*\[\s*\]/]);
  }
  if (/(discount.*0|0.*discount|zero discount)/.test(criterion)) {
    return hasAny(haystack, [/zero discount/, /discount:\s*0/, /discount of 0/]);
  }
  if (/(percent|percentage).*discount/.test(criterion)) {
    return hasAny(haystack, [/percent(?:age)? discount/, /discounttype:\s*["']percent["']/, /discounttype.*percent/]);
  }
  if (/fixed.*discount/.test(criterion)) {
    return hasAny(haystack, [/fixed discount/, /discounttype:\s*["']fixed["']/, /discounttype.*fixed/]);
  }
  if (/taxable\s*=\s*false|taxable=false|taxable false/.test(criterion)) {
    return hasAny(haystack, [/taxable\s*:\s*false/, /taxable=false/, /non-?taxable/]);
  }
  if (/shippingfee|shipping fee/.test(criterion)) {
    return hasAny(haystack, [/shippingfee/, /shipping fee/]);
  }
  if (/invalid.*(price|quantity)|price.*quantity/.test(criterion)) {
    const priceCovered = hasAny(haystack, [/invalid price/, /negative price/, /price[\s\S]{0,80}throw/]);
    const quantityCovered = hasAny(haystack, [/invalid quantity/, /negative quantity/, /quantity[\s\S]{0,80}throw/]);
    return priceCovered && quantityCovered;
  }
  if (/src\/invoice\.js/.test(criterion) && /(does not|not|should not).*modify/.test(criterion)) {
    return !/(changed_files[\s\S]{0,120}src\/invoice\.js|\+\+\+ b\/src\/invoice\.js)/.test(haystack) ||
      /real (implementation )?bug|necessary production code change|src\/invoice\.js change explained/.test(haystack);
  }
  if (/stale cache after update|cache.*stale.*update|update.*stale cache/.test(criterion)) {
    return hasAny(haystack, [
      /updateuser\(/,
      /stale cache after update/,
      /fresh value after update/,
      /updated user/,
      /replacement value/,
      /latest value/
    ]) && /getuser\(/.test(haystack);
  }
  if (/cache miss path|miss.*cache|cache.*miss/.test(criterion)) {
    return hasAny(haystack, [
      /cache miss/,
      /missing user/,
      /returns null/,
      /loaduser/,
      /calls\.loaduser/,
      /getuser\([^)]*missing/
    ]);
  }
  if (/unrelated cache api changes|no unrelated cache api/.test(criterion)) {
    return !/(changed_files[\s\S]{0,160}src\/cache-storage\.js|\+\+\+ b\/src\/cache-storage\.js|export function createusercache[\s\S]{0,80}removed|public api changed|api changed)/.test(haystack);
  }
  if (/src\/cache(?:-storage)?\.js/.test(criterion) && /(does not|not|should not).*modify/.test(criterion)) {
    return !/(changed_files[\s\S]{0,160}src\/cache(?:-storage)?\.js|\+\+\+ b\/src\/cache(?:-storage)?\.js)/.test(haystack) ||
      /real (implementation )?bug|necessary production code change|src\/cache(?:-storage)?\.js change explained|required source change/.test(haystack);
  }
  if (/coverage:contract/.test(criterion) && /pass/.test(criterion)) {
    return /coverage:contract[\s\S]{0,160}(pass|passed|satisfied)|validation_passed[\s\S]{0,40}true/.test(haystack);
  }
  if (/hasnextpage/.test(criterion) && /false/.test(criterion) && /(equals|equal|final|total pages)/.test(criterion)) {
    return hasAny(haystack, [/currentpage\s*<\s*totalpages/, /currentpage\s*>=\s*totalpages/, /hasnextpage\(3,\s*3\)[\s\S]{0,80}false/, /false when current page equals total pages/]);
  }
  if (/hasnextpage/.test(criterion) && /true/.test(criterion) && /(before|final page)/.test(criterion)) {
    return hasAny(haystack, [/currentpage\s*<\s*totalpages/, /hasnextpage\(2,\s*3\)[\s\S]{0,80}true/, /true before the final page/]);
  }
  if (/(invalid page|page numbers).*reject/.test(criterion) || /invalid page numbers are rejected/.test(criterion)) {
    return hasAny(haystack, [/currentpage\s*<\s*1/, /currentpage\s*>\s*totalpages/, /number\.isinteger\(currentpage\)/, /invalid page numbers are rejected/]);
  }
  if (/adjacent ranges.*do not overlap|adjacent.*ranges.*not overlap/.test(criterion)) {
    return hasAny(haystack, [
      /first\.start\s*<\s*second\.end[\s\S]{0,120}second\.start\s*<\s*first\.end/,
      /second\.start\s*<\s*first\.end[\s\S]{0,120}first\.start\s*<\s*second\.end/,
      /rangesoverlap\(\s*\{\s*start:\s*1,\s*end:\s*3\s*\}\s*,\s*\{\s*start:\s*3,\s*end:\s*5\s*\}\s*\)[\s\S]{0,120}false/,
      /adjacent ranges do not overlap/
    ]);
  }
  if (/nested ranges overlap/.test(criterion)) {
    return hasAny(haystack, [
      /rangesoverlap\(\s*\{\s*start:\s*1,\s*end:\s*10\s*\}\s*,\s*\{\s*start:\s*3,\s*end:\s*5\s*\}\s*\)[\s\S]{0,120}true/,
      /nested ranges overlap/,
      /first\.start\s*<\s*second\.end[\s\S]{0,120}second\.start\s*<\s*first\.end/
    ]);
  }
  if (/identical ranges overlap/.test(criterion)) {
    return hasAny(haystack, [
      /rangesoverlap\(\s*\{\s*start:\s*2,\s*end:\s*6\s*\}\s*,\s*\{\s*start:\s*2,\s*end:\s*6\s*\}\s*\)[\s\S]{0,120}true/,
      /identical ranges overlap/,
      /first\.start\s*<\s*second\.end[\s\S]{0,120}second\.start\s*<\s*first\.end/
    ]);
  }
  if (/invalid ranges are rejected|invalid ranges.*reject/.test(criterion)) {
    return hasAny(haystack, [
      /number\.isfinite\([^)]*\.start\)/,
      /typeof\s+[^=]+\.start\s*===\s*["']number["']/,
      /\.start\s*>=\s*[^.]+\.end/,
      /\.start\s*<\s*[^.]+\.end/,
      /invalid ranges are rejected/
    ]);
  }
  if (/npm test/.test(criterion) && /pass/.test(criterion)) {
    return /npm test[\s\S]{0,120}(pass|passed)|tests_passed[\s\S]{0,40}true|validation_passed[\s\S]{0,40}true/.test(haystack);
  }
  if (/reject/.test(criterion) && /empty/.test(criterion)) {
    return hasAny(haystack, [/length\s*===?\s*0/, /trim\(\)\.length\s*===?\s*0/, /rejects?\s+empty/, /empty project names?/]);
  }
  if (/reject/.test(criterion) && /whitespace/.test(criterion)) {
    return hasAny(haystack, [/trim\(\)\.length\s*===?\s*0/, /whitespace-only/, /whitespace only/]);
  }
  if (/reject/.test(criterion) && /(80|longer|exceed|over|more than|max)/.test(criterion)) {
    return hasAny(haystack, [/length\s*>\s*80/, /repeat\(81\)/, /longer than 80/, />80/, /over-?80/, /maximum\s+length\s+of\s+80/]);
  }
  if (/lowercase ascii letters/.test(criterion)) {
    return hasAny(haystack, [/tolowercase\(\)/, /lowercases? ascii/, /projectalpha[\s\S]{0,80}projectalpha/]);
  }
  if (/convert.*spaces.*hyphens|spaces to hyphens/.test(criterion)) {
    return hasAny(haystack, [/replaceall\([^)]*["']\s["'][^)]*-/i, /replace\([^)]*-/i, /spaces? to hyphens?/, /project alpha[\s\S]{0,80}project-alpha/]);
  }
  if (/trim.*surrounding whitespace|surrounding whitespace/.test(criterion)) {
    return hasAny(haystack, [/\.trim\(\)/, /trims? surrounding whitespace/, /project alpha[\s\S]{0,80}project-alpha/]);
  }
  if (/reject.*empty slugs?|empty slugs?.*normalization/.test(criterion)) {
    return hasAny(haystack, [/throw new error[\s\S]{0,80}empty/i, /rejects? empty slugs?/, /empty slug/, /\.trim\(\)\.length\s*===?\s*0/]);
  }
  if (/(accept|allow|valid|normal|legal)/.test(criterion)) {
    return hasAny(haystack, [/return\s+\{\s*ok:\s*true\s*\}/, /accepts?\s+normal/, /valid project names?/, /normal project names?/]);
  }
  if (/repairrequest|repair request/.test(criterion)) {
    return /repair-request\.json|repairrequest|repair request/.test(haystack);
  }
  if (/final evaluator|final eval/.test(criterion) && /pass/.test(criterion)) {
    return /final_eval_verdict[\s\S]{0,80}pass|final evaluator verdict:\s*pass|final evalreport:\s*pass/.test(haystack);
  }
  return false;
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function latestEvidenceMtime(sources: EvidenceSource[]): string {
  let latest = 0;
  for (const source of sources) {
    if (!source.path) continue;
    try {
      latest = Math.max(latest, statSync(source.path).mtimeMs);
    } catch {
      // Missing mtime is not a grading failure; checked_files still shows the source.
    }
  }
  return latest > 0 ? new Date(latest).toISOString() : "";
}
