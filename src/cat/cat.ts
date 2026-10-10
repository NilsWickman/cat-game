import * as THREE from "three";
import type { MeowKind, Sfx } from "../audio";
import type { CatData } from "../game/state";
import type { Fx } from "../scene/fx";
import type { Laser } from "../scene/laser";
import type { Knockable, Physics } from "../scene/physics";
import { ROOM_HALF, type Room, type Spot, type Surface } from "../scene/room";
import { CatModel, neutralPose, type Pose } from "./model";

/** What a cat can see and touch. Implemented by the app. */
export interface CatWorld {
  room: Room;
  physics: Physics;
  laser: Laser;
  fx: Fx;
  sfx: Sfx;
  camera: THREE.Camera;
  cats: Cat[];
  night: boolean;
  chaosLevel: number;
  reservations: Map<string, Cat>;
  onPounce(cat: Cat, at: THREE.Vector3): void;
}

type Plan = Generator<void, void, void>;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export class Cat {
  readonly model: CatModel;
  readonly pos = new THREE.Vector3();
  heading = rand(-Math.PI, Math.PI);
  /** Height of the surface the cat stands on. */
  level = 0;
  asleep = false;
  purr = 0;

  private dt = 0;
  private t = 0;
  private plan: Plan | null = null;
  private planName = "";
  private lastPlan = "";
  private target: Pose = neutralPose();
  private pose: Pose = neutralPose();
  private speedNow = 0;
  private jumping = false;
  private petTimer = 0;
  private mouthLeft = 0;
  private taps = 0;
  private lookAt: THREE.Vector3 | null = null;
  private seenEpoch = -1;
  private chaseOk = false;
  private tmp = new THREE.Vector3();
  readonly pitch: number;

  constructor(public data: CatData, private w: CatWorld) {
    this.model = new CatModel(data);
    this.pos.copy(w.room.randomFloorPoint());
    let h = 0;
    for (const ch of data.id) h = (h * 31 + ch.charCodeAt(0)) % 1000;
    this.pitch = (1.1 - data.size * 0.2) * (0.92 + (h / 1000) * 0.16);
  }

  setData(data: CatData) {
    this.data = data;
    this.model.setLook(data);
  }

  // ---------- public interactions ----------

  pet() {
    if (this.petTimer <= 0 && Math.random() < 0.2) this.say("mrrp");
    this.petTimer = 1.4;
    this.model.boop(3.5);
  }

  /** A quick tap (not a stroke): flop over for a belly rub. Tapping again while it's rolling springs the belly trap. */
  tap() {
    if (this.jumping) return;
    if (this.planName === "roll") {
      this.taps++;
      return;
    }
    if (this.level > 0.02) {
      this.say("mew");
      this.model.boop(4);
      return;
    }
    this.start("roll", this.rollPlan(true));
  }

  say(kind: MeowKind = "meow") {
    this.w.sfx.meow(this.pitch, kind);
    this.mouthLeft = { meow: 0.6, mew: 0.3, mrrp: 0.3, yowl: 1 }[kind];
  }

  /** Wakes the cat briefly to start napping right away (used when returning after a long time). */
  startNap() {
    this.start("sleep", this.sleepPlan(true));
  }

  // ---------- frame update ----------

  update(dt: number, t: number) {
    this.dt = dt;
    this.t = t;
    this.petTimer -= dt;

    if (!this.jumping) {
      // Petting interrupts anything except a belly-up roll, which handles belly rubs itself
      if (this.petTimer > 0 && this.planName !== "pet" && this.planName !== "roll") this.start("pet", this.petPlan());
      else if (this.w.laser.active && this.planName !== "chase" && this.planName !== "pet" && this.wantsChase()) {
        this.start("chase", this.chasePlan());
      }
    }
    if (!this.plan) this.choose();

    Object.assign(this.target, neutralPose());
    this.lookAt = null;
    this.speedNow = 0;
    this.purr = 0;
    if (this.plan!.next().done) {
      this.plan = null;
      this.planName = "";
    }
    if (this.mouthLeft > 0) {
      this.mouthLeft -= dt;
      this.target.mouth = Math.max(this.target.mouth, 1);
    }

    this.separate();
    this.applyPose(dt, t);
  }

  private start(name: string, plan: Plan) {
    this.plan?.return();
    this.asleep = false;
    this.plan = plan;
    this.planName = name;
    this.lastPlan = name;
  }

  private wantsChase(): boolean {
    const laser = this.w.laser;
    if (laser.epoch !== this.seenEpoch) {
      this.seenEpoch = laser.epoch;
      this.chaseOk = Math.random() < (this.asleep ? 0.35 : 0.65 + this.data.playful * 0.35);
    }
    return this.chaseOk;
  }

  private separate() {
    if (this.jumping || this.level > 0.02) return;
    for (const other of this.w.cats) {
      if (other === this || other.level > 0.02) continue;
      const dx = this.pos.x - other.pos.x;
      const dz = this.pos.z - other.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < 0.9) {
        const push = ((0.9 - d) / d) * 0.5 * Math.min(1, this.dt * 8);
        this.pos.x += dx * push;
        this.pos.z += dz * push;
      }
    }
    const lim = ROOM_HALF - 0.45;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -lim, lim);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -lim, lim);
  }

  private applyPose(dt: number, t: number) {
    const root = this.model.root;
    root.position.copy(this.pos);
    root.rotation.y = this.heading;
    root.updateMatrixWorld();

    const tg = this.target;
    const look = this.lookAt;
    if (look) {
      const local = root.worldToLocal(this.tmp.copy(look));
      const dx = local.x;
      const dz = local.z - 0.45;
      const dy = local.y - 0.9;
      tg.headYaw = THREE.MathUtils.clamp(Math.atan2(dx, dz), -1.1, 1.1);
      tg.headPitch = THREE.MathUtils.clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.7, 0.5);
    } else if (tg.headYaw === 0) {
      tg.headYaw = Math.sin(t * 0.4 + this.pitch * 10) * 0.35;
    }

    const p = this.pose as unknown as Record<string, number>;
    const q = tg as unknown as Record<string, number>;
    const k = Math.min(1, dt * 8);
    for (const key in q) p[key] += (q[key] - p[key]) * (key === "swat" ? Math.min(1, dt * 20) : k);
    this.model.update(this.pose, t, dt, this.speedNow);
  }

  // ---------- movement primitives ----------

  /** Moves toward a point on the current level; returns remaining distance. */
  private steer(to: THREE.Vector3, speed: number): number {
    const dx = to.x - this.pos.x;
    const dz = to.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return 0;
    const diff = wrap(Math.atan2(dx, dz) - this.heading);
    const turn = 7 * this.dt;
    this.heading = wrap(this.heading + THREE.MathUtils.clamp(diff, -turn, turn));
    const align = Math.max(0.2, Math.cos(diff));
    const step = Math.min(dist, speed * align * this.dt);
    this.pos.x += (dx / dist) * step;
    this.pos.z += (dz / dist) * step;
    this.speedNow = speed * align;
    this.target.walk = Math.min(1, speed / 0.9);
    this.target.tailUp = 0.8;
    return dist - step;
  }

  private *walkTo(to: THREE.Vector3, speed = 1.1, stop = 0.05): Plan {
    let guard = 0;
    while (this.steer(to, speed) > stop && (guard += this.dt) < 12) yield;
  }

  private *face(heading: number, maxTime = 0.6): Plan {
    let t = 0;
    while (Math.abs(wrap(heading - this.heading)) > 0.05 && (t += this.dt) < maxTime) {
      const diff = wrap(heading - this.heading);
      this.heading = wrap(this.heading + THREE.MathUtils.clamp(diff, -6 * this.dt, 6 * this.dt));
      this.target.walk = 0.4;
      this.speedNow = 0.4;
      yield;
    }
  }

  private headingTo(p: THREE.Vector3) {
    return Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }

  private *hold(seconds: number, each: (t: number) => void): Plan {
    let t = 0;
    while ((t += this.dt) < seconds) {
      each(t);
      yield;
    }
  }

  private *jumpTo(to: THREE.Vector3, low = false): Plan {
    this.jumping = true;
    try {
      yield* this.face(this.headingTo(to), 0.5);
      yield* this.hold(low ? 0.12 : 0.25, () => {
        this.target.crouch = 1;
        this.target.tailUp = 0.3;
      });
      const from = this.pos.clone();
      const dy = to.y - from.y;
      const dist = Math.hypot(to.x - from.x, to.z - from.z);
      const dur = low ? 0.32 : 0.42 + 0.1 * Math.abs(dy) + 0.06 * dist;
      const arc = low ? 0.35 : 0.45 + Math.max(0, dy) * 0.3;
      if (!low) this.w.sfx.whoosh();
      let s = 0;
      while (s < 1) {
        s = Math.min(1, s + this.dt / dur);
        const ease = dy > 0 ? 1 - (1 - s) ** 2 : s * s;
        this.pos.set(
          from.x + (to.x - from.x) * s,
          from.y + dy * ease + arc * 4 * s * (1 - s),
          from.z + (to.z - from.z) * s,
        );
        this.target.jump = 1;
        this.target.tailUp = 0.5;
        yield;
      }
      this.pos.copy(to);
      this.level = to.y;
      this.model.boop(4);
    } finally {
      this.jumping = false;
    }
    yield* this.hold(0.12, () => (this.target.crouch = 0.6));
  }

  /** Jump off whatever the cat is on to a free spot on the floor. */
  private *jumpDown(): Plan {
    if (this.level <= 0.02) return;
    const reach = 1.0 + this.level * 0.4;
    for (const off of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
      const h = this.heading + off;
      const x = this.pos.x + Math.sin(h) * reach;
      const z = this.pos.z + Math.cos(h) * reach;
      const lim = ROOM_HALF - 0.5;
      if (Math.abs(x) < lim && Math.abs(z) < lim && !this.w.room.isBlocked(x, z, 0.15)) {
        yield* this.jumpTo(v(x, 0, z));
        return;
      }
    }
    yield* this.jumpTo(this.w.room.randomFloorPoint());
  }

  private *goTo(p: THREE.Vector3, speed = 1.1): Plan {
    yield* this.jumpDown();
    yield* this.walkTo(p, speed);
  }

  /** Walk to a spot's approach point, hop on if it's raised, and turn to face its direction. */
  private *settleAt(spot: Spot): Plan {
    yield* this.goTo(spot.approach);
    if (spot.pos.y > 0.02) yield* this.jumpTo(spot.pos, spot.pos.y < 0.3);
    else yield* this.walkTo(spot.pos, 0.8);
    yield* this.face(spot.facing);
  }

  private reserve(key: string): boolean {
    const holder = this.w.reservations.get(key);
    if (holder && holder !== this) return false;
    this.w.reservations.set(key, this);
    return true;
  }

  private release(key: string) {
    if (this.w.reservations.get(key) === this) this.w.reservations.delete(key);
  }

  private free(key: string) {
    const holder = this.w.reservations.get(key);
    return !holder || holder === this;
  }

  // ---------- plans ----------

  private choose() {
    const w = this.w;
    const owned = (id: Parameters<Room["owned"]["has"]>[0]) => w.room.owned.has(id);
    const d = this.data;
    const chaos = 1 + 0.3 * w.chaosLevel;
    const options: [string, number, () => Plan][] = [
      ["wander", 3, () => this.wanderPlan()],
      ["idle", 1.5, () => this.idlePlan(rand(3, 7))],
      ["groom", 1, () => this.groomPlan()],
      ["attention", 0.8, () => this.attentionPlan()],
      ["sleep", 0.5 + d.lazy * 2.5 + (w.night ? 3 : 0), () => this.sleepPlan(false)],
      ["roll", 0.6 + d.playful, () => this.rugRollPlan()],
      ["zoomies", (0.2 + d.playful * 0.6) * (w.night ? 1.8 : 1), () => this.zoomiesPlan()],
    ];
    if (this.free("table") && w.physics.resting("table").length) {
      options.push(["knock", (0.6 + d.playful * 1.6) * chaos, () => this.knockPlan(w.room.surfaces.table)]);
    }
    if (owned("shelf") && this.free("shelf") && w.physics.resting("shelf").length) {
      options.push(["knock", (0.6 + d.playful * 1.6) * chaos, () => this.knockPlan(w.room.surfaces.shelf)]);
    }
    if (owned("yarn")) options.push(["yarn", 0.5 + d.playful * 2, () => this.yarnPlan()]);
    if (owned("bowl") && this.free("bowl")) options.push(["eat", 1.2, () => this.eatPlan()]);
    if (owned("tree") && this.free("tree")) options.push(["tree", 1.6, () => this.treePlan()]);
    if (owned("box") && this.free("box")) options.push(["box", 1.3, () => this.boxPlan()]);
    if (owned("cushion") && this.free("cushion")) options.push(["window", 1.0, () => this.windowPlan()]);
    if (owned("aquarium") && this.free("aquarium")) options.push(["aquarium", 1.6, () => this.aquariumPlan()]);

    const weight = (o: (typeof options)[number]) => (o[0] === this.lastPlan ? o[1] * 0.3 : o[1]);
    let r = Math.random() * options.reduce((s, o) => s + weight(o), 0);
    for (const o of options) {
      r -= weight(o);
      if (r <= 0) return this.start(o[0], o[2]());
    }
    this.start(options[0][0], options[0][2]());
  }

  private *idlePlan(seconds: number): Plan {
    let glance = this.pos.clone();
    let lookCam = Math.random() < 0.4;
    yield* this.hold(seconds, (t) => {
      this.target.sit = 1;
      this.target.tailAmp = 0.3;
      this.target.wrap = t > 0.6 ? 1 : 0;
      if (Math.floor(t / 1.8) !== Math.floor((t - this.dt) / 1.8)) {
        lookCam = Math.random() < 0.35;
        glance = this.w.room.randomFloorPoint().setY(rand(0, 2));
      }
      this.lookAt = lookCam ? this.w.camera.position : glance;
    });
  }

  private *wanderPlan(): Plan {
    yield* this.goTo(this.w.room.randomFloorPoint());
    if (Math.random() < 0.6) yield* this.idlePlan(rand(1.5, 4));
  }

  private *groomPlan(): Plan {
    yield* this.hold(rand(2.5, 4), (t) => {
      this.target.sit = 1;
      this.target.swat = 0.55 + Math.sin(t * 9) * 0.1;
      this.target.headPitch = 0.45;
      this.target.headYaw = 0.25;
      this.target.headTilt = 0.25;
      this.target.eyesClosed = 0.8;
      this.target.tailAmp = 0.15;
    });
  }

  private *attentionPlan(): Plan {
    const cam = this.w.camera.position;
    const dir = v(cam.x, 0, cam.z).normalize().multiplyScalar(2.2);
    if (this.w.room.isBlocked(dir.x, dir.z)) dir.set(0.5, 0, 1.5);
    yield* this.goTo(dir.add(v(rand(-0.6, 0.6), 0, rand(-0.6, 0.6))));
    yield* this.face(this.headingTo(cam));
    let meowed = false;
    yield* this.hold(rand(2.5, 4), (t) => {
      this.target.sit = 1;
      this.target.wrap = t > 0.8 ? 1 : 0;
      this.target.headTilt = Math.sin(t * 1.3) * 0.2;
      this.lookAt = this.w.camera.position;
      if (!meowed && t > 0.5) {
        meowed = true;
        this.say(Math.random() < 0.15 ? "yowl" : Math.random() < 0.5 ? "meow" : "mew");
      }
    });
  }

  private *sleepPlan(here: boolean): Plan {
    const room = this.w.room;
    let key = "";
    try {
      if (!here) {
        if (room.owned.has("cushion") && Math.random() < 0.7 && this.reserve("cushion")) {
          key = "cushion";
          yield* this.settleAt(room.spots.cushion);
        } else {
          yield* this.goTo(room.randomFloorPoint());
        }
      }
      this.asleep = true;
      let nextZ = 1;
      // Half the time flopped on the side with the legs stretched out, otherwise curled up
      const onSide = Math.random() < 0.5;
      const side = Math.random() < 0.5 ? 1 : -1;
      yield* this.hold(rand(14, 30) * (this.w.night ? 1.8 : 1), (t) => {
        this.target.lie = 1;
        this.target.roll = onSide ? 0.5 : 0;
        this.target.rollSide = side;
        this.target.eyesClosed = 1;
        this.target.tailAmp = 0.05;
        this.target.headPitch = 0.15;
        this.target.headTilt = onSide ? 0 : 0.25;
        if (t > nextZ) {
          nextZ = t + 1.6;
          this.w.fx.emit("z", this.model.headWorld(this.tmp));
        }
      });
    } finally {
      this.asleep = false;
      if (key) this.release(key);
    }
    yield* this.wakeUp();
  }

  private *wakeUp(): Plan {
    yield* this.hold(0.5, () => {
      this.target.lie = 1;
      this.target.eyesClosed = 0.6;
    });
    // Big stretch with a yawn
    yield* this.hold(1.6, (t) => {
      this.target.stretch = 1;
      this.target.eyesClosed = 0.7;
      this.target.earsBack = 0.4;
      this.target.tailUp = 1;
      this.target.mouth = t > 0.3 && t < 1.2 ? 1.4 : 0;
      this.target.headPitch = -0.3;
    });
    yield* this.hold(0.6, () => (this.target.sit = 1));
  }

  /** Flop over, wiggle belly-up with paws in the air, then get back up. */
  private *rollPlan(fromTap: boolean): Plan {
    const side = Math.random() < 0.5 ? 1 : -1;
    this.taps = 0;
    if (fromTap) this.say("mrrp");
    yield* this.hold(0.3, () => {
      this.target.lie = 1;
      this.target.rollSide = side;
    });
    yield* this.hold(0.3, () => {
      this.target.lie = 1;
      this.target.roll = 0.5;
      this.target.rollSide = side;
    });
    const stay = rand(2.5, 4);
    let t = 0;
    let trapped = false;
    while ((t += this.dt) < stay || (this.petTimer > 0 && t < 12)) {
      const rubbed = this.petTimer > 0;
      const tg = this.target;
      tg.lie = 1;
      tg.rollSide = side;
      tg.roll = 0.88 + Math.sin(t * 2.4) * 0.12;
      tg.paddle = rubbed ? 0.4 : 0.8;
      tg.eyesClosed = rubbed ? 0.8 : 0;
      tg.tailAmp = 0.5;
      tg.tailSpeed = 1.4;
      tg.knead = rubbed ? 0.6 : 0;
      tg.shake = rubbed ? 1 : 0;
      this.purr = rubbed ? 1 : 0.2;
      // The classic belly trap: too many pokes and the paws grab back
      if (this.taps >= 2 && !trapped) {
        trapped = true;
        this.say("mew");
        yield* this.hold(0.9, (k) => {
          this.target.lie = 1;
          this.target.rollSide = side;
          this.target.roll = 1;
          this.target.paddle = 1;
          this.target.earsBack = 1;
          this.target.wiggle = 0.6;
          this.target.knead = Math.sin(k * 20) > 0 ? 1 : 0;
        });
      }
      yield;
    }
    yield* this.hold(0.35, () => {
      this.target.lie = 1;
      this.target.roll = 0.5;
      this.target.rollSide = side;
    });
    yield* this.hold(0.35, () => (this.target.lie = 1));
    yield* this.hold(0.5, () => {
      this.target.sit = 1;
      this.lookAt = this.w.camera.position;
    });
  }

  private *rugRollPlan(): Plan {
    yield* this.goTo(v(0.3 + rand(-0.8, 0.8), 0, 0.7 + rand(-0.8, 0.8)));
    yield* this.rollPlan(false);
  }

  /** Sudden sprint around the room for no reason at all. */
  private *zoomiesPlan(): Plan {
    yield* this.jumpDown();
    for (let n = Math.floor(rand(3, 6)); n > 0; n--) {
      const to = this.w.room.randomFloorPoint();
      let guard = 0;
      while (this.steer(to, 3.8) > 0.15 && (guard += this.dt) < 4) {
        this.target.earsBack = 0.7;
        this.target.tailUp = 1;
        this.target.tailAmp = 0.1;
        yield;
      }
    }
    yield* this.hold(rand(1.5, 2.5), (t) => {
      this.target.sit = 1;
      this.target.wrap = t > 0.6 ? 1 : 0;
      this.lookAt = this.w.camera.position;
    });
  }

  private *boxPlan(): Plan {
    if (!this.reserve("box")) return;
    try {
      yield* this.settleAt(this.w.room.spots.box);
      yield* this.hold(rand(8, 16), () => {
        this.target.lie = 1;
        this.target.eyesClosed = 0.55;
        this.target.tailAmp = 0.05;
        this.lookAt = this.w.camera.position;
      });
    } finally {
      this.release("box");
    }
  }

  private *knockPlan(surface: Surface): Plan {
    const items = this.w.physics.resting(surface.id);
    const item: Knockable | undefined = items[Math.floor(Math.random() * items.length)];
    if (!item || !this.reserve(surface.id)) return;
    try {
      yield* this.goTo(surface.approach);
      yield* this.jumpTo(surface.top);
      const itemPos = item.mesh.position;
      yield* this.walkTo(surface.stand(itemPos), 0.6);
      yield* this.face(this.headingTo(itemPos));
      // The classic: look you in the eye first
      yield* this.hold(rand(0.8, 1.5), () => {
        this.target.sit = 0.7;
        this.target.tailAmp = 0.5;
        this.target.tailSpeed = 1.6;
        this.lookAt = this.w.camera.position;
      });
      if (item.state === "resting") {
        let hit = false;
        yield* this.hold(0.35, (t) => {
          this.target.sit = 0.5;
          this.target.swat = t < 0.2 ? 1 : 0;
          this.lookAt = itemPos;
          if (!hit && t > 0.15) {
            hit = true;
            const out = surface.outward(itemPos).multiplyScalar(rand(0.8, 1.05));
            this.w.physics.push(item.body, out.setY(0.25));
            this.w.sfx.whoosh();
          }
        });
        yield* this.hold(1.4, () => {
          this.target.sit = 0.6;
          this.lookAt = itemPos;
        });
      }
      yield* this.jumpDown();
    } finally {
      this.release(surface.id);
    }
  }

  private *yarnPlan(): Plan {
    const yarn = this.w.physics.yarn;
    if (!yarn) return;
    yield* this.jumpDown();
    for (let n = Math.floor(rand(2, 5)); n > 0; n--) {
      yield* this.walkTo(yarn.mesh.position, 2.2, 0.55);
      yield* this.hold(rand(0.2, 0.5), () => {
        this.target.crouch = 1;
        this.target.wiggle = 1;
        this.lookAt = yarn.mesh.position;
      });
      let hit = false;
      yield* this.hold(0.3, (t) => {
        this.target.swat = t < 0.18 ? 1 : 0;
        this.lookAt = yarn.mesh.position;
        if (!hit && t > 0.12) {
          hit = true;
          const dir = this.tmp.copy(yarn.mesh.position).sub(this.pos).setY(0).normalize();
          dir.applyAxisAngle(v(0, 1, 0), rand(-0.9, 0.9));
          this.w.physics.push(yarn.body, dir.multiplyScalar(rand(0.6, 1.1)).setY(0.15));
        }
      });
    }
  }

  private *eatPlan(): Plan {
    if (!this.reserve("bowl")) return;
    try {
      yield* this.settleAt(this.w.room.spots.bowl);
      yield* this.hold(rand(4, 7), (t) => {
        this.target.eat = 1;
        this.target.tailUp = 0.9;
        this.target.headPitch = Math.sin(t * 12) * 0.08;
      });
    } finally {
      this.release("bowl");
    }
  }

  private *treePlan(): Plan {
    if (!this.reserve("tree")) return;
    const spots = this.w.room.spots;
    try {
      yield* this.goTo(spots.treeLow.approach);
      yield* this.jumpTo(spots.treeLow.pos);
      yield* this.hold(0.5, () => (this.target.sit = 0.5));
      yield* this.jumpTo(spots.treeTop.pos);
      yield* this.face(this.headingTo(this.w.camera.position));
      const lie = Math.random() < 0.4;
      yield* this.hold(rand(6, 12), () => {
        if (lie) this.target.lie = 1;
        else this.target.sit = 1;
        this.target.tailAmp = 0.35;
        this.lookAt = this.w.camera.position;
      });
      yield* this.jumpDown();
    } finally {
      this.release("tree");
    }
  }

  private *windowPlan(): Plan {
    if (!this.reserve("cushion")) return;
    try {
      const spot = this.w.room.spots.cushion;
      yield* this.settleAt({ ...spot, facing: Math.PI });
      const view = v(0.8, 2.6, -4);
      yield* this.hold(rand(6, 10), (t) => {
        this.target.sit = 1;
        this.target.wrap = t > 0.8 ? 1 : 0;
        this.target.tailAmp = 0.3;
        this.lookAt = view.clone().setX(0.8 + Math.sin(t * 0.7) * 0.8);
      });
    } finally {
      this.release("cushion");
    }
  }

  private *aquariumPlan(): Plan {
    if (!this.reserve("aquarium")) return;
    try {
      yield* this.settleAt(this.w.room.spots.aquarium);
      const fish = this.w.room.fish[Math.floor(Math.random() * this.w.room.fish.length)].mesh;
      const fishPos = new THREE.Vector3();
      yield* this.hold(rand(6, 10), (t) => {
        this.target.sit = 1;
        this.target.tailAmp = 0.5;
        this.target.tailSpeed = 2;
        this.target.swat = Math.sin(t * 1.3) > 0.85 ? 0.8 : 0;
        this.lookAt = fish.getWorldPosition(fishPos);
      });
    } finally {
      this.release("aquarium");
    }
  }

  private *petPlan(): Plan {
    const lying = this.pose.lie > 0.5;
    while (this.petTimer > -0.6) {
      if (lying) this.target.lie = 1;
      else this.target.sit = 0.8;
      this.target.eyesClosed = 1;
      this.target.tailUp = 1;
      this.target.tailAmp = 0.15;
      this.target.tailSpeed = 0.6;
      this.target.headTilt = Math.sin(this.t * 2) * 0.25;
      this.lookAt = this.w.camera.position;
      const petting = this.petTimer > 0;
      // Lying cats knead; all of them tremble a little with the purr
      if (lying) this.target.knead = petting ? 1 : 0;
      this.target.shake = petting ? 1 : 0;
      this.purr = petting ? 1 : 0.4;
      yield;
    }
  }

  private *chasePlan(): Plan {
    const laser = this.w.laser;
    yield* this.jumpDown();
    let cooldown = 0;
    while (laser.active) {
      const dot = laser.pos;
      const dist = Math.hypot(dot.x - this.pos.x, dot.z - this.pos.z);
      this.target.earsBack = 0.25;
      this.lookAt = dot;
      cooldown -= this.dt;
      if (dist > 1.4 || laser.speed > 2.5) {
        this.steer(dot, dist > 3 ? 3.2 : 2.6);
        this.target.tailUp = 0.4;
        yield;
      } else if (cooldown > 0) {
        this.target.crouch = 0.5;
        yield;
      } else {
        // Stalk, wiggle, pounce
        let aborted = false;
        yield* this.hold(rand(0.3, 0.7), () => {
          this.target.crouch = 1;
          this.target.wiggle = 1;
          this.target.tailAmp = 0.6;
          this.target.tailSpeed = 3;
          this.lookAt = dot;
          if (Math.hypot(dot.x - this.pos.x, dot.z - this.pos.z) > 1.8) aborted = true;
        });
        if (aborted || !laser.active) continue;
        const landing = v(dot.x, 0, dot.z);
        yield* this.jumpTo(landing, true);
        if (laser.active && Math.hypot(dot.x - landing.x, dot.z - landing.z) < 0.45) {
          this.w.onPounce(this, landing);
          this.say("mrrp");
        }
        cooldown = 0.5;
      }
    }
    // Where did it go?
    yield* this.hold(1.5, (t) => {
      this.target.sit = 1;
      this.target.headYaw = Math.sin(t * 4) * 0.8;
      this.target.earsBack = 0.3;
    });
  }
}
