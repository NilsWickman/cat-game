import * as CANNON from "cannon-es";
import * as THREE from "three";
import type { FurnitureId } from "../game/economy";
import type { Physics, SurfaceId } from "./physics";
import { canvasTexture, part, toon } from "./toon";

export const ROOM_HALF = 4;

/** A table or shelf top the cats can jump onto and knock things off. */
export interface Surface {
  id: SurfaceId;
  top: THREE.Vector3;
  approach: THREE.Vector3;
  stand(item: THREE.Vector3): THREE.Vector3;
  outward(item: THREE.Vector3): THREE.Vector3;
}

export interface Spot {
  pos: THREE.Vector3;
  approach: THREE.Vector3;
  /** Heading the cat faces when settled (0 = +z, towards the open side). */
  facing: number;
}

interface Obstacle {
  x: number;
  z: number;
  r: number;
  furniture?: FurnitureId;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function box(w: number, h: number, d: number, color: string, outline = 0.015) {
  return part(new THREE.BoxGeometry(w, h, d), toon(color), outline);
}

function cyl(rt: number, rb: number, h: number, color: string, outline = 0.015, seg = 20) {
  return part(new THREE.CylinderGeometry(rt, rb, h, seg), toon(color), outline);
}

function sphere(r: number, color: string, outline = 0.015) {
  return part(new THREE.SphereGeometry(r, 20, 14), toon(color), outline);
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

function lathe(points: [number, number][], color: string) {
  const geo = new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), 24);
  return part(geo, toon(color), 0.012);
}

export class Room {
  readonly group = new THREE.Group();
  readonly furniture = new Map<FurnitureId, THREE.Group>();
  readonly owned = new Set<FurnitureId>();
  readonly surfaces: Record<SurfaceId, Surface>;
  readonly spots: Record<"box" | "cushion" | "bowl" | "aquarium" | "treeLow" | "treeTop", Spot>;
  readonly obstacles: Obstacle[] = [];
  readonly fish: { mesh: THREE.Object3D; phase: number; speed: number; y: number }[] = [];

  readonly skyUniforms = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
  readonly stars: THREE.Points;
  readonly sunDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  readonly moonDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  readonly sunPatch: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly lampLight = new THREE.PointLight(0xffc77a, 0, 10, 1.4);
  readonly lampShade: THREE.MeshToonMaterial;

  private clockHour = new THREE.Group();
  private clockMinute = new THREE.Group();
  private pompom = new THREE.Group();
  private pompomAngle = 0;
  private pompomVel = 0;
  private yarnMesh: THREE.Group;

