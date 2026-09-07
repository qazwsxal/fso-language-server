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
}

interface GeometryMessage {
  type: "geometry";
  modelFile: string;
  targetSubmodelIndex: number;
  submodels: SubmodelPayload[];
}

declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (s: unknown) => void;
};

let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let controls: OrbitControls | null = null;
let currentGroup: THREE.Group | null = null;

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
      color: isTarget ? 0xffcc33 : 0x8899aa,
      emissive: isTarget ? 0x664400 : 0x000000,
      metalness: 0.1,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(worldOffset[0], worldOffset[1], worldOffset[2]);
    group.add(mesh);

    if (isTarget) {
      const wireGeo = new THREE.WireframeGeometry(geometry);
      const wireframe = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
      wireframe.position.copy(mesh.position);
      group.add(wireframe);
    }

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

  camera.position.set(boundingRadius * 1.5, boundingRadius * 1.2, boundingRadius * 1.5);
  camera.far = boundingRadius * 20;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as GeometryMessage | undefined;
  if (msg && msg.type === "geometry") {
    renderGeometry(msg);
  }
});

const vscodeApi = acquireVsCodeApi();
vscodeApi.postMessage({ type: "ready" });
