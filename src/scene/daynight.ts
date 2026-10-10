import * as THREE from "three";
import type { TimeMode } from "../game/state";
import type { Room } from "./room";

export function hoursFor(mode: TimeMode, now = new Date()): number {
  switch (mode) {
    case "day":
      return 13;
    case "evening":
      return 19.5;
    case "night":
      return 23.5;
    default:
      return now.getHours() + now.getMinutes() / 60;
  }
}

const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const C = (hex: string) => new THREE.Color(hex);
const SKY = {
  night: [C("#0f1b3d"), C("#2b3a66")],
  day: [C("#6ec3f4"), C("#d3f0fd")],
  dusk: [C("#e9845e"), C("#fad49c")],
};
const BG = {
  night: ["#1b2140", "#3a2f52"],
  day: ["#ffe9d6", "#f7c6b0"],
  dusk: ["#f5b38a", "#c98bb0"],
};

export class Lighting {
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0xd8b59a, 1.4);
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  /** 0 at night, 1 in full daylight. */
  day = 1;

  constructor(scene: THREE.Scene, private room: Room) {
    const s = this.sun;
    s.position.set(6, 11, 7);
    s.castShadow = true;
    s.shadow.mapSize.set(1024, 1024);
    s.shadow.camera.left = -7;
    s.shadow.camera.right = 7;
    s.shadow.camera.top = 7;
    s.shadow.camera.bottom = -7;
    s.shadow.camera.near = 1;
    s.shadow.camera.far = 30;
    s.shadow.bias = -0.0005;
    s.shadow.normalBias = 0.02;
    scene.add(this.hemi, s, s.target);
  }

  apply(hours: number) {
    const day = (this.day = smooth(5.5, 8, hours) * (1 - smooth(18, 21, hours)));
    const dusk = Math.max(0, 1 - Math.abs(hours - 19.3) / 1.6, 1 - Math.abs(hours - 6.8) / 1.2);
    const r = this.room;

    const top = SKY.night[0].clone().lerp(SKY.day[0], day).lerp(SKY.dusk[0], dusk * 0.75);
    const bottom = SKY.night[1].clone().lerp(SKY.day[1], day).lerp(SKY.dusk[1], dusk * 0.75);
    r.skyUniforms.top.value.copy(top);
    r.skyUniforms.bottom.value.copy(bottom);
    (r.stars.material as THREE.PointsMaterial).opacity = 1 - day;
    r.moonDisc.material.opacity = 1 - day;
    r.sunDisc.material.opacity = day;
    r.sunDisc.position.y = -0.2 + 0.6 * day;
    r.sunPatch.material.opacity = 0.3 * day * (1 - dusk * 0.5);

    this.hemi.intensity = 0.7 + 0.9 * day;
    this.hemi.color.set("#6f7fb8").lerp(C("#ffffff"), day);
    this.sun.intensity = 0.5 + 1.7 * day;
    this.sun.color.set("#8ea2ff").lerp(C("#fff2df"), day).lerp(C("#ffad6b"), dusk * 0.6);

    const lampOn = r.owned.has("lamp") ? 1 - day : 0;
    r.lampLight.intensity = lampOn * 9;
    r.lampShade.emissive.set("#ffcf7a").multiplyScalar(lampOn * 0.9);

    const pickBg = (i: number) =>
      C(BG.night[i]).lerp(C(BG.day[i]), day).lerp(C(BG.dusk[i]), dusk * 0.6).getStyle();
    const root = document.documentElement.style;
    root.setProperty("--bg-top", pickBg(0));
    root.setProperty("--bg-bottom", pickBg(1));
    root.setProperty("--ink", day > 0.4 ? "#4a2f2a" : "#f5e9e2");
  }
}