  constructor(private physics: Physics) {
    const g = this.group;
    this.buildShell();

    // Window with sky, sun/moon and stars behind the glass
    const win = at(new THREE.Group(), 0.8, 2.5, -4);
    g.add(win);
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 1.6),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec2 vUv;
          void main(){ gl_FragColor = vec4(mix(bottom, top, vUv.y), 1.0);
          #include <colorspace_fragment>
          }`,
      }),
    );
    sky.position.z = 0.005;
    win.add(sky);
    const starPts: number[] = [];
    for (let i = 0; i < 28; i++) starPts.push((Math.random() - 0.5) * 1.9, (Math.random() - 0.2) * 1.4 - 0.1, 0.01);
    this.stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(starPts, 3)),
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true }),
    );
    win.add(this.stars);
    this.sunDisc = at(new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true })), -0.45, 0.4, 0.012);
    this.moonDisc = at(new THREE.Mesh(new THREE.CircleGeometry(0.14, 24), new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true })), 0.5, 0.45, 0.012);
    win.add(this.sunDisc, this.moonDisc);
    const frameColor = "#fdf8f2";
    win.add(
      at(box(2.24, 0.12, 0.14, frameColor), 0, 0.86, 0.07),
      at(box(2.24, 0.12, 0.14, frameColor), 0, -0.86, 0.07),
      at(box(0.12, 1.6, 0.14, frameColor), -1.06, 0, 0.07),
      at(box(0.12, 1.6, 0.14, frameColor), 1.06, 0, 0.07),
      at(box(0.06, 1.6, 0.06, frameColor, 0.008), 0, 0, 0.04),
      at(box(2, 0.06, 0.06, frameColor, 0.008), 0, 0.1, 0.04),
      at(box(2.5, 0.08, 0.32, frameColor), 0, -0.96, 0.16),
      at(box(0.42, 2.1, 0.08, "#d9786a"), -1.42, -0.05, 0.12),
      at(box(0.42, 2.1, 0.08, "#d9786a"), 1.42, -0.05, 0.12),
      at(cyl(0.025, 0.025, 3.4, "#8a6a4f", 0.008).rotateZ(Math.PI / 2), 0, 1.02, 0.14),
    );
    this.sunPatch = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 1.8),
      new THREE.MeshBasicMaterial({ color: 0xfff1c2, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.sunPatch.rotation.x = -Math.PI / 2;
    this.sunPatch.position.set(0.5, 0.012, -2.7);
    g.add(this.sunPatch);

    this.buildWallDecor();

    // Side table, always present, with three knockable items
    const table = at(new THREE.Group(), -2.6, 0, -1.2);
    table.add(at(box(1.4, 0.1, 0.9, "#b9805a"), 0, 0.95, 0));
    for (const [x, z] of [[-0.6, -0.36], [0.6, -0.36], [-0.6, 0.36], [0.6, 0.36]]) {
      table.add(at(cyl(0.05, 0.04, 0.9, "#a46d4a"), x, 0.45, z));
    }
    g.add(table);
    physics.setStatic("table", true, v(-2.6, 0.95, -1.2), v(0.7, 0.05, 0.45));
    this.obstacles.push({ x: -2.6, z: -1.2, r: 0.95 });
    this.addTableItems();

    this.surfaces = {
      table: {
        id: "table",
        top: v(-2.6, 1.0, -1.2),
        approach: v(-1.35, 0, -1.0),
        outward: (item) => v(item.x + 2.6, 0, item.z + 1.2).normalize(),
        stand: (item) => {
          const out = v(item.x + 2.6, 0, item.z + 1.2).normalize();
          return v(item.x - out.x * 0.5, 1.0, item.z - out.z * 0.5);
        },
      },
      shelf: {
        id: "shelf",
        top: v(-2.0, 1.6, -3.55),
        approach: v(-2.0, 0, -2.35),
        outward: () => v(0, 0, 1),
        stand: (item) => v(item.x + (item.x < -2.0 ? 0.55 : -0.55), 1.6, -3.55),
      },
    };
    this.spots = {
      box: { pos: v(2.1, 0.04, -3.0), approach: v(2.1, 0, -1.9), facing: 0 },
      cushion: { pos: v(0.5, 0.22, -3.2), approach: v(0.5, 0, -2.1), facing: 0 },
      bowl: { pos: v(-1.2, 0, 2.45), approach: v(-1.2, 0, 2.0), facing: 0 },
      aquarium: { pos: v(-2.5, 0, 1.0), approach: v(-2.0, 0, 1.0), facing: -Math.PI / 2 },
      treeLow: { pos: v(2.4, 1.16, 0.35), approach: v(1.6, 0, 0.9), facing: -0.6 },
      treeTop: { pos: v(3.1, 2.26, -0.2), approach: v(1.6, 0, 0.9), facing: -0.8 },
    };

    this.buildFurniture();
    this.lampShade = (this.furniture.get("lamp")!.userData.shade as THREE.Mesh).material as THREE.MeshToonMaterial;
    this.yarnMesh = this.furniture.get("yarn")!;
    this.lampLight.position.set(-3.4, 2.45, -3.4);
    g.add(this.lampLight);
    this.setOwned([]);
  }

  private buildShell() {
    const g = this.group;
    const planks = canvasTexture(512, 512, (ctx, w, h) => {
      const rows = 8;
      const rh = h / rows;
      for (let r = 0; r < rows; r++) {
        let x = -Math.random() * 200;
        while (x < w) {
          const len = 160 + Math.random() * 220;
          ctx.fillStyle = `hsl(${26 + Math.random() * 6}, ${42 + Math.random() * 10}%, ${58 + Math.random() * 7}%)`;
          ctx.fillRect(x, r * rh, len, rh);
          ctx.fillStyle = "rgba(90,50,30,0.35)";
          ctx.fillRect(x, r * rh, 2, rh);
          x += len;
        }
        ctx.fillStyle = "rgba(90,50,30,0.4)";
        ctx.fillRect(0, r * rh, w, 2);
      }
      ctx.strokeStyle = "rgba(120,70,40,0.12)";
      for (let i = 0; i < 80; i++) {
        const y = Math.random() * h;
        ctx.beginPath();
        ctx.moveTo(Math.random() * w, y);
        ctx.lineTo(Math.random() * w, y + (Math.random() - 0.5) * 4);
        ctx.stroke();
      }
    });
    planks.wrapS = planks.wrapT = THREE.RepeatWrapping;
    planks.repeat.set(2, 2);
    const side = toon("#8a5a3c");
    const floor = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.3, 8.4), [side, side, toon("#fff", planks), side, side, side]);
    floor.position.y = -0.15;
    floor.receiveShadow = true;
    g.add(floor);

    const paper = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#f4e0cf";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#eed2bf";
      for (let x = 0; x < w; x += 64) ctx.fillRect(x, 0, 22, h);
      ctx.fillStyle = "#e9b9a6";
      for (let y = 16; y < h; y += 64) {
        for (let x = 43; x < w; x += 64) {
          ctx.beginPath();
          ctx.arc(x, y + ((x / 64) % 2) * 32, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    paper.wrapS = paper.wrapT = THREE.RepeatWrapping;
    paper.repeat.set(4, 2.3);
    const wallFace = toon("#fff", paper);
    const wallSide = toon("#e6c9b4");
    const wallTop = toon("#b98d74");
    const back = new THREE.Mesh(new THREE.BoxGeometry(8.4, 4.6, 0.2), [wallSide, wallSide, wallTop, wallSide, wallFace, wallSide]);
    back.position.set(0, 2.3, -4.1);
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.6, 8.3), [wallFace, wallSide, wallTop, wallSide, wallSide, wallSide]);
    left.position.set(-4.1, 2.3, 0.05);
    for (const w of [back, left]) {
      w.receiveShadow = true;
      g.add(w);
    }
    g.add(
      at(box(8.0, 0.2, 0.05, "#fbf4ec", 0.008), 0.2, 0.1, -3.975),
      at(box(0.05, 0.2, 8.0, "#fbf4ec", 0.008), -3.975, 0.1, 0.2),
    );

    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(1.8, 48),
      toon(
        "#fff",
        canvasTexture(256, 256, (ctx, w) => {
          const colors = ["#d36b5d", "#f2d49b", "#7fb7a4", "#f2d49b", "#d36b5d", "#f6e7cf"];
          colors.forEach((c, i) => {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(w / 2, w / 2, (w / 2) * (1 - i / colors.length), 0, Math.PI * 2);
            ctx.fill();
          });
        }),
      ),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.3, 0.006, 0.7);
    rug.receiveShadow = true;
    g.add(rug);
  }

  private buildWallDecor() {
    const g = this.group;
    // A framed fish picture above the table
    const pic = at(new THREE.Group(), -3.97, 2.55, -1.2);
    pic.add(at(box(0.06, 1.0, 0.8, "#8a5a3c"), 0, 0, 0));
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(0.66, 0.86),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(128, 160, (ctx, w, h) => {
          ctx.fillStyle = "#cfe8ef";
          ctx.fillRect(0, 0, w, h);
          ctx.font = "72px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("🐟", w / 2, h / 2);
        }),
      }),
    );
    art.rotation.y = Math.PI / 2;
    art.position.x = 0.035;
    pic.add(art);
    g.add(pic);

    // Wall clock that shows the in-game time
    const clock = at(new THREE.Group(), -2.0, 3.45, -3.97);
    clock.add(at(cyl(0.36, 0.36, 0.06, "#fdf8f2").rotateX(Math.PI / 2), 0, 0, 0));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 32), toon("#c4644f"));
    clock.add(ring);
    const hand = (len: number, w: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.02), new THREE.MeshBasicMaterial({ color: 0x3b2a2a }));
      m.position.y = len / 2;
      return m;
    };
    this.clockHour.add(hand(0.17, 0.035));
    this.clockMinute.add(hand(0.27, 0.022));
    this.clockHour.position.z = this.clockMinute.position.z = 0.04;
    clock.add(this.clockHour, this.clockMinute);
    g.add(clock);
  }

  private addTableItems() {
    const add = (mesh: THREE.Object3D, shape: CANNON.Shape, half: number, home: THREE.Vector3, surface: SurfaceId) => {
      this.group.add(mesh);
      return this.physics.addItem(mesh, shape, half, home, surface);
    };

    const mug = new THREE.Group();
    mug.add(cyl(0.12, 0.11, 0.22, "#5fa8d3", 0.012));
    mug.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), toon("#5a3b2a")).rotateX(-Math.PI / 2), 0, 0.1, 0));
    mug.add(at(part(new THREE.TorusGeometry(0.065, 0.02, 8, 16), toon("#5fa8d3"), 0.008), 0.13, 0, 0));
    add(mug, new CANNON.Cylinder(0.12, 0.12, 0.22, 10), 0.11, v(-2.08, 1.11, -1.02), "table");

    const vase = new THREE.Group();
    vase.add(at(lathe([[0.001, 0], [0.09, 0.01], [0.13, 0.12], [0.12, 0.22], [0.06, 0.33], [0.07, 0.4]], "#e07a5f"), 0, -0.2, 0));
    vase.add(at(cyl(0.008, 0.008, 0.2, "#4f8a3c", 0.004, 6), 0, 0.28, 0));
    vase.add(at(sphere(0.06, "#f6c945", 0.008), 0, 0.4, 0));
    add(vase, new CANNON.Cylinder(0.11, 0.11, 0.4, 10), 0.2, v(-2.7, 1.2, -0.9), "table");

    const cactus = new THREE.Group();
    cactus.add(at(cyl(0.11, 0.08, 0.16, "#c96f4a", 0.012), 0, -0.08, 0));
    cactus.add(at(part(new THREE.CapsuleGeometry(0.065, 0.14, 4, 10), toon("#6aa84f"), 0.01), 0, 0.09, 0));
    cactus.add(at(part(new THREE.CapsuleGeometry(0.035, 0.06, 4, 8), toon("#6aa84f"), 0.008), 0.08, 0.1, 0).rotateZ(-0.9));
    add(cactus, new CANNON.Cylinder(0.11, 0.11, 0.32, 10), 0.16, v(-2.25, 1.16, -1.5), "table");
  }

  private furn(id: FurnitureId, x: number, z: number, obstacle?: number): THREE.Group {
    const grp = at(new THREE.Group(), x, 0, z);
    this.group.add(grp);
    this.furniture.set(id, grp);
    if (obstacle) this.obstacles.push({ x, z, r: obstacle, furniture: id });
    return grp;
  }

  private buildFurniture() {
    // Cardboard box
    const bx = this.furn("box", 2.1, -3.0, 0.85);
    const card = "#c89b5e";
    bx.add(
      at(box(1.25, 0.04, 1.05, "#a87b45"), 0, 0.02, 0),
      at(box(1.25, 0.45, 0.04, card), 0, 0.225, 0.505),
      at(box(1.25, 0.45, 0.04, card), 0, 0.225, -0.505),
      at(box(0.04, 0.45, 1.05, card), 0.605, 0.225, 0),
      at(box(0.04, 0.45, 1.05, card), -0.605, 0.225, 0),
      at(box(1.25, 0.02, 0.34, "#d4a96c"), 0, 0.5, 0.63).rotateX(0.9),
      at(box(1.25, 0.02, 0.34, "#d4a96c"), 0, 0.5, -0.63).rotateX(-0.9),
    );

    // Yarn ball (physics body is managed by setOwned)
    const yarn = this.furn("yarn", 1.2, 1.7);
    yarn.position.y = 0.2;
    yarn.add(sphere(0.2, "#e2566f", 0.014));
    for (let i = 0; i < 4; i++) {
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 32), toon("#b83a55"));
      wrap.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      yarn.add(wrap);
    }

    // Floor lamp
    const lamp = this.furn("lamp", -3.4, -3.4, 0.5);
    lamp.add(at(cyl(0.3, 0.35, 0.06, "#4a4a52"), 0, 0.03, 0), at(cyl(0.035, 0.035, 2.6, "#4a4a52", 0.01), 0, 1.33, 0));
    const shade = at(cyl(0.22, 0.42, 0.45, "#f6e7c1"), 0, 2.6, 0);
    lamp.add(shade);
    lamp.userData.shade = shade;

    // Food bowl on a mat
    const bowl = this.furn("bowl", -1.2, 3.1, 0.55);
    bowl.add(at(cyl(0.45, 0.45, 0.02, "#8fc1a9", 0.01, 32), 0, 0.01, 0));
    bowl.add(at(lathe([[0.001, 0], [0.2, 0], [0.29, 0.14], [0.25, 0.15], [0.19, 0.04], [0.001, 0.04]], "#3d8eb9"), 0, 0.02, 0));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      bowl.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), toon("#9a5b34")), Math.cos(a) * 0.11, 0.1, Math.sin(a) * 0.11));
    }

    // Sun cushion under the window
    const cushion = this.furn("cushion", 0.5, -3.2);
    cushion.add(at(part(new THREE.SphereGeometry(1, 32, 16).scale(0.78, 0.17, 0.62), toon("#f2c14e"), 0.015), 0, 0.12, 0));
    cushion.add(at(part(new THREE.TorusGeometry(0.66, 0.035, 8, 40).scale(1, 0.8, 1).rotateX(Math.PI / 2), toon("#e09a3b"), 0.008), 0, 0.12, 0));

    // Monstera
    const plant = this.furn("plant", -3.35, -2.5, 0.6);
    plant.add(at(cyl(0.32, 0.25, 0.55, "#e9e2d6"), 0, 0.275, 0), at(cyl(0.29, 0.29, 0.02, "#5a3b2a", 0, 20), 0, 0.53, 0));
    const leafGeo = new THREE.SphereGeometry(1, 16, 8).scale(0.34, 0.025, 0.22).translate(0.3, 0, 0);
    for (let i = 0; i < 8; i++) {
      const stem = new THREE.Group();
      stem.position.y = 0.5;
      stem.rotation.y = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      const h = 0.5 + Math.random() * 0.8;
      stem.add(at(cyl(0.012, 0.012, h, "#3d7a45", 0, 5), 0, h / 2, 0));
      const leaf = at(part(leafGeo, toon(i % 2 ? "#3f8f4f" : "#4fa25c"), 0.01), 0, h, 0);
      leaf.rotation.z = -0.35 - Math.random() * 0.4;
      stem.add(leaf);
      plant.add(stem);
    }

    // Cat tree
    const tree = this.furn("tree", 2.8, 0.1, 0.95);
    const sisal = toon(
      "#fff",
      canvasTexture(64, 64, (ctx, w, h) => {
        ctx.fillStyle = "#dcc391";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#b99c66";
        for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2);
      }),
    );
    (sisal.map as THREE.Texture).wrapS = (sisal.map as THREE.Texture).wrapT = THREE.RepeatWrapping;
    (sisal.map as THREE.Texture).repeat.set(2, 8);
    tree.add(at(box(1.3, 0.12, 1.2, "#b88c6a"), 0, 0.06, 0));
    tree.add(at(part(new THREE.CylinderGeometry(0.13, 0.13, 2.2, 16), sisal, 0.012), 0.3, 1.1, -0.3));
    tree.add(at(part(new THREE.CylinderGeometry(0.11, 0.11, 1.1, 16), sisal, 0.012), -0.4, 0.55, 0.25));
    tree.add(at(cyl(0.42, 0.42, 0.1, "#b88c6a", 0.015, 28), -0.4, 1.1, 0.25));
    tree.add(at(cyl(0.5, 0.5, 0.1, "#b88c6a", 0.015, 28), 0.3, 2.2, -0.3));
    tree.add(at(part(new THREE.TorusGeometry(0.46, 0.07, 8, 28).rotateX(Math.PI / 2), toon("#9c7253"), 0.01), 0.3, 2.27, -0.3));
    this.pompom.position.set(-0.75, 1.05, 0.25);
    this.pompom.add(at(cyl(0.006, 0.006, 0.45, "#555", 0, 4), 0, -0.22, 0), at(sphere(0.07, "#ff8fb1", 0.01), 0, -0.47, 0));
    tree.add(this.pompom);

    // Wall shelf with three more knockables
    const shelf = this.furn("shelf", 0, 0);
    shelf.add(at(box(2.0, 0.08, 0.9, "#a4714b"), -2.0, 1.56, -3.55));
    for (const x of [-2.7, -1.3]) shelf.add(at(box(0.08, 0.35, 0.5, "#8a5a3c"), x, 1.35, -3.75));
    const books = new THREE.Group();
    ["#c0504d", "#4f81bd", "#9bbb59"].forEach((c, i) => books.add(at(box(0.3 - i * 0.03, 0.075, 0.2, c, 0.008), 0, -0.08 + i * 0.08, 0)));
    const globe = new THREE.Group();
    globe.add(sphere(0.13, "#9ed3e6", 0.01), at(sphere(0.06, "#ffffff", 0), 0.02, -0.05, 0.02));
    const jar = new THREE.Group();
    jar.add(cyl(0.09, 0.09, 0.2, "#a7d8c9", 0.01), at(cyl(0.095, 0.095, 0.05, "#d9a441", 0.008), 0, 0.12, 0));
    const shelfItems: [THREE.Object3D, CANNON.Shape, number, THREE.Vector3][] = [
      [books, new CANNON.Box(new CANNON.Vec3(0.15, 0.12, 0.1)), 0.12, v(-2.75, 1.72, -3.25)],
      [globe, new CANNON.Sphere(0.13), 0.13, v(-1.65, 1.73, -3.28)],
      [jar, new CANNON.Cylinder(0.09, 0.09, 0.25, 10), 0.125, v(-1.25, 1.725, -3.3)],
    ];
    for (const [mesh, shape, half, home] of shelfItems) {
      this.group.add(mesh);
      this.physics.addItem(mesh, shape, half, home, "shelf");
    }

    // Aquarium on a stand against the left wall
    const aq = this.furn("aquarium", -3.55, 1.0);
    this.obstacles.push({ x: -3.55, z: 0.5, r: 0.7, furniture: "aquarium" }, { x: -3.55, z: 1.5, r: 0.7, furniture: "aquarium" });
    aq.add(at(box(0.7, 0.85, 1.6, "#6b4f3a"), 0, 0.425, 0));
    aq.add(at(box(0.58, 0.08, 1.48, "#d9c6a0", 0), 0, 0.89, 0));
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.8, 1.5),
      new THREE.MeshBasicMaterial({ color: 0x7cc7e0, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    water.position.y = 1.25;
    aq.add(water);
    aq.add(at(box(0.66, 0.05, 1.56, "#2f3640", 0.008), 0, 1.7, 0));
    for (const z of [-0.5, 0.45]) {
      aq.add(at(part(new THREE.CapsuleGeometry(0.04, 0.3, 4, 8), toon("#3f9f5a"), 0.008), 0, 1.1, z));
    }
    for (let i = 0; i < 3; i++) {
      const fish = new THREE.Group();
      const col = ["#ff8c3a", "#ffd23f", "#ff5d73"][i];
      fish.add(part(new THREE.SphereGeometry(1, 12, 8).scale(0.03, 0.06, 0.1), toon(col), 0.008));
      fish.add(at(part(new THREE.ConeGeometry(0.05, 0.07, 6).rotateX(Math.PI / 2).scale(0.4, 1, 1), toon(col), 0.006), 0, 0, -0.12));
      aq.add(fish);
      this.fish.push({ mesh: fish, phase: i * 2.1, speed: 0.5 + i * 0.15, y: 1.05 + i * 0.18 });
    }
  }

  setOwned(ids: FurnitureId[]) {
    this.owned.clear();
    for (const id of ids) this.owned.add(id);
    for (const [id, grp] of this.furniture) grp.visible = this.owned.has(id);
    const has = (id: FurnitureId) => this.owned.has(id);
    this.physics.setStatic("box", has("box"), v(2.1, 0.225, -3.0), v(0.625, 0.225, 0.525));
    this.physics.setStatic("shelf", has("shelf"), v(-2.0, 1.56, -3.55), v(1.0, 0.04, 0.45));
    this.physics.setStatic("aquarium", has("aquarium"), v(-3.55, 0.875, 1.0), v(0.35, 0.875, 0.8));
    this.physics.setStatic("tree", has("tree"), v(2.8, 0.06, 0.1), v(0.65, 0.06, 0.6));
    for (const item of this.physics.items) {
      if (item.surface === "shelf") this.physics.setItemEnabled(item, has("shelf"));
    }
    if (has("yarn") && !this.physics.yarn) this.physics.setYarn(this.yarnMesh, 0.2);
    if (!has("yarn") && this.physics.yarn) this.physics.setYarn(null);
  }

  isBlocked(x: number, z: number, margin = 0.35): boolean {
    return this.obstacles.some(
      (o) => (!o.furniture || this.owned.has(o.furniture)) && Math.hypot(x - o.x, z - o.z) < o.r + margin,
    );
  }

  randomFloorPoint(): THREE.Vector3 {
    for (let i = 0; i < 30; i++) {
      const x = (Math.random() * 2 - 1) * 3.3;
      const z = (Math.random() * 2 - 1) * 3.3;
      if (!this.isBlocked(x, z)) return v(x, 0, z);
    }
    return v(0.5, 0, 1);
  }

  /** Where the pom-pom hangs, for a cat on the low platform to bat at. */
  readonly pompomPos = v(2.05, 0.6, 0.35);
  /** Tall post of the cat tree, for scratching (the cat stands on the base slab). */
  readonly scratchPost = v(3.1, 0, -0.2);
  readonly scratchStand = v(2.84, 0.12, 0.06);
  readonly rugCenter = v(0.3, 0, 0.7);

  batPompom(strength: number) {
    this.pompomVel += strength;
  }

  update(t: number, hours: number) {
    for (const f of this.fish) {
      const a = t * f.speed + f.phase;
      f.mesh.position.set(Math.sin(a * 1.7) * 0.12, f.y + Math.sin(a * 2.3) * 0.05, Math.sin(a) * 0.55);
      f.mesh.rotation.y = Math.cos(a) > 0 ? 0 : Math.PI;
    }
    this.clockHour.rotation.z = -((hours % 12) / 12) * Math.PI * 2;
    this.clockMinute.rotation.z = -(hours % 1) * Math.PI * 2;
    // Damped pendulum, with a lazy idle sway
    const dt = Math.min(0.05, t - this.lastT);
    this.lastT = t;
    this.pompomVel += (-18 * this.pompomAngle - 1.2 * this.pompomVel) * dt;
    this.pompomAngle += this.pompomVel * dt;
    this.pompom.rotation.z = this.pompomAngle + Math.sin(t * 1.3) * 0.06;
  }

  private lastT = 0;
}
