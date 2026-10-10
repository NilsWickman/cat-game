import * as THREE from "three";
import type { CatData } from "../game/state";
import { canvasTexture, part, shade, toon } from "../scene/toon";

/** Blendable animation targets. The brain sets them, Cat smooths them, the model renders them. */
export interface Pose {
  sit: number;
  lie: number;
  crouch: number;
  wiggle: number;
  walk: number;
  jump: number;
  eyesClosed: number;
  earsBack: number;
  swat: number;
  eat: number;
  tailUp: number;
  tailSpeed: number;
  tailAmp: number;
  headYaw: number;
  headPitch: number;
  headTilt: number;
  /** 0 upright, 0.5 flopped on its side, 1 belly-up. */
  roll: number;
  /** Which side to roll toward (-1 or 1). */
  rollSide: number;
  /** Bicycling paws in the air. */
  paddle: number;
  /** Alternating front paws, "making biscuits". */
  knead: number;
  /** Front-down, rear-up stretch after waking. */
  stretch: number;
  /** Tail wrapped around the front paws while sitting. */
  wrap: number;
  mouth: number;
  /** Fine body tremble while purring. */
  shake: number;
}

export const neutralPose = (): Pose => ({
  sit: 0, lie: 0, crouch: 0, wiggle: 0, walk: 0, jump: 0, eyesClosed: 0, earsBack: 0, swat: 0, eat: 0,
  tailUp: 0.6, tailSpeed: 0.8, tailAmp: 0.25, headYaw: 0, headPitch: 0, headTilt: 0,
  roll: 0, rollSide: 1, paddle: 0, knead: 0, stretch: 0, wrap: 0, mouth: 0, shake: 0,
});

const PINK = "#f2a7b2";
const NOSE = "#e27d90";
const WHITE = "#f6f1ea";
const DARK = "#3a302c";

interface Look {
  body: THREE.Texture;
  head: THREE.Texture;
  ears: [string, string];
  leg: string;
  paw: string;
  muzzle: string;
  chest: string;
  tail: string[];
}

function seeded(id: string): () => number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Body texture space (sphere rotated to lie along z): canvas y=0 is the chest, y=H the rump,
 * x=0.75W runs along the spine and x=0.25W along the belly.
 * Head texture space: y=0 is the crown, x=0.25W is the face.
 */
