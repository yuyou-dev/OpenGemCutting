import { constructionPrefix, designError, draftForPattern, lookupTarget } from './designOperations.js';
import { defaultDraftForRegion } from '../domain/cutSession.js';
import { getCuttingReference, normalizeIndex } from '../domain/faceting.js';
import { resolveDraftGeometry } from '../domain/cutConstruction.js';
import { generateJumpCandidates, generateDualJumpCandidates } from '../domain/meetJump.js';

/** Read-only Jump queries use the same coordinates as the editor and CUT commit. */
export function designJumpCandidates(document, args) {
  const solid = constructionPrefix(document, args.patternId);
  const existing = document.facets.filter((f) => f.patternId === args.patternId);
  if (existing.length && existing[0].region !== args.region)
    throw designError('LOCKED_REGION', '编辑不能更改已保存 CUT 的部位。');
  const draft = {
    ...(existing.length ? draftForPattern(existing) : defaultDraftForRegion(args.region, { indexTeeth: document.indexGear.teeth })),
    ...args.draft,
  };
  const reference = getCuttingReference(document);
  const geometry = resolveDraftGeometry(draft, args.region, reference);
  if (geometry.error) throw designError('INVALID_CUT', geometry.error);
  const primary = geometry.facets.find((f) => f.index === normalizeIndex(draft.baseIndex, draft.indexTeeth));
  if (!primary) throw designError('INVALID_CUT', '请选择当前索引集合中的主切面。');
  return args.targetA
    ? generateDualJumpCandidates({
        baseSolid: solid,
        targetA: lookupTarget(solid, args.targetA),
        baseIndex: draft.baseIndex,
        indexTeeth: draft.indexTeeth,
        region: args.region,
        stock: reference,
      })
    : generateJumpCandidates({
        baseSolid: solid,
        normal: primary.plane.normal,
        stock: reference,
      });
}
