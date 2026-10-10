import * as CANNON from "cannon-es";
import * as THREE from "three";

export type SurfaceId = "table" | "shelf";

export interface Knockable {
  mesh: THREE.Object3D;
  body: CANNON.Body;
  surface: SurfaceId;
  home: THREE.Vector3;
  halfHeight: number;
  state: "resting" | "falling" | "fallen" | "returning";
  timer: number;
  /** True while the item belongs to furniture the player owns. */
  enabled: boolean;
  /** Where a put-back flight started. */
  from: THREE.Vector3;
  fromQuat: THREE.Quaternion;
}

export interface Yarn {
  mesh: THREE.Object3D;
  body: CANNON.Body;
  radius: number;
}

/** Long enough for the player to put things back themselves. */
const RESPAWN_AFTER = 20;
const RETURN_TIME = 0.6;
const HALF = 4;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qId = new THREE.Quaternion();

export class Physics {
  readonly world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
  readonly items: Knockable[] = [];
  yarn: Yarn | null = null;
  private statics = new Map<string, CANNON.Body>();

  constructor() {
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.35;
    this.world.defaultContactMaterial.restitution = 0.25;

    // Floor plus four walls; the two open sides of the diorama get invisible walls.
    const planes: [THREE.Vector3, THREE.Euler][] = [
      [new THREE.Vector3(0, 0, 0), new THREE.Euler(-Math.PI / 2, 0, 0)],
      [new THREE.Vector3(0, 0, -HALF), new THREE.Euler(0, 0, 0)],
      [new THREE.Vector3(0, 0, HALF), new THREE.Euler(0, Math.PI, 0)],
      [new THREE.Vector3(-HALF, 0, 0), new THREE.Euler(0, Math.PI / 2, 0)],
      [new THREE.Vector3(HALF, 0, 0), new THREE.Euler(0, -Math.PI / 2, 0)],
    ];
    for (const [pos, rot] of planes) {
      const body = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
      body.position.set(pos.x, pos.y, pos.z);
      const q = new THREE.Quaternion().setFromEuler(rot);
      body.quaternion.set(q.x, q.y, q.z, q.w);
      this.world.addBody(body);
    }
  }

  /** Adds or removes a static box collider (furniture that comes and goes). */
  setStatic(key: string, enabled: boolean, center: THREE.Vector3, half: THREE.Vector3) {
    const existing = this.statics.get(key);
    if (enabled && !existing) {
      const body = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Box(new CANNON.Vec3(half.x, half.y, half.z)) });
      body.position.set(center.x, center.y, center.z);
      this.world.addBody(body);
      this.statics.set(key, body);
    } else if (!enabled && existing) {
      this.world.removeBody(existing);
      this.statics.delete(key);
    }
  }

  addItem(mesh: THREE.Object3D, shape: CANNON.Shape, halfHeight: number, home: THREE.Vector3, surface: SurfaceId): Knockable {
    const body = new CANNON.Body({ mass: 0.3, shape, linearDamping: 0.05, angularDamping: 0.2 });
    body.sleepSpeedLimit = 0.15;
    const item: Knockable = { mesh, body, surface, home: home.clone(), halfHeight, state: "resting", timer: 0, enabled: true, from: new THREE.Vector3(), fromQuat: new THREE.Quaternion() };
    this.reset(item);
    this.world.addBody(body);
    this.items.push(item);
    return item;
  }

  setItemEnabled(item: Knockable, enabled: boolean) {
    if (item.enabled === enabled) return;
    item.enabled = enabled;
    item.mesh.visible = enabled;
    if (enabled) {
      this.reset(item);
      this.world.addBody(item.body);
    } else {
      this.world.removeBody(item.body);
    }
  }

  setYarn(mesh: THREE.Object3D | null, radius = 0.2) {
    if (this.yarn) this.world.removeBody(this.yarn.body);
    this.yarn = null;
    if (!mesh) return;
    const body = new CANNON.Body({ mass: 0.2, shape: new CANNON.Sphere(radius), linearDamping: 0.35, angularDamping: 0.4 });
    body.position.set(mesh.position.x, radius, mesh.position.z);
    this.world.addBody(body);
    this.yarn = { mesh, body, radius };
  }

  push(body: CANNON.Body, impulse: THREE.Vector3) {
    body.wakeUp();
    body.applyImpulse(new CANNON.Vec3(impulse.x, impulse.y, impulse.z));
  }

  /** Fly an item back to its spot (player tidying up). Returns false if it's already in place. */
  putBack(item: Knockable): boolean {
    if (item.state === "resting" || item.state === "returning") return false;
    item.state = "returning";
    item.timer = 0;
    item.from.copy(item.mesh.position);
    item.fromQuat.copy(item.mesh.quaternion);
    item.mesh.scale.setScalar(1);
    return true;
  }

  resting(surface: SurfaceId): Knockable[] {
    return this.items.filter((i) => i.enabled && i.surface === surface && i.state === "resting");
  }

  private reset(item: Knockable) {
    const b = item.body;
    b.position.set(item.home.x, item.home.y, item.home.z);
    b.quaternion.set(0, 0, 0, 1);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.sleep();
    item.state = "resting";
    item.timer = 0;
  }

  update(dt: number, onCrash: (item: Knockable) => void, onReturned: (item: Knockable) => void) {
    this.world.fixedStep(1 / 60, dt);

    for (const item of this.items) {
      if (!item.enabled) continue;
      const b = item.body;
      if (item.state === "returning") {
        item.timer += dt;
        const s = Math.min(1, item.timer / RETURN_TIME);
        const e = s * s * (3 - 2 * s);
        _v.lerpVectors(item.from, item.home, e);
        _v.y += Math.sin(Math.PI * s) * 1.2;
        _q.slerpQuaternions(item.fromQuat, _qId, e);
        item.mesh.position.copy(_v);
        item.mesh.quaternion.copy(_q);
        b.position.set(_v.x, _v.y, _v.z);
        b.velocity.setZero();
        b.angularVelocity.setZero();
        if (s >= 1) {
          this.reset(item);
          onReturned(item);
        }
        continue;
      }
      if (item.state === "resting" && b.position.y < item.home.y - 0.3) {
        item.state = "falling";
        item.timer = 0;
      } else if (item.state === "falling") {
        item.timer += dt;
        if (b.position.y < item.halfHeight + 0.15 || item.timer > 2.5) {
          item.state = "fallen";
          item.timer = 0;
          onCrash(item);
        }
      } else if (item.state === "fallen") {
        item.timer += dt;
        if (item.timer > RESPAWN_AFTER + 0.4) this.reset(item);
      }
      if (b.position.y < -2) this.reset(item);

      item.mesh.position.set(b.position.x, b.position.y, b.position.z);
      item.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      // Shrink out before respawning, pop back in after.
      const out = item.state === "fallen" ? THREE.MathUtils.clamp((item.timer - RESPAWN_AFTER) / 0.4, 0, 1) : 0;
      const target = 1 - out;
      const s = item.mesh.scale.x;
      item.mesh.scale.setScalar(out > 0 ? target : Math.min(1, s + dt * 4));
    }

    if (this.yarn) {
      const { mesh, body } = this.yarn;
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    }
  }
}