function coatLook(data: CatData): Look {
  const base = data.color;
  const rng = seeded(data.id);
  const tailN = 9;
  const W = 256, H = 128;

  switch (data.coat) {
    case "tabby": {
      const stripe = shade(base, 0.62);
      return {
        body: canvasTexture(W, H, (ctx) => {
          ctx.fillStyle = base;
          ctx.fillRect(0, 0, W, H);
          blob(ctx, 0.25 * W, 0.45 * H, 0.16 * W, 0.5 * H, shade(base, 1.25));
          ctx.strokeStyle = stripe;
          ctx.lineCap = "round";
          ctx.lineWidth = H * 0.05;
          for (let i = 0; i < 7; i++) {
            const y = H * (0.16 + i * 0.11);
            for (const off of [0, -W]) {
              ctx.beginPath();
              ctx.moveTo(0.44 * W + off, y + 4);
              ctx.quadraticCurveTo(0.6 * W + off, y - 6, 0.75 * W + off, y + 2);
              ctx.quadraticCurveTo(0.9 * W + off, y + 8, 1.06 * W + off, y - 2);
              ctx.stroke();
            }
          }
          ctx.lineWidth = H * 0.07;
          ctx.beginPath();
          ctx.moveTo(0.75 * W, 0.12 * H);
          ctx.lineTo(0.75 * W, H);
          ctx.stroke();
        }),
        head: canvasTexture(W, H, (ctx) => {
          ctx.fillStyle = base;
          ctx.fillRect(0, 0, W, H);
          blob(ctx, 0.25 * W, 0.85 * H, 0.14 * W, 0.3 * H, shade(base, 1.3));
          ctx.strokeStyle = stripe;
          ctx.lineCap = "round";
          ctx.lineWidth = 5;
          for (const dx of [-0.035, 0, 0.035]) {
            ctx.beginPath();
            ctx.moveTo((0.25 + dx) * W, 0.1 * H);
            ctx.lineTo((0.25 + dx * 0.6) * W, 0.33 * H);
            ctx.stroke();
          }
          for (const x of [0.1, 0.4]) {
            for (const y of [0.5, 0.6]) {
              ctx.beginPath();
              ctx.moveTo(x * W - 12, y * H);
              ctx.lineTo(x * W + 12, y * H - 3);
              ctx.stroke();
            }
          }
        }),
        ears: [base, base],
        leg: base,
        paw: shade(base, 1.2),
        muzzle: shade(base, 1.45),
        chest: shade(base, 1.3),
        tail: Array.from({ length: tailN }, (_, i) => (i % 2 ? stripe : base)),
      };
    }
    case "tuxedo":
      return {
        body: canvasTexture(W, H, (ctx) => {
          ctx.fillStyle = base;
          ctx.fillRect(0, 0, W, H);
          ctx.filter = "blur(3px)";
          blob(ctx, 0.25 * W, 0.2 * H, 0.17 * W, 0.55 * H, WHITE);
        }),
        head: canvasTexture(W, H, (ctx) => {
          ctx.fillStyle = base;
          ctx.fillRect(0, 0, W, H);
          ctx.filter = "blur(2px)";
          blob(ctx, 0.25 * W, 0.92 * H, 0.15 * W, 0.36 * H, WHITE);
          blob(ctx, 0.25 * W, 0.5 * H, 0.02 * W, 0.2 * H, WHITE);
        }),
        ears: [base, base],
        leg: base,
        paw: WHITE,
        muzzle: WHITE,
        chest: WHITE,
        tail: Array(tailN).fill(base),
      };
    case "calico": {
      const dark = DARK;
      return {
        body: canvasTexture(W, H, (ctx) => {
          ctx.fillStyle = WHITE;
          ctx.fillRect(0, 0, W, H);
          for (let i = 0; i < 9; i++) {
            const x = (0.45 + rng() * 0.6) * W;
            blob(ctx, x, rng() * H, (0.05 + rng() * 0.08) * W, (0.12 + rng() * 0.15) * H, i % 2 ? base : dark);
            blob(ctx, x - W, rng() * H, 0.06 * W, 0.12 * H, i % 2 ? dark : base);
          }
        }),
        head: canvasTexture(W, H, (ctx) => {
          ctx.fillStyle = WHITE;
          ctx.fillRect(0, 0, W, H);
          blob(ctx, 0.12 * W, 0.25 * H, 0.14 * W, 0.4 * H, base);
          blob(ctx, 0.4 * W, 0.22 * H, 0.13 * W, 0.35 * H, dark);
          blob(ctx, 0.75 * W, 0.3 * H, 0.2 * W, 0.4 * H, base);
        }),
        ears: [base, dark],
        leg: WHITE,
        paw: WHITE,
        muzzle: WHITE,
        chest: WHITE,
        tail: Array.from({ length: tailN }, (_, i) => (i < 4 ? base : dark)),
      };
    }
    case "siamese": {
      const point = shade(base, 0.55);
      const cream = "#efe3cb";
      return {
        body: canvasTexture(W, H, (ctx) => {
          const g = ctx.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, cream);
          g.addColorStop(0.7, cream);
          g.addColorStop(1, shade(cream, 0.85));
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        }),
        head: canvasTexture(W, H, (ctx) => {
          ctx.fillStyle = cream;
          ctx.fillRect(0, 0, W, H);
          const g = ctx.createRadialGradient(0.25 * W, 0.65 * H, 2, 0.25 * W, 0.65 * H, 0.2 * W);
          g.addColorStop(0, point);
          g.addColorStop(0.55, point);
          g.addColorStop(1, cream);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        }),
        ears: [point, point],
        leg: shade(base, 0.7),
        paw: point,
        muzzle: point,
        chest: cream,
        tail: Array.from({ length: tailN }, (_, i) => (i < 2 ? shade(base, 0.8) : point)),
      };
    }
    default:
      return {
        body: canvasTexture(W, H, (ctx) => {
          ctx.fillStyle = base;
          ctx.fillRect(0, 0, W, H);
          ctx.filter = "blur(6px)";
          blob(ctx, 0.25 * W, 0.45 * H, 0.15 * W, 0.45 * H, shade(base, 1.15));
        }),
        head: canvasTexture(W, H, (ctx) => {
          ctx.fillStyle = base;
          ctx.fillRect(0, 0, W, H);
        }),
        ears: [base, base],
        leg: base,
        paw: base,
        muzzle: shade(base, 1.25),
        chest: shade(base, 1.15),
        tail: Array(tailN).fill(base),
      };
  }
}

