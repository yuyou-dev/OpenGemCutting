/**
 * Cutting Assistant: expands a faceting document into a linear per-facet
 * cutting sequence, a tier-aware stepper, and an incremental replay of the
 * half-finished solid at any step position.
 *
 * Sequence rules (ported from the cutting-sequence handoff, adapted to the
 * document-v1 model where every facet already carries an explicit clipping
 * plane, so no angle/index -> plane conversion happens here):
 * - layers cut in CUT STACK order (first appearance of patternId in
 *   document.facets); hidden layers are skipped entirely (0 steps);
 * - the fixed table layer (metadata.operationType === "table") always
 *   contributes exactly 1 step at its facet's index;
 * - every other layer contributes one step per facet, ordered by
 *   normalizeIndex(index) ascending, so mirror pairs stay adjacent;
 * - preform layers are real cuts and participate like any other layer.
 *
 * Position p in [0, total] counts completed cuts: p = 0 is the rough stock,
 * p = total the finished stone. Replay clips the stock cube with the first p
 * step planes through the same geometry path the workbench uses, caching
 * intermediate solids so stepping forward costs one clip per step.
 */

import {
  FACET_REGION_LABELS,
  FACET_REGION_PREFIXES,
  normalizeIndex,
} from "./faceting.js";
import { clipPolyhedronByPlanes, createCenteredCube } from "./geometry.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function groupFacetsByPattern(document) {
  if (!isPlainObject(document) || !Array.isArray(document.facets)) {
    throw new TypeError("document must be a faceting document with a facets array.");
  }
  const groups = new Map();
  for (const facet of document.facets) {
    if (!groups.has(facet.patternId)) groups.set(facet.patternId, []);
    groups.get(facet.patternId).push(facet);
  }
  return groups;
}

function isTableTier(facets) {
  return facets.some((facet) => facet.metadata?.operationType === "table");
}

/**
 * Expand the document into the cutting sequence plus per-tier bookkeeping.
 *
 * Returns `{ steps, tiers }`. `steps[s]` carries the full cutting parameters
 * of one cut: `{ seq, patternId, patternName, region, industryAngleDeg,
 * depth, index, plane, facetId, operationType }`. `plane` is a copy of the
 * source facet's plane (no shared mutable references). `facetId` and
 * `operationType` keep the provenance the replay needs to tag generated cap
 * faces exactly like the production construction path. `tiers[t]` =
 * `{ patternId, patternName, region, table, hidden, count, startPos }` in
 * CUT STACK order, including hidden tiers with `count: 0`.
 */
export function buildCuttingSequence(document, { hiddenPatternIds = [] } = {}) {
  const hidden = new Set(hiddenPatternIds);
  const groups = groupFacetsByPattern(document);
  const regionCounts = { crown: 0, girdle: 0, pavilion: 0 };
  const steps = [];
  const tiers = [];

  for (const [patternId, facets] of groups) {
    const first = facets[0];
    const table = isTableTier(facets);
    // Same naming source as the CUT STACK: the persisted layer label, with
    // the region prefix + per-region ordinal fallback; the fixed table does
    // not consume a region number.
    if (!table) regionCounts[first.region] += 1;
    const patternName =
      first.label ||
      `${FACET_REGION_PREFIXES[first.region]}${regionCounts[first.region]} ${FACET_REGION_LABELS[first.region]}`;
    const isHidden = hidden.has(patternId);
    const ordered = isHidden
      ? []
      : table
        ? [first]
        : [...facets].sort(
            (left, right) => normalizeIndex(left.index) - normalizeIndex(right.index),
          );
    const startPos = steps.length;

    for (const facet of ordered) {
      steps.push({
        seq: steps.length,
        patternId,
        patternName,
        region: facet.region,
        industryAngleDeg: facet.industryAngleDeg,
        depth: facet.depth,
        index: normalizeIndex(facet.index),
        plane: {
          normal: { ...facet.plane.normal },
          offset: facet.plane.offset,
          keep: facet.plane.keep,
        },
        facetId: facet.id,
        operationType: facet.metadata?.operationType,
      });
    }

    tiers.push({
      patternId,
      patternName,
      region: first.region,
      table,
      hidden: isHidden,
      count: steps.length - startPos,
      startPos,
    });
  }

  return { steps, tiers };
}

function deriveTiersFromSteps(steps) {
  const tiers = [];
  const byPattern = new Map();
  for (const step of steps) {
    let tier = byPattern.get(step.patternId);
    if (!tier) {
      tier = {
        patternId: step.patternId,
        patternName: step.patternName,
        region: step.region,
        table: step.operationType === "table",
        hidden: false,
        count: 0,
        startPos: step.seq,
      };
      byPattern.set(step.patternId, tier);
      tiers.push(tier);
    }
    tier.count += 1;
  }
  return tiers;
}

function clampPosition(total, p) {
  if (typeof p !== "number" || !Number.isFinite(p)) {
    throw new TypeError("position must be a finite number.");
  }
  return Math.max(0, Math.min(total, Math.round(p)));
}

