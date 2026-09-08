import { test } from "node:test";
import * as assert from "node:assert/strict";
import { classifySubmodels } from "../src/pof/classify";
import { PofModel, PofSubobject } from "../src/pof/types";

function sub(submodelNumber: number, parentSubmodel: number, name: string): PofSubobject {
  return { submodelNumber, parentSubmodel, name, properties: null, offset: { x: 0, y: 0, z: 0 }, bspData: null };
}

/** Builds a minimal PofModel with only the fields classifySubmodels() actually reads. */
function buildModel(subobjects: PofSubobject[], detailLevelRootSubmodels: number[], debrisSubmodels: number[]): PofModel {
  return {
    version: 0,
    textures: [],
    subobjects,
    dockPoints: [],
    paths: [],
    specialPoints: [],
    glowBanks: [],
    thrusterBanks: [],
    buildInfo: null,
    eyePoints: [],
    primaryBankCount: null,
    secondaryBankCount: null,
    turretGunBanks: [],
    turretMissileBanks: [],
    autocenterPoint: null,
    insigniaCount: 0,
    detailLevelRootSubmodels,
    debrisSubmodels,
    unhandledChunkIds: [],
  };
}

test("classifySubmodels assigns a detail level to a hierarchy's descendants, not just its root", () => {
  // Mirrors the real Karuna shape confirmed this session: detail0 (#0) has turret
  // children; detail1/detail2 (#79/#91) are separate, standalone top-level hulls with
  // no children of their own; debris pieces (#114+) are also separate top-level roots.
  const model = buildModel(
    [
      sub(0, -1, "detail0"),
      sub(1, 0, "turret01"),
      sub(2, 1, "turret01-arm"), // grandchild of detail0 - should still inherit detail level 0
      sub(79, -1, "detail1"),
      sub(91, -1, "detail2"),
      sub(114, -1, "debris01"),
    ],
    [0, 79, 91],
    [114],
  );

  const result = classifySubmodels(model);

  assert.deepEqual(result.get(0), { detailLevel: 0, isDebris: false });
  assert.deepEqual(result.get(1), { detailLevel: 0, isDebris: false }, "a direct child of detail0 should inherit detail level 0");
  assert.deepEqual(result.get(2), { detailLevel: 0, isDebris: false }, "a grandchild of detail0 should inherit detail level 0 too");
  assert.deepEqual(result.get(79), { detailLevel: 1, isDebris: false });
  assert.deepEqual(result.get(91), { detailLevel: 2, isDebris: false });
  assert.deepEqual(result.get(114), { detailLevel: -1, isDebris: true });
});

test("classifySubmodels leaves an unrelated submodel as detailLevel -1, isDebris false, so it's always shown", () => {
  const model = buildModel([sub(0, -1, "detail0"), sub(5, -1, "some_other_root")], [0], []);
  const result = classifySubmodels(model);
  assert.deepEqual(result.get(5), { detailLevel: -1, isDebris: false });
});

test("classifySubmodels is defensive against a cyclic parent chain", () => {
  const model = buildModel(
    [sub(1, 2, "a"), sub(2, 1, "b")], // 1's parent is 2, 2's parent is 1 - a cycle
    [],
    [],
  );
  assert.doesNotThrow(() => classifySubmodels(model));
});