const TAIL_N = 9;
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _qC = new THREE.Quaternion();
const _e = new THREE.Euler();
const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const TAIL_LEN = 0.1;

let geoCache: ReturnType<typeof makeGeometries> | null = null;

function makeGeometries() {
  const whiskers = new THREE.BufferGeometry();
  const pts: number[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      pts.push(side * 0.09, 0.05, 0.37, side * 0.42, 0.08 - i * 0.045, 0.3);
    }
  }
  whiskers.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return {
    body: new THREE.SphereGeometry(1, 28, 20).rotateX(Math.PI / 2).scale(0.34, 0.3, 0.52),
    head: new THREE.SphereGeometry(0.3, 28, 20).scale(1.12, 0.94, 1),
    ear: new THREE.ConeGeometry(0.11, 0.2, 14).scale(1, 1, 0.55),
    earInner: new THREE.ConeGeometry(0.07, 0.13, 12).scale(1, 1, 0.4),
    eye: new THREE.SphereGeometry(0.072, 16, 12).scale(1, 1, 0.5),
    pupil: new THREE.SphereGeometry(0.072, 12, 10).scale(0.32, 0.82, 0.3),
    glint: new THREE.SphereGeometry(0.02, 8, 6),
    nose: new THREE.SphereGeometry(0.036, 12, 8).scale(1.3, 0.8, 0.9),
    muzzle: new THREE.SphereGeometry(0.075, 14, 10),
    chest: new THREE.SphereGeometry(0.25, 20, 14).scale(1.1, 1.05, 0.9),
    mouth: new THREE.SphereGeometry(1, 12, 8).scale(0.05, 0.05, 0.03),
    leg: new THREE.CapsuleGeometry(0.075, 0.35, 6, 12).translate(0, -0.25, 0),
    paw: new THREE.SphereGeometry(0.085, 12, 8).scale(1, 0.7, 1.3),
    thigh: new THREE.SphereGeometry(0.15, 16, 12).scale(0.8, 1, 1.15),
    tail: Array.from({ length: TAIL_N }, (_, i) =>
      new THREE.CapsuleGeometry(0.068 - i * 0.002, TAIL_LEN, 4, 10).translate(0, TAIL_LEN / 2, 0),
    ),
    whiskers,
  };
}

const LEG_HIPS: [number, number, number][] = [
  [-0.16, -0.12, 0.3],
  [0.16, -0.12, 0.3],
  [-0.17, -0.12, -0.3],
  [0.17, -0.12, -0.3],
];

