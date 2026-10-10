import * as THREE from "three";

let gradient: THREE.DataTexture | null = null;

/** Three-step ramp that gives MeshToonMaterial its cel-shaded look. */
function gradientMap(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export function toon(color: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color: map ? 0xffffff : color, map: map ?? null, gradientMap: gradientMap() });
}

const outlineCache = new Map<number, THREE.ShaderMaterial>();

/** Inverted-hull outline: back faces pushed out along the normal, drawn flat dark. */
function outlineMaterial(thickness: number): THREE.ShaderMaterial {
  let m = outlineCache.get(thickness);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { thickness: { value: thickness }, color: { value: new THREE.Color(0x3b2a2a) } },
      vertexShader: /* glsl */ `
        uniform float thickness;
        void main() {
          vec3 p = position + normal * thickness;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        void main() { gl_FragColor = vec4(color, 1.0); }`,
      side: THREE.BackSide,
    });
    outlineCache.set(thickness, m);
  }
  return m;
}

export function addOutline(mesh: THREE.Mesh, thickness = 0.018): THREE.Mesh {
  const hull = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness));
  hull.raycast = () => {};
  hull.userData.outline = true;
  mesh.add(hull);
  return mesh;
}

/** Toon mesh with an outline that casts and receives shadows. */
export function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  outline = 0.018,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (outline > 0) addOutline(mesh, outline);
  return mesh;
}

export function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function shade(hex: string, factor: number): string {
  const c = new THREE.Color(hex);
  if (factor < 1) c.multiplyScalar(factor);
  else c.lerp(new THREE.Color(0xffffff), factor - 1);
  return "#" + c.getHexString();
}
