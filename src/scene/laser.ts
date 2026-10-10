import * as THREE from "three";
import { canvasTexture } from "./toon";

export class Laser {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  active = false;
  /** Bumps each time the laser turns on, so cats can decide once per session whether to chase. */
  epoch = 0;
  /** Smoothed speed of the dot in units per second. */
  speed = 0;
  private last = new THREE.Vector3();
  private glow: THREE.Sprite;

  constructor() {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), new THREE.MeshBasicMaterial({ color: 0xff2030 }));
    dot.rotation.x = -Math.PI / 2;
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: canvasTexture(64, 64, (ctx, s) => {
          const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
          g.addColorStop(0, "rgba(255,60,60,1)");
          g.addColorStop(0.3, "rgba(255,30,40,0.6)");
          g.addColorStop(1, "rgba(255,0,0,0)");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, s, s);
        }),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glow.position.y = 0.03;
    this.group.add(dot, this.glow);
    this.group.visible = false;
  }

  set(p: THREE.Vector3) {
    if (!this.active) {
      this.active = true;
      this.epoch++;
      this.last.copy(p);
      this.speed = 0;
    }
    this.pos.set(p.x, 0.012, p.z);
    this.group.visible = true;
  }

  off() {
    this.active = false;
    this.group.visible = false;
  }

  update(dt: number, t: number) {
    if (!this.active) return;
    const moved = this.pos.distanceTo(this.last) / Math.max(dt, 1e-3);
    this.speed += (moved - this.speed) * Math.min(1, dt * 10);
    this.last.copy(this.pos);
    // A real hand is never perfectly still
    this.group.position.set(this.pos.x + Math.sin(t * 17) * 0.008, this.pos.y, this.pos.z + Math.cos(t * 13) * 0.008);
    this.glow.scale.setScalar(0.32 + Math.sin(t * 20) * 0.04);
  }
}