export class CatModel {
  readonly root = new THREE.Group();
  /** Meshes the pointer can hit. */
  pickables: THREE.Object3D[] = [];
  /** Sits between root and body so the cat can flop onto its side or back around its own spine. */
  private roller = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private mouth = new THREE.Mesh();
  private legs: THREE.Group[] = [];
  private tail: THREE.Group[] = [];
  private eyes: THREE.Group[] = [];
  private ears: THREE.Group[] = [];
  private owned: { dispose(): void }[] = [];
  private blinkIn = 2;
  private blinkLeft = 0;
  private squash = 0;
  private squashVel = 0;
  private walkPhase = 0;
  size = 1;

  constructor(data: CatData) {
    this.setLook(data);
  }

  /** Rebuilds the cat with a new coat. Geometry is shared, materials and textures are owned. */
  setLook(data: CatData) {
    this.root.remove(this.roller);
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.pickables = [];
    this.legs = [];
    this.tail = [];
    this.eyes = [];
    this.ears = [];
    this.size = data.size;

    const g = (geoCache ??= makeGeometries());
    const look = coatLook(data);
    this.owned.push(look.body, look.head);
    const mat = (color: string, map?: THREE.Texture) => {
      const m = toon(color, map);
      this.owned.push(m);
      return m;
    };
    const pick = <T extends THREE.Object3D>(o: T) => {
      this.pickables.push(o);
      return o;
    };

    this.roller = new THREE.Group();
    this.roller.position.y = 0.62;
    this.root.add(this.roller);
    const body = (this.body = new THREE.Group());
    this.roller.add(body);
    body.add(pick(part(g.body, mat("#fff", look.body), 0.016)));
    const chest = pick(part(g.chest, mat(look.chest), 0.014));
    chest.position.set(0, 0.06, 0.34);
    body.add(chest);

    const head = (this.head = new THREE.Group());
    head.rotation.order = "YXZ";
    head.position.set(0, 0.16, 0.42);
    body.add(head);
    const skull = pick(part(g.head, mat("#fff", look.head), 0.016));
    skull.position.set(0, 0.14, 0.1);
    head.add(skull);

    for (const side of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(side * 0.16, 0.34, 0.06);
      ear.rotation.z = -side * 0.32;
      const outer = part(g.ear, mat(look.ears[side < 0 ? 0 : 1]), 0.012);
      outer.position.y = 0.1;
      const inner = part(g.earInner, mat(PINK), 0);
      inner.position.set(0, 0.085, 0.035);
      ear.add(outer, inner);
      head.add(ear);
      this.ears.push(ear);

      const eye = new THREE.Group();
      eye.position.set(side * 0.115, 0.17, 0.365);
      eye.rotation.y = side * 0.28;
      const iris = part(g.eye, mat(data.eyes), 0.01);
      const pupil = new THREE.Mesh(g.pupil, mat("#1d1616"));
      pupil.position.z = 0.026;
      const glint = new THREE.Mesh(g.glint, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      this.owned.push(glint.material as THREE.Material);
      glint.position.set(0.024, 0.03, 0.042);
      eye.add(iris, pupil, glint);
      head.add(eye);
      this.eyes.push(eye);

      const muzzle = part(g.muzzle, mat(look.muzzle), 0.008);
      muzzle.position.set(side * 0.055, 0.05, 0.355);
      head.add(muzzle);
    }
    this.mouth = new THREE.Mesh(g.mouth, mat("#6b2b35"));
    this.mouth.position.set(0, 0.0, 0.36);
    head.add(this.mouth);
    const nose = part(g.nose, mat(NOSE), 0.008);
    nose.position.set(0, 0.105, 0.395);
    head.add(nose);
    const whiskerMat = new THREE.LineBasicMaterial({ color: 0x5b4a48, transparent: true, opacity: 0.7 });
    this.owned.push(whiskerMat);
    head.add(new THREE.LineSegments(g.whiskers, whiskerMat));

    LEG_HIPS.forEach(([x, y, z], i) => {
      const leg = new THREE.Group();
      leg.position.set(x, y, z);
      leg.add(pick(part(g.leg, mat(look.leg), 0.014)));
      const paw = part(g.paw, mat(look.paw), 0.012);
      paw.position.set(0, -0.46, 0.03);
      leg.add(paw);
      if (i >= 2) {
        const thigh = part(g.thigh, mat(look.leg), 0.014);
        thigh.position.set(0, -0.04, 0);
        leg.add(thigh);
      }
      body.add(leg);
      this.legs.push(leg);
    });

    let parent: THREE.Object3D = body;
    for (let i = 0; i < TAIL_N; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.12 : TAIL_LEN, i === 0 ? -0.48 : 0);
      seg.add(part(g.tail[i], mat(look.tail[i]), 0.012));
      parent.add(seg);
      this.tail.push(seg);
      parent = seg;
    }
  }

