import * as THREE from "three";
import "./style.css";
import { Sfx } from "./audio";
import { Cat, type CatWorld } from "./cat/cat";
import {
  CAT_COSTS,
  FURNITURE,
  MAX_CATS,
  UPGRADES,
  comboMultiplier,
  formatNumber,
  knockValue,
  offlineEarnings,
  passiveRate,
  petValue,
  pounceValue,
  upgradeCost,
} from "./game/economy";
import { clearState, defaultState, loadState, randomCat, saveState } from "./game/state";
import { Input } from "./input";
import { CameraRig } from "./scene/cameraRig";
import { Lighting, hoursFor } from "./scene/daynight";
import { Fx } from "./scene/fx";
import { Laser } from "./scene/laser";
import { Physics, type Knockable } from "./scene/physics";
import { ROOM_HALF, Room } from "./scene/room";
import { Hud } from "./ui";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const physics = new Physics();
const room = new Room(physics);
const lighting = new Lighting(scene, room);
const fx = new Fx();
const laser = new Laser();
const rig = new CameraRig();
const sfx = new Sfx();
scene.add(room.group, fx.group, laser.group);

let state = loadState(localStorage, Date.now());
sfx.setMuted(state.muted);

const rate = () => passiveRate(state.furniture, state.cats.length, state.upgrades.treats);

const world: CatWorld = {
  room,
  physics,
  laser,
  fx,
  sfx,
  camera: rig.camera,
  cats: [],
  night: false,
  chaosLevel: state.upgrades.chaos,
  reservations: new Map(),
  onPounce(cat, at) {
    const n = pounceValue(state.upgrades.laser);
    earn(n);
    state.stats.pounces++;
    fx.emit("star", at.clone().setY(0.3), 8);
    floatAt(at, `+${formatNumber(n)} ❤`, "big");
    cat.model.boop(5);
  },
};

function spawnCats() {
  for (const c of world.cats) {
    scene.remove(c.model.root);
    c.model.dispose();
  }
  world.cats = state.cats.map((d) => new Cat(d, world));
  world.reservations.clear();
  for (const c of world.cats) scene.add(c.model.root);
}
spawnCats();
room.setOwned(state.furniture);

// ---------- economy ----------

function earn(n: number) {
  state.hearts += n;
  state.totalHearts += n;
  hud.bump();
}

function spend(cost: number): boolean {
  if (state.hearts < cost) return false;
  state.hearts -= cost;
  sfx.coin();
  vibrate(15);
  return true;
}

const tmpV = new THREE.Vector3();
function toScreen(p: THREE.Vector3) {
  tmpV.copy(p).project(rig.camera);
  return { x: ((tmpV.x + 1) / 2) * window.innerWidth, y: ((1 - tmpV.y) / 2) * window.innerHeight };
}

function floatAt(p: THREE.Vector3, text: string, cls = "") {
  const s = toScreen(p);
  hud.float(s.x, s.y, text, cls);
}

function vibrate(pattern: number | number[]) {
  navigator.vibrate?.(pattern);
}

let combo = 0;
let lastPetAt = 0;
let lastPurrAt = -10;
let clock = 0;

function onCrash(item: Knockable) {
  const n = knockValue(state.upgrades.chaos);
  earn(n);
  state.stats.knocks++;
  const p = item.mesh.position.clone();
  fx.emit("dust", p, 10);
  fx.emit("star", p, 5);
  sfx.crash();
  vibrate(35);
  floatAt(p.setY(0.6), `KRASCH! +${formatNumber(n)} ❤`, "big crash");
}

// ---------- HUD ----------

