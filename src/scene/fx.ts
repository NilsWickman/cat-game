import * as THREE from "three";
import { canvasTexture } from "./toon";

export type FxKind = "heart" | "z" | "star" | "dust";

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
  gravity: number;
}

function heartPath(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(s / 2, s * 0.85);
  ctx.bezierCurveTo(s * 0.05, s * 0.55, s * 0.05, s * 0.12, s * 0.3, s * 0.12);
  ctx.bezierCurveTo(s * 0.42, s * 0.12, s / 2, s * 0.22, s / 2, s * 0.3);
  ctx.bezierCurveTo(s / 2, s * 0.22, s * 0.58, s * 0.12, s * 0.7, s * 0.12);
  ctx.bezierCurveTo(s * 0.95, s * 0.12, s * 0.95, s * 0.55, s / 2, s * 0.85);
  ctx.closePath();
}

function makeTextures(): Record<FxKind, THREE.Texture> {
  return {
    heart: canvasTexture(64, 64, (ctx, s) => {
      heartPath(ctx, s);
      ctx.fillStyle = "#ff5c8a";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }),
    z: canvasTexture(64, 64, (ctx, s) => {
      ctx.font = "bold 48px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#fff";
      ctx.strokeText("z", s / 2, s / 2);
      ctx.fillStyle = "#7c8cff";
      ctx.fillText("z", s / 2, s / 2);
    }),
    star: canvasTexture(64, 64, (ctx, s) => {
      ctx.fillStyle = "#ffd447";
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 ? s * 0.14 : s * 0.48;
        const a = (i / 8) * Math.PI * 2;
        ctx.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
      }
      ctx.fill();
    }),
    dust: canvasTexture(32, 32, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,0.9)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }),
  };
}

export class Fx {
  readonly group = new THREE.Group();
  private live: Particle[] = [];
  private pool: THREE.Sprite[] = [];
  private textures = makeTextures();

  emit(kind: FxKind, pos: THREE.Vector3, count = 1) {
    for (let i = 0; i < count; i++) {
      const sprite = this.pool.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      sprite.material.map = this.textures[kind];
      sprite.material.opacity = 1;
      sprite.position.copy(pos);
      sprite.visible = true;
      this.group.add(sprite);
      const r = () => Math.random() - 0.5;
      const p: Particle = { sprite, vel: new THREE.Vector3(), life: 0, max: 1, size: 0.3, grow: 0, gravity: 0 };
      switch (kind) {
        case "heart":
          p.vel.set(r() * 0.9, 1.3 + Math.random() * 0.7, r() * 0.9);
          p.max = 1.1;
          p.size = 0.22 + Math.random() * 0.12;
          break;
        case "z":
          p.vel.set(0.18, 0.45, 0.05);
          p.max = 2.4;
          p.size = 0.14;
          p.grow = 0.12;
          break;
        case "star":
          p.vel.set(r() * 4, 1.5 + Math.random() * 2.5, r() * 4);
          p.max = 0.7;
          p.size = 0.2 + Math.random() * 0.15;
          p.gravity = 7;
          break;
        case "dust":
          p.vel.set(r() * 2.5, 0.3 + Math.random() * 0.6, r() * 2.5);
          p.max = 0.8;
          p.size = 0.35 + Math.random() * 0.3;
          p.grow = 0.5;
          break;
      }
      sprite.scale.setScalar(p.size);
      this.live.push(p);
    }
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life += dt;
      if (p.life >= p.max) {
        p.sprite.visible = false;
        this.group.remove(p.sprite);
        this.pool.push(p.sprite);
        this.live.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(1 - dt * 1.2);
      p.sprite.position.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      p.sprite.scale.setScalar((p.size + p.grow * k) * Math.min(1, p.life * 8));
      p.sprite.material.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }
  }
}