  /** Kick the squash-and-stretch spring (positive squashes down). */
  boop(strength: number) {
    this.squashVel += strength;
  }

  /** Point in world space roughly between the ears, for particles and text. */
  headWorld(target: THREE.Vector3): THREE.Vector3 {
    return this.head.localToWorld(target.set(0, 0.45, 0.1));
  }

  update(p: Pose, t: number, dt: number, walkSpeed: number) {
    this.walkPhase += dt * walkSpeed * 9;
    const ph = this.walkPhase;

    // Squash spring
    this.squashVel += (-120 * this.squash - 9 * this.squashVel) * dt;
    this.squash += this.squashVel * dt;
    const s = Math.max(-0.3, Math.min(0.35, this.squash));
    this.root.scale.set(this.size * (1 + s * 0.5), this.size * (1 - s), this.size * (1 + s * 0.5));

    const body = this.body;
    const bob = Math.abs(Math.sin(ph)) * 0.035 * p.walk;
    const onSide = Math.sin(Math.min(1, p.roll) * Math.PI);
    this.roller.position.y =
      0.62 - 0.07 * p.sit - 0.32 * p.lie - 0.15 * p.crouch + bob + 0.05 * p.jump - 0.12 * p.stretch + 0.04 * onSide;
    this.roller.rotation.z = p.roll * Math.PI * p.rollSide + Math.sin(t * 3.2) * 0.14 * p.paddle;
    body.position.x = Math.sin(t * 150) * 0.004 * p.shake;
    body.position.z = -0.12 * p.sit;
    body.rotation.x = -0.8 * p.sit + 0.12 * p.eat - 0.25 * p.jump + 0.3 * p.stretch;
    body.rotation.z = Math.sin(t * 22) * 0.07 * p.wiggle;
    const breathe = Math.sin(t * (p.lie > 0.5 ? 1.7 : 2.8)) * 0.014;
    body.scale.set(1 + breathe, 1 + breathe, 1);

    this.legs.forEach((leg, i) => {
      const front = i < 2;
      const phase = ph + (i === 0 || i === 3 ? 0 : Math.PI);
      let rx = Math.sin(phase) * 0.6 * p.walk;
      if (front) {
        // Counter the body pitch so front legs stay vertical, and drop the hip so paws reach the floor
        rx += 0.8 * p.sit - 1.45 * p.lie - 0.9 * p.jump + 0.12 * p.eat - 1.1 * p.stretch;
        if (i === 1) rx -= p.swat * 2.1;
        rx -= Math.max(0, Math.sin(t * 6 + i * Math.PI)) * 0.55 * p.knead;
        leg.position.y = LEG_HIPS[i][1] - 0.2 * p.sit;
      } else {
        // Sitting: hind legs angle forward-down so the paws rest beside the front paws
        rx += -0.25 * p.sit - 1.45 * p.lie + 0.9 * p.jump - 0.3 * p.stretch;
      }
      // Flopped over: legs stick out from the body, and bicycle when playing
      const flop = Math.min(1, p.roll * 2);
      const air = (front ? -0.55 : 0.45) + Math.sin(t * 9 + i * 1.7) * 0.55 * p.paddle;
      leg.rotation.x = THREE.MathUtils.lerp(rx, air, flop);
      leg.rotation.z = i === 1 ? -p.swat * 0.3 : 0;
    });

    const head = this.head;
    head.rotation.y = p.headYaw;
    head.rotation.x = p.headPitch + 0.75 * p.sit + 0.85 * p.eat + 0.25 * p.jump - 0.25 * p.stretch;
    // Upside down the head turns partly back toward upright, which reads as looking at you
    head.rotation.z = p.headTilt - p.roll * p.rollSide * 1.2;
    this.mouth.visible = p.mouth > 0.04;
    this.mouth.scale.set(1, 0.3 + p.mouth * 1.2, 1);

    for (const [i, ear] of this.ears.entries()) {
      const side = i === 0 ? -1 : 1;
      const twitch = Math.max(0, Math.sin(t * 0.9 + i * 2.1) - 0.97) * 12;
      ear.rotation.x = -0.7 * p.earsBack - twitch * 0.3;
      ear.rotation.z = -side * (0.32 + 0.35 * p.earsBack);
    }

    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkLeft = 0.13;
      this.blinkIn = 2 + Math.random() * 4;
    }
    this.blinkLeft -= dt;
    const closed = Math.max(p.eyesClosed, this.blinkLeft > 0 ? 1 : 0);
    for (const eye of this.eyes) eye.scale.y = 1 - 0.88 * closed;

