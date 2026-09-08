import { PofModel } from "./types";

/**
 * Which detail (LOD) level a submodel belongs to (its root's index into
 * `PofModel.detailLevelRootSubmodels`, or -1 if its root isn't a detail-level root -
 * e.g. debris), and whether it's a debris piece (its root is in
 * `PofModel.debrisSubmodels`). Confirmed against a real Blue Planet capital ship
 * (UEFg_Karuna.pof): each detail level and each debris piece is its own separate
 * top-level hierarchy (submodel with `parentSubmodel === -1`) - turrets/engines/other
 * attached subsystems are children of detail level 0 specifically, not shared across
 * detail levels, so a lower detail level's subtree is just a simplified standalone
 * hull with no attachments of its own.
 */
export interface SubmodelClassification {
  detailLevel: number;
  isDebris: boolean;
}

/** Classifies every submodel in `model` by walking each one's parent chain up to its hierarchy root and checking that root against `detailLevelRootSubmodels`/`debrisSubmodels`. */
export function classifySubmodels(model: PofModel): Map<number, SubmodelClassification> {
  const bySubmodelNumber = new Map<number, { submodelNumber: number; parentSubmodel: number }>();
  for (const s of model.subobjects) {
    bySubmodelNumber.set(s.submodelNumber, s);
  }

  const rootCache = new Map<number, number>();
  const findRoot = (index: number, visiting: Set<number>): number => {
    const cached = rootCache.get(index);
    if (cached !== undefined) {
      return cached;
    }
    const sm = bySubmodelNumber.get(index);
    if (!sm || sm.parentSubmodel < 0 || sm.parentSubmodel === index || visiting.has(index)) {
      rootCache.set(index, index);
      return index;
    }
    visiting.add(index);
    const root = findRoot(sm.parentSubmodel, visiting);
    visiting.delete(index);
    rootCache.set(index, root);
    return root;
  };

  const result = new Map<number, SubmodelClassification>();
  for (const s of model.subobjects) {
    const root = findRoot(s.submodelNumber, new Set());
    result.set(s.submodelNumber, {
      detailLevel: model.detailLevelRootSubmodels.indexOf(root),
      isDebris: model.debrisSubmodels.includes(root),
    });
  }
  return result;
}