/**
 * Tier-aware stepper over a cutting sequence.
 *
 * Accepts the `{ steps, tiers }` object from buildCuttingSequence (a bare
 * steps array also works, but then zero-step hidden tiers cannot be
 * represented and `counts` only covers tiers that cut).
 *
 * `counts[t]` is the step count of tier t (0 for skipped tiers, identities
 * kept in the parallel `tiers` array); `cum[t]` is the number of steps
 * before tier t (length N + 1); `total` is the full step count (0 is legal
 * for an all-hidden sequence).
 *
 * `locate(p)` resolves a position to
 * `{ status, position, tierIndex, patternId, stepInTier, tierStepCount }`:
 * - status "stock" at p = 0, "cutting" mid-sequence, "finished" at
 *   p = total (which belongs to no step; the last cutting tier is still
 *   reported, complete, so navigation can anchor on it);
 * - `stepInTier` counts completed cuts of the current tier.
 * Navigation: `nextTierPos(p)` jumps to the next tier's start (clamps to
 * `total` in the last tier), `prevTierPos(p)` returns to the current tier's
 * start — or the previous cutting tier's start when already at one —
 * `tierEndPos(p)` is the end position of the tier containing p (numerically
 * the same jump as nextTierPos, exposed for the "complete this tier"
 * reading of the handoff).
 */
export function makeCuttingStepper(sequence) {
  const steps = Array.isArray(sequence) ? sequence : sequence?.steps;
  if (!Array.isArray(steps)) {
    throw new TypeError("sequence must be a steps array or a buildCuttingSequence result.");
  }
  for (const step of steps) {
    if (!isPlainObject(step) || step.seq === undefined || typeof step.patternId !== "string") {
      throw new TypeError("each step must be a cutting step produced by buildCuttingSequence.");
    }
  }
  const tiers = Array.isArray(sequence)
    ? deriveTiersFromSteps(steps)
    : (sequence.tiers ?? deriveTiersFromSteps(steps));
  const counts = tiers.map((tier) => tier.count);
  const cum = [0];
  for (const count of counts) cum.push(cum[cum.length - 1] + count);
  const total = cum[cum.length - 1];

  function locate(p) {
    const position = clampPosition(total, p);
    const status =
      position === 0 ? "stock" : position === total ? "finished" : "cutting";
    for (let t = 0; t < counts.length; t += 1) {
      const count = counts[t];
      if (count === 0) continue;
      if (position < cum[t] + count) {
        return {
          status,
          position,
          tierIndex: t,
          patternId: tiers[t].patternId,
          stepInTier: position - cum[t],
          tierStepCount: count,
        };
      }
    }
    // position === total: report the last cutting tier as complete so
    // prev-tier navigation can anchor on it.
    for (let t = counts.length - 1; t >= 0; t -= 1) {
      if (counts[t] > 0) {
        return {
          status,
          position,
          tierIndex: t,
          patternId: tiers[t].patternId,
          stepInTier: counts[t],
          tierStepCount: counts[t],
        };
      }
    }
    return {
      status,
      position,
      tierIndex: null,
      patternId: null,
      stepInTier: 0,
      tierStepCount: 0,
    };
  }

  function nextTierPos(p) {
    const location = locate(p);
    if (location.tierIndex === null) return 0;
    return cum[location.tierIndex] + location.tierStepCount;
  }

  function prevTierPos(p) {
    const location = locate(p);
    if (location.tierIndex === null) return 0;
    if (location.stepInTier > 0) return cum[location.tierIndex];
    for (let t = location.tierIndex - 1; t >= 0; t -= 1) {
      if (counts[t] > 0) return cum[t];
    }
    return 0;
  }

  function tierEndPos(p) {
    const location = locate(p);
    if (location.tierIndex === null) return 0;
    return cum[location.tierIndex] + location.tierStepCount;
  }

  return {
    steps,
    tiers,
    counts,
    cum,
    total,
    locate,
    nextTierPos,
    prevTierPos,
    tierEndPos,
  };
}

/**
 * Incremental replay of the half-finished solid.
 *
 * `solidAt(p)` returns the stock cube for p = 0 and the stock clipped by the
 * first p step planes for p > 0, using the same geometry path as the
 * workbench construction stages (createCenteredCube from the document stock
 * + clipPolyhedronByPlanes with per-plane operation provenance). Positions
 * clamp into [0, total]. Computed solids are cached, so forward stepping
 * costs one clip per step and backward/jump access replays from the nearest
 * cached position; the cache is internal and invisible to callers.
 */
export function createCuttingReplay(document, { hiddenPatternIds = [] } = {}) {
  const sequence = buildCuttingSequence(document, { hiddenPatternIds });
  const stepper = makeCuttingStepper(sequence);
  const cache = new Map([
    [
      0,
      createCenteredCube(document.stock.size, {
        center: document.stock.center,
        sourceOperationId: "rough-cube",
        region: "rough",
      }),
    ],
  ]);

  function solidAt(p) {
    const position = clampPosition(stepper.total, p);
    const hit = cache.get(position);
    if (hit) return hit;

    let anchor = position - 1;
    while (anchor > 0 && !cache.has(anchor)) anchor -= 1;
    const planes = [];
    for (let s = anchor; s < position; s += 1) {
      const step = sequence.steps[s];
      planes.push({
        ...step.plane,
        operationId: step.patternId,
        faceId: step.facetId,
        region: step.region,
        operationType: step.operationType,
      });
    }
    const solid = clipPolyhedronByPlanes(cache.get(anchor), planes);
    cache.set(position, solid);
    return solid;
  }

  return {
    steps: sequence.steps,
    tiers: sequence.tiers,
    stepper,
    total: stepper.total,
    solidAt,
  };
}