const hud = new Hud({
  state: () => state,
  rate,
  buyUpgrade(id) {
    const def = UPGRADES.find((u) => u.id === id)!;
    const lvl = state.upgrades[id];
    if (lvl >= def.max || !spend(upgradeCost(def, lvl))) return;
    state.upgrades[id] = lvl + 1;
    world.chaosLevel = state.upgrades.chaos;
    persist();
  },
  buyFurniture(id) {
    const def = FURNITURE.find((f) => f.id === id)!;
    if (state.furniture.includes(id) || !spend(def.cost)) return;
    state.furniture.push(id);
    room.setOwned(state.furniture);
    const grp = room.furniture.get(id);
    if (grp) {
      fx.emit("star", grp.position.clone().setY(1), 12);
      floatAt(grp.position.clone().setY(1.2), `${def.icon} ${def.name}!`, "big");
    }
    persist();
  },
  adoptCat() {
    const n = state.cats.length;
    if (n >= MAX_CATS || !spend(CAT_COSTS[n])) return;
    const data = randomCat(state.cats);
    state.cats.push(data);
    const cat = new Cat(data, world);
    world.cats.push(cat);
    scene.add(cat.model.root);
    fx.emit("heart", cat.pos.clone().setY(1), 10);
    sfx.meow(cat.pitch);
    hud.toast(`Välkommen hem, ${data.name}! 🐱`);
    persist();
  },
  updateCat(id, patch) {
    const data = state.cats.find((c) => c.id === id);
    const cat = world.cats.find((c) => c.data.id === id);
    if (!data || !cat) return;
    Object.assign(data, patch);
    if (!("name" in patch)) cat.setData(data);
    persist();
  },
  setMuted(muted) {
    state.muted = muted;
    sfx.setMuted(muted);
    persist();
  },
  setTimeMode(mode) {
    state.timeMode = mode;
    persist();
  },
  reset() {
    clearState(localStorage);
    state = defaultState(Date.now());
    world.chaosLevel = 0;
    room.setOwned([]);
    spawnCats();
    hud.close();
    persist();
  },
  capture,
  setInputEnabled(enabled) {
    input.enabled = enabled;
  },
});

// ---------- input ----------

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function setRay(x: number, y: number) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, rig.camera);
}

const input = new Input(canvas, rig, laser, {
  cat(x, y) {
    setRay(x, y);
    // Generous hit spheres make small cats easy to pet on a phone
    let best: { cat: Cat; point: THREE.Vector3 } | null = null;
    let bestT = Infinity;
    for (const cat of world.cats) {
      const center = cat.model.root.localToWorld(new THREE.Vector3(0, 0.55, 0.15));
      const r = 0.62 * cat.data.size;
      if (raycaster.ray.distanceSqToPoint(center) > r * r) continue;
      const t = raycaster.ray.origin.distanceTo(center);
      if (t < bestT) {
        bestT = t;
        const point = new THREE.Vector3();
        raycaster.ray.closestPointToPoint(center, point);
        best = { cat, point };
      }
    }
    return best;
  },
  item(x, y) {
    setRay(x, y);
    const targets: [THREE.Object3D, Knockable["body"]][] = physics.items
      .filter((i) => i.enabled)
      .map((i) => [i.mesh, i.body]);
    if (physics.yarn) targets.push([physics.yarn.mesh, physics.yarn.body]);
    const hit = raycaster.intersectObjects(targets.map((t) => t[0]), true)[0];
    if (!hit) return null;
    for (const [mesh, body] of targets) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (o === mesh) return body;
        o = o.parent;
      }
    }
    return null;
  },
  floor(x, y) {
    setRay(x, y);
    const p = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
    if (!p || Math.abs(p.x) > ROOM_HALF - 0.1 || Math.abs(p.z) > ROOM_HALF - 0.1) return null;
    return p;
  },
}, {
  firstGesture() {
    sfx.unlock();
  },
  pet(cat, point, x, y) {
    combo = clock - lastPetAt < 1 ? combo + 1 : 0;
    lastPetAt = clock;
    const n = Math.round(petValue(state.upgrades.hand) * comboMultiplier(combo));
    earn(n);
    state.stats.pets++;
    cat.pet();
    fx.emit("heart", point);
    sfx.pop();
    vibrate(8);
    hud.float(x, y - 30, `+${formatNumber(n)}`);
    if (clock - lastPurrAt > 1.6) {
      lastPurrAt = clock;
      hud.float(x + 40, y - 70, "prrr ♪", "purr");
      // Android can feel the purr; iOS ignores vibrate
      vibrate([10, 30, 10, 30, 10, 30, 10, 30, 10]);
    }
  },
  tap(cat) {
    cat.tap();
  },
  flick(body, impulse) {
    physics.push(body, impulse);
    sfx.whoosh();
  },
});

// ---------- photo ----------

