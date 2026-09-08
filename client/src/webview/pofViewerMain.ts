/**
 * Runs INSIDE the 3D-viewer webview (bundled to client/dist/pofViewerWebview.js by
 * build.js as a self-contained browser IIFE - three.js is bundled in, never loaded
 * from a CDN, since a VSCode webview's CSP only allows resources vetted by the
 * extension host). Receives a `{type:"geometry", ...}` postMessage from
 * client/src/pofViewer.ts (the extension-host side) describing every submodel of one
 * POF, renders each as a mesh positioned via its accumulated parent-chain offset, and
 * highlights the submodel matching the subsystem the user F12'd on.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

interface SubmodelPayload {
  name: string;
  parentIndex: number;
  offset: [number, number, number];
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  /** Which detail (LOD) level's hierarchy this submodel belongs to (see server/src/pof/classify.ts), or -1 if none (e.g. debris). */
  detailLevel: number;
  /** Whether this submodel is (or descends from) a debris piece. */
  isDebris: boolean;
}

interface GeometryMessage {
  type: "geometry";
  modelFile: string;
  targetSubmodelIndex: number;
  submodels: SubmodelPayload[];
  /** Number of detail (LOD) levels this model declares - a detail-level picker is only shown when this is more than 1. */
  detailLevelCount: number;
}

/** Sent instead of a full GeometryMessage when re-triggering F12 on a different `$Subsystem:` of the SAME, already-rendered model - see pofViewer.ts's fingerprint() doc comment. */
interface HighlightMessage {
  type: "highlight";
  targetSubmodelIndex: number;
}

declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (s: unknown) => void;
};

const NORMAL_COLOR = 0x8899aa;
const HIGHLIGHT_COLOR = 0xffcc33;
const HIGHLIGHT_EMISSIVE = 0x664400;

let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let controls: OrbitControls | null = null;
let currentGroup: THREE.Group | null = null;
/** The currently-rendered model's meshes, keyed by submodel index - lets applyHighlight() recolor in place instead of rebuilding the scene when only the highlighted subsystem changes. */
let currentMeshes: Map<number, THREE.Mesh> | null = null;
/** Same keys as currentMeshes - detail-level/debris classification, used by updateVisibility(). */
let currentClassifications: Map<number, { detailLevel: number; isDebris: boolean }> | null = null;
let currentTargetIndex = -1;
let currentWireframe: THREE.LineSegments | null = null;

/** Which detail level is currently shown (submodels with detailLevel === -1, i.e. not part of any LOD hierarchy, are always shown regardless). */
let selectedDetailLevel = 0;
/** Whether debris pieces are currently shown. */
let showDebris = false;

let controlsPanel: HTMLElement | null = null;
let detailRadios: HTMLInputElement[] = [];
let debrisCheckbox: HTMLInputElement | null = null;

function getContainer(): HTMLElement {
  return document.getElementById("viewer-root") as HTMLElement;
}

/** Walks a submodel's parent chain to accumulate its world-space offset (POF submodel offsets are parent-relative, not absolute). Defensive against a cyclic/malformed parent chain via a visited-set guard. */
function computeWorldOffset(
  submodels: SubmodelPayload[],
  index: number,
  cache: Map<number, [number, number, number]>,
  visiting: Set<number>,
): [number, number, number] {
  const cached = cache.get(index);
  if (cached) {
    return cached;
  }
  const sm = submodels[index];
  if (!sm || sm.parentIndex < 0 || sm.parentIndex === index || visiting.has(index)) {
    const result: [number, number, number] = sm ? sm.offset : [0, 0, 0];
    cache.set(index, result);
    return result;
  }
  visiting.add(index);
  const parentOffset = computeWorldOffset(submodels, sm.parentIndex, cache, visiting);
  visiting.delete(index);
  const result: [number, number, number] = [
    parentOffset[0] + sm.offset[0],
    parentOffset[1] + sm.offset[1],
    parentOffset[2] + sm.offset[2],
  ];
  cache.set(index, result);
  return result;
}