    const tail = this.tail;
    // Lying: the tail starts lower and curls around the body along the floor
    // Sitting with wrap: the tail root lies flat on the floor pointing out to the side, and the rest
    // curls forward around the paws. The root orientation cancels the body pitch so the curl stays level.
    tail[0].position.y = 0.12 - 0.2 * p.lie - 0.22 * p.wrap;
    const baseRx = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-2.1, -0.5, p.tailUp), -1.68, p.lie);
    for (let i = 0; i < TAIL_N; i++) {
      const seg = tail[i];
      const k = (i + 2) / TAIL_N;
      const sway = Math.sin(t * p.tailSpeed * 6 - i * 0.55) * p.tailAmp * k * (1 - p.lie * 0.7);
      const tipOnly = i >= TAIL_N - 2 ? 1 : 0.1;
      let z = THREE.MathUtils.lerp(sway, sway * tipOnly, p.wrap) + 0.3 * p.lie + (i > 0 ? 0.22 * p.wrap : 0);
      // Flopped over, the body's sideways is now up/down: lay the tail straight back and curl it with x instead
      const flop = Math.min(1, p.roll * 2);
      const sideCurl = 0.2 * (1 - THREE.MathUtils.clamp((p.roll - 0.5) * 2, 0, 1));
      z = THREE.MathUtils.lerp(z, sway * 0.5, flop);
      if (i === 0) {
        _qA.setFromEuler(_e.set(THREE.MathUtils.lerp(baseRx, -Math.PI / 2, flop), 0, z));
        _qB.setFromAxisAngle(_X, -body.rotation.x)
          .multiply(_qC.setFromAxisAngle(_Y, 1.45))
          .multiply(_qC.setFromAxisAngle(_X, -Math.PI / 2))
          .multiply(_qC.setFromAxisAngle(_Z, sway * 0.3));
        seg.quaternion.slerpQuaternions(_qA, _qB, p.wrap);
      } else {
        const curl = i > TAIL_N - 4 ? 0.3 * p.tailUp : 0;
        const rx = (THREE.MathUtils.lerp(0.14, -0.04, p.tailUp) + curl) * (1 - p.lie);
        seg.rotation.set(THREE.MathUtils.lerp(rx * (1 - p.wrap), sideCurl * p.rollSide, flop), 0, z);
      }
    }
  }

  dispose() {
    for (const o of this.owned) o.dispose();
  }
}