function capture(): HTMLCanvasElement {
  renderer.render(scene, rig.camera);
  const src = renderer.domElement;
  const W = 1080;
  const pad = 48;
  const inner = W - pad * 2;
  const innerH = Math.round(inner * 1.15);
  const out = document.createElement("canvas");
  out.width = W;
  out.height = innerH + pad + 190;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fffaf3";
  ctx.fillRect(0, 0, out.width, out.height);
  const css = getComputedStyle(document.documentElement);
  const grad = ctx.createLinearGradient(0, pad, 0, pad + innerH);
  grad.addColorStop(0, css.getPropertyValue("--bg-top").trim() || "#ffe9d6");
  grad.addColorStop(1, css.getPropertyValue("--bg-bottom").trim() || "#f7c6b0");
  ctx.fillStyle = grad;
  ctx.fillRect(pad, pad, inner, innerH);
  // Crop the render to the frame's aspect ("cover")
  const ar = inner / innerH;
  let sw = src.width;
  let sh = src.width / ar;
  if (sh > src.height) {
    sh = src.height;
    sw = sh * ar;
  }
  ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, pad, pad, inner, innerH);
  ctx.fillStyle = "#4a2f2a";
  ctx.textAlign = "center";
  ctx.font = "600 56px 'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive";
  ctx.fillText(state.cats.map((c) => c.name).join(", "), W / 2, innerH + pad + 95);
  ctx.font = "32px system-ui, sans-serif";
  ctx.fillStyle = "#9a7b70";
  ctx.fillText(`Kattrummet · ${new Date().toLocaleDateString("sv-SE")}`, W / 2, innerH + pad + 150);
  sfx.shutter();
  return out;
}

// ---------- tutorial hints ----------

const HINTS: { text: string; done: () => boolean }[] = [
  { text: "Dra fingret fram och tillbaka över katten för att klappa 🐾", done: () => state.stats.pets >= 8 },
  { text: "Håll fingret på golvet, du har en laserpekare! 🔴", done: () => state.stats.pounces >= 1 },
  { text: "Snyggt! Öppna butiken 🛒 och köp något åt katterna", done: () => state.furniture.length > 0 || state.upgrades.hand > 0 },
  { text: "Tips: nyp för att zooma, dra i bakgrunden för att vrida rummet", done: () => hintAge > 8 },
];
let hintAge = 0;

function updateHint(dt: number) {
  const h = HINTS[state.hint];
  if (!h) return hud.hint(null);
  hintAge += dt;
  if (h.done()) {
    state.hint++;
    hintAge = 0;
  }
  hud.hint(HINTS[state.hint]?.text ?? null);
}

// ---------- persistence ----------

function persist() {
  state.lastSeen = Date.now();
  saveState(localStorage, state);
}
setInterval(persist, 5000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) persist();
  else welcomeBack();
});
window.addEventListener("pagehide", persist);

function welcomeBack() {
  const away = Date.now() - state.lastSeen;
  const earned = offlineEarnings(rate(), away);
  if (earned > 0) {
    earn(earned);
    hud.toast(`Välkommen tillbaka! Katterna samlade ❤ ${formatNumber(earned)} medan du var borta.`, 5000);
  }
  if (away > 120_000) for (const c of world.cats) c.startNap();
  persist();
}
welcomeBack();

// ---------- loop ----------

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  rig.resize(w, h);
}
window.addEventListener("resize", resize);
resize();

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  clock += dt;

  const hours = hoursFor(state.timeMode);
  lighting.apply(hours);
  world.night = lighting.day < 0.35;
  room.update(clock, hours);

  physics.update(dt, onCrash);
  laser.update(dt, clock);
  let purr = 0;
  for (const cat of world.cats) {
    cat.update(dt, clock);
    purr = Math.max(purr, cat.purr);
  }
  sfx.purr(purr);
  fx.update(dt);
  rig.update(dt);

  const passive = rate() * dt;
  state.hearts += passive;
  state.totalHearts += passive;
  if (clock - lastPetAt > 1) combo = 0;
  hud.update(dt, comboMultiplier(combo));
  updateHint(dt);

  renderer.render(scene, rig.camera);
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

// Handy for manual testing in the console
if (import.meta.env.DEV) {
  Object.assign(window, { game: { get state() { return state; }, world, physics, rig, persist, room, sfx } });
}