function initSceneIfNeeded(): void {
  if (scene) {
    return;
  }
  const container = getContainer();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e1e1e);

  camera = new THREE.PerspectiveCamera(60, container.clientWidth / Math.max(container.clientHeight, 1), 0.01, 1e6);
  camera.position.set(10, 10, 10);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(5, 10, 7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-6, -4, -8);
  scene.add(fill);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  window.addEventListener("resize", () => {
    if (!camera || !renderer) return;
    const w = container.clientWidth;
    const h = Math.max(container.clientHeight, 1);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  const animate = () => {
    requestAnimationFrame(animate);
    controls?.update();
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  };
  animate();
}

/**
 * Builds (replacing any previous instance) the floating detail-level/debris controls
 * overlay for the model just rendered. Real capital ships routinely have several LOD
 * hulls and dozens of debris pieces all sharing the same space as the actual ship,
 * which makes it hard to see what you're looking at - these let the user narrow the
 * view down to one detail level and hide debris (both default to detail level 0 /
 * debris hidden, which is what the user is normally trying to inspect).
 */
function buildControls(detailLevelCount: number, hasDebris: boolean): void {
  controlsPanel?.remove();
  detailRadios = [];
  debrisCheckbox = null;

  if (detailLevelCount <= 1 && !hasDebris) {
    return; // nothing to control - a simple model with one hull and no debris
  }

  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed; top:8px; left:8px; z-index:10; background:rgba(30,30,30,0.85); color:#ddd; " +
    "font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:8px 10px; border-radius:4px; " +
    "display:flex; flex-direction:column; gap:4px; user-select:none;";

  if (detailLevelCount > 1) {
    const label = document.createElement("div");
    label.textContent = "Detail level";
    label.style.cssText = "font-weight:600; opacity:0.8;";
    panel.appendChild(label);

    for (let level = 0; level < detailLevelCount; level++) {
      const row = document.createElement("label");
      row.style.cssText = "display:flex; align-items:center; gap:5px; cursor:pointer;";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "detail-level";
      input.value = String(level);
      input.checked = level === selectedDetailLevel;
      input.addEventListener("change", () => {
        if (input.checked) {
          selectedDetailLevel = level;
          updateVisibility();
        }
      });
      detailRadios.push(input);
      row.appendChild(input);
      row.appendChild(document.createTextNode(`Detail ${level}`));
      panel.appendChild(row);
    }
  }

  if (hasDebris) {
    const row = document.createElement("label");
    row.style.cssText = "display:flex; align-items:center; gap:5px; cursor:pointer; margin-top:2px;";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = showDebris;
    input.addEventListener("change", () => {
      showDebris = input.checked;
      updateVisibility();
    });
    debrisCheckbox = input;
    row.appendChild(input);
    row.appendChild(document.createTextNode("Show debris"));
    panel.appendChild(row);
  }

  document.body.appendChild(panel);
  controlsPanel = panel;
}

/** Applies selectedDetailLevel/showDebris to every rendered mesh's visibility, plus the highlight wireframe if its target mesh is currently hidden. No geometry/material rebuild, no camera change. */
function updateVisibility(): void {
  if (!currentMeshes || !currentClassifications) {
    return;
  }
  for (const [index, mesh] of currentMeshes) {
    const classification = currentClassifications.get(index);
    mesh.visible = classification
      ? classification.isDebris
        ? showDebris
        : classification.detailLevel === -1 || classification.detailLevel === selectedDetailLevel
      : true;
  }
  if (currentWireframe) {
    const targetMesh = currentMeshes.get(currentTargetIndex);
    currentWireframe.visible = targetMesh ? targetMesh.visible : true;
  }
}

function renderGeometry(msg: GeometryMessage): void {
  initSceneIfNeeded();
  if (!scene || !camera || !controls) {
    return;
  }

  if (currentGroup) {
    scene.remove(currentGroup);
    currentGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
  }

  const group = new THREE.Group();
  const meshesByIndex = new Map<number, THREE.Mesh>();
  const classifications = new Map<number, { detailLevel: number; isDebris: boolean }>();
  const offsetCache = new Map<number, [number, number, number]>();
  let boundingRadius = 1;

  msg.submodels.forEach((sm, i) => {
    const worldOffset = computeWorldOffset(msg.submodels, i, offsetCache, new Set());
    if (sm.positions.length === 0) {
      return; // pure hierarchy node with no geometry of its own
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(sm.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(sm.normals, 3));
    if (sm.uvs.length > 0) {
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(sm.uvs, 2));
    }
    geometry.setIndex(sm.indices);

    const isTarget = i === msg.targetSubmodelIndex;
    const material = new THREE.MeshStandardMaterial({
      color: isTarget ? HIGHLIGHT_COLOR : NORMAL_COLOR,
      emissive: isTarget ? HIGHLIGHT_EMISSIVE : 0x000000,
      metalness: 0.1,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(worldOffset[0], worldOffset[1], worldOffset[2]);
    group.add(mesh);
    meshesByIndex.set(i, mesh);
    classifications.set(i, { detailLevel: sm.detailLevel, isDebris: sm.isDebris });

    for (let k = 0; k < sm.positions.length; k += 3) {
      const dist = Math.hypot(
        sm.positions[k] + worldOffset[0],
        sm.positions[k + 1] + worldOffset[1],
        sm.positions[k + 2] + worldOffset[2],
      );
      if (dist > boundingRadius) {
        boundingRadius = dist;
      }
    }
  });

  scene.add(group);
  currentGroup = group;
  currentMeshes = meshesByIndex;
  currentClassifications = classifications;
  currentTargetIndex = -1;
  currentWireframe = null;

  // Default to whichever detail level actually contains the target (normally 0, but
  // stay correct if a subsystem is ever attached elsewhere), and reveal debris only if
  // the target itself is a debris piece - otherwise default to detail 0 / debris
  // hidden, which is what makes a real capital ship's many stacked LOD hulls and debris
  // chunks actually legible.
  const targetClassification = classifications.get(msg.targetSubmodelIndex);
  selectedDetailLevel = targetClassification && targetClassification.detailLevel >= 0 ? targetClassification.detailLevel : 0;
  showDebris = targetClassification?.isDebris ?? false;

  const hasDebris = Array.from(classifications.values()).some((c) => c.isDebris);
  buildControls(msg.detailLevelCount, hasDebris);
  updateVisibility();
  applyHighlight(msg.targetSubmodelIndex);

  camera.position.set(boundingRadius * 1.5, boundingRadius * 1.2, boundingRadius * 1.5);
  camera.far = boundingRadius * 20;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}

/**
 * Recolors the previously-highlighted mesh back to normal and the newly-targeted one to
 * the highlight color, moving the wireframe overlay to match - all in place, with no
 * scene rebuild and no camera changes. This is what lets re-triggering F12 on a
 * different `$Subsystem:` of the same, already-open model update in place instead of
 * visibly "reloading" (which previously also reset the user's camera angle/zoom every
 * time - see pofViewer.ts's fingerprint()-based dispatch).
 *
 * Also switches the active detail-level/debris-visibility selection if needed so the
 * newly-highlighted submodel is actually visible - otherwise F12'ing a subsystem that
 * happens to live on a currently-hidden detail level (or a debris piece, while debris
 * is hidden) would silently highlight something the user can't see.
 */
function applyHighlight(targetSubmodelIndex: number): void {
  if (!scene || !currentGroup || !currentMeshes) {
    return;
  }

  const classification = currentClassifications?.get(targetSubmodelIndex);
  let visibilityChanged = false;
  if (classification) {
    if (classification.detailLevel >= 0 && classification.detailLevel !== selectedDetailLevel) {
      selectedDetailLevel = classification.detailLevel;
      const radio = detailRadios[classification.detailLevel];
      if (radio) radio.checked = true;
      visibilityChanged = true;
    }
    if (classification.isDebris && !showDebris) {
      showDebris = true;
      if (debrisCheckbox) debrisCheckbox.checked = true;
      visibilityChanged = true;
    }
  }
  if (visibilityChanged) {
    updateVisibility();
  }

  if (targetSubmodelIndex === currentTargetIndex) {
    return;
  }

  const previous = currentMeshes.get(currentTargetIndex);
  if (previous) {
    const mat = previous.material as THREE.MeshStandardMaterial;
    mat.color.setHex(NORMAL_COLOR);
    mat.emissive.setHex(0x000000);
  }

  if (currentWireframe) {
    currentGroup.remove(currentWireframe);
    currentWireframe.geometry.dispose();
    (currentWireframe.material as THREE.Material).dispose();
    currentWireframe = null;
  }

  const target = currentMeshes.get(targetSubmodelIndex);
  if (target) {
    const mat = target.material as THREE.MeshStandardMaterial;
    mat.color.setHex(HIGHLIGHT_COLOR);
    mat.emissive.setHex(HIGHLIGHT_EMISSIVE);

    const wireGeo = new THREE.WireframeGeometry(target.geometry);
    currentWireframe = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
    currentWireframe.position.copy(target.position);
    currentWireframe.visible = target.visible;
    currentGroup.add(currentWireframe);
  }

  currentTargetIndex = targetSubmodelIndex;
}

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as GeometryMessage | HighlightMessage | undefined;
  if (msg && msg.type === "geometry") {
    renderGeometry(msg);
  } else if (msg && msg.type === "highlight") {
    applyHighlight(msg.targetSubmodelIndex);
  }
});

const vscodeApi = acquireVsCodeApi();
vscodeApi.postMessage({ type: "ready" });
