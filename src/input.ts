import * as THREE from "three";
import type * as CANNON from "cannon-es";
import type { Cat } from "./cat/cat";
import type { CameraRig } from "./scene/cameraRig";
import type { Laser } from "./scene/laser";

export interface Picker {
  cat(x: number, y: number): { cat: Cat; point: THREE.Vector3 } | null;
  item(x: number, y: number): CANNON.Body | null;
  floor(x: number, y: number): THREE.Vector3 | null;
}

export interface InputEvents {
  firstGesture(): void;
  pet(cat: Cat, point: THREE.Vector3, x: number, y: number): void;
  tap(cat: Cat): void;
  flick(body: CANNON.Body, impulse: THREE.Vector3): void;
}

type Mode = "pet" | "laser" | "orbit" | "item" | "pinch" | "none";

interface Ptr {
  x: number;
  y: number;
  sx: number;
  sy: number;
  mode: Mode;
  cat?: Cat;
  body?: CANNON.Body;
  travel: number;
  moved: number;
  t0: number;
}

const PET_EVERY_PX = 28;

/**
 * One finger on a cat pets it, on the floor shines the laser, on an item flicks it,
 * anywhere else rotates the room. Two fingers pinch-zoom and rotate.
 */
export class Input {
  private ptrs = new Map<number, Ptr>();
  private pinchDist = 0;
  private pinchMid = { x: 0, y: 0 };
  enabled = true;

  constructor(
    el: HTMLElement,
    private rig: CameraRig,
    private laser: Laser,
    private pick: Picker,
    private on: InputEvents,
  ) {
    el.addEventListener("pointerdown", (e) => this.down(e));
    el.addEventListener("pointermove", (e) => this.move(e));
    el.addEventListener("pointerup", (e) => this.up(e));
    el.addEventListener("pointercancel", (e) => this.up(e));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.rig.zoomAt(e.deltaY > 0 ? 1.08 : 1 / 1.08, this.pick.floor(e.clientX, e.clientY));
      },
      { passive: false },
    );
  }

  private down(e: PointerEvent) {
    if (!this.enabled) return;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Not all pointer ids can be captured (e.g. synthetic events); input still works without it
    }
    this.on.firstGesture();
    const p: Ptr = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode: "none", travel: 0, moved: 0, t0: performance.now() };
    this.ptrs.set(e.pointerId, p);

    if (this.ptrs.size === 2) {
      this.laser.off();
      for (const q of this.ptrs.values()) q.mode = "pinch";
      this.startPinch();
      return;
    }
    if (this.ptrs.size > 2) return;

    if (e.button === 1 || e.button === 2) {
      p.mode = "orbit";
      return;
    }
    const hit = this.pick.cat(p.x, p.y);
    if (hit) {
      p.mode = "pet";
      p.cat = hit.cat;
      this.on.pet(hit.cat, hit.point, p.x, p.y);
      return;
    }
    const body = this.pick.item(p.x, p.y);
    if (body) {
      p.mode = "item";
      p.body = body;
      return;
    }
    const floor = this.pick.floor(p.x, p.y);
    if (floor) {
      p.mode = "laser";
      this.laser.set(floor);
      return;
    }
    p.mode = "orbit";
  }

  private pinchPair(): [Ptr, Ptr] | null {
    const list = [...this.ptrs.values()].filter((q) => q.mode === "pinch");
    return list.length >= 2 ? [list[0], list[1]] : null;
  }

  private startPinch() {
    const pair = this.pinchPair();
    if (!pair) return;
    const [a, b] = pair;
    this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private move(e: PointerEvent) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.travel += Math.hypot(dx, dy);
    p.moved += Math.hypot(dx, dy);

    switch (p.mode) {
      case "pet": {
        if (p.travel < PET_EVERY_PX) break;
        const hit = this.pick.cat(p.x, p.y);
        if (hit && hit.cat === p.cat) {
          p.travel = 0;
          this.on.pet(hit.cat, hit.point, p.x, p.y);
        }
        break;
      }
      case "laser": {
        const floor = this.pick.floor(p.x, p.y);
        if (floor) this.laser.set(floor);
        break;
      }
      case "orbit":
        this.rig.rotate(dx, dy);
        break;
      case "pinch": {
        const pair = this.pinchPair();
        if (!pair) break;
        const [a, b] = pair;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this.pinchDist > 0 && dist > 0) {
          this.rig.zoomAt(this.pinchDist / dist, this.pick.floor(mid.x, mid.y));
        }
        this.rig.rotate((mid.x - this.pinchMid.x) * 0.5, (mid.y - this.pinchMid.y) * 0.5);
        this.pinchDist = dist;
        this.pinchMid = mid;
        break;
      }
    }
  }

  private up(e: PointerEvent) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    if (p.mode === "laser") this.laser.off();
    if (p.mode === "pet" && p.cat && p.moved < 12 && performance.now() - p.t0 < 350) this.on.tap(p.cat);
    if (p.mode === "item" && p.body) {
      const dx = p.x - p.sx;
      const dy = p.y - p.sy;
      const impulse = new THREE.Vector3();
      if (Math.hypot(dx, dy) < 12) {
        impulse.set((Math.random() - 0.5) * 0.4, 0.9, (Math.random() - 0.5) * 0.4);
      } else {
        // Screen drag → floor-plane direction relative to the camera
        const cam = this.rig.camera;
        const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
        const fwd = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), right).normalize();
        const k = Math.min(1.4, Math.hypot(dx, dy) * 0.006) / Math.hypot(dx, dy);
        impulse.addScaledVector(right, dx * k).addScaledVector(fwd, -dy * k).setY(0.25);
      }
      this.on.flick(p.body, impulse);
    }
    // Remaining finger after a pinch should not suddenly start a laser or orbit
    for (const q of this.ptrs.values()) if (q.mode === "pinch") q.mode = "none";
  }
}
