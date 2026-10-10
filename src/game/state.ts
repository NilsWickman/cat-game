import { FURNITURE, MAX_CATS, UPGRADES, type FurnitureId, type UpgradeId } from "./economy";

export type CoatId = "solid" | "tabby" | "tuxedo" | "calico" | "siamese";
export type TimeMode = "auto" | "day" | "evening" | "night";

export interface CatData {
  id: string;
  name: string;
  coat: CoatId;
  color: string;
  eyes: string;
  /** 0..1, how much the cat likes to nap. */
  lazy: number;
  /** 0..1, how much the cat likes to cause trouble. */
  playful: number;
  size: number;
}

export interface Stats {
  pets: number;
  pounces: number;
  knocks: number;
}

export interface SaveState {
  version: 1;
  hearts: number;
  totalHearts: number;
  upgrades: Record<UpgradeId, number>;
  furniture: FurnitureId[];
  cats: CatData[];
  lastSeen: number;
  muted: boolean;
  timeMode: TimeMode;
  /** Index of the next tutorial hint to show. */
  hint: number;
  stats: Stats;
}

export const COATS: { id: CoatId; name: string }[] = [
  { id: "tabby", name: "Tabby" },
  { id: "solid", name: "Enfärgad" },
  { id: "tuxedo", name: "Smoking" },
  { id: "calico", name: "Trefärgad" },
  { id: "siamese", name: "Siames" },
];

export const COAT_COLORS = [
  { name: "Orange", hex: "#e8913a" },
  { name: "Grå", hex: "#8d929b" },
  { name: "Svart", hex: "#35302f" },
  { name: "Vit", hex: "#f3ede6" },
  { name: "Kräm", hex: "#ead2a8" },
  { name: "Brun", hex: "#7f5638" },
  { name: "Blågrå", hex: "#71819a" },
];

export const EYE_COLORS = ["#8cc63f", "#f0b429", "#4aa8e8", "#d4823a"];

export const CAT_NAMES = [
  "Misse", "Smulan", "Sixten", "Doris", "Pixel", "Kanel", "Morris",
  "Leia", "Pelle", "Saga", "Tiger", "Nisse", "Ronja", "Gösta",
];

const STORAGE_KEY = "kattrummet-save-v1";

type Rng = () => number;

function pick<T>(list: readonly T[], rng: Rng): T {
  return list[Math.floor(rng() * list.length)];
}

export function randomCat(existing: CatData[], rng: Rng = Math.random): CatData {
  const used = new Set(existing.map((c) => c.name));
  const names = CAT_NAMES.filter((n) => !used.has(n));
  return {
    id: Math.floor(rng() * 1e9).toString(36),
    name: pick(names.length ? names : CAT_NAMES, rng),
    coat: pick(COATS, rng).id,
    color: pick(COAT_COLORS, rng).hex,
    eyes: pick(EYE_COLORS, rng),
    lazy: 0.2 + rng() * 0.7,
    playful: 0.2 + rng() * 0.7,
    size: 0.9 + rng() * 0.2,
  };
}

export function defaultState(now: number): SaveState {
  return {
    version: 1,
    hearts: 0,
    totalHearts: 0,
    upgrades: { hand: 0, laser: 0, chaos: 0, treats: 0 },
    furniture: [],
    cats: [
      { id: "first", name: "Misse", coat: "tabby", color: "#e8913a", eyes: "#8cc63f", lazy: 0.45, playful: 0.75, size: 1 },
    ],
    lastSeen: now,
    muted: false,
    timeMode: "auto",
    hint: 0,
    stats: { pets: 0, pounces: 0, knocks: 0 },
  };
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === "string" && v.length > 0 ? v : fallback);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function sanitizeCat(raw: unknown, fallback: CatData): CatData {
  const r = (raw ?? {}) as Partial<CatData>;
  return {
    id: str(r.id, fallback.id),
    name: str(r.name, fallback.name).slice(0, 20),
    coat: COATS.some((c) => c.id === r.coat) ? (r.coat as CoatId) : fallback.coat,
    color: /^#[0-9a-f]{6}$/i.test(r.color ?? "") ? r.color! : fallback.color,
    eyes: /^#[0-9a-f]{6}$/i.test(r.eyes ?? "") ? r.eyes! : fallback.eyes,
    lazy: clamp01(num(r.lazy, fallback.lazy)),
    playful: clamp01(num(r.playful, fallback.playful)),
    size: Math.min(1.2, Math.max(0.8, num(r.size, fallback.size))),
  };
}

/** Turns whatever is in storage into a valid state, falling back to defaults field by field. */
export function sanitize(raw: unknown, now: number): SaveState {
  const d = defaultState(now);
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<SaveState>;
  const upgrades = { ...d.upgrades };
  for (const u of UPGRADES) {
    upgrades[u.id] = Math.min(u.max, Math.max(0, Math.floor(num(r.upgrades?.[u.id], 0))));
  }
  const furniture = Array.isArray(r.furniture)
    ? FURNITURE.map((f) => f.id).filter((id) => r.furniture!.includes(id))
    : [];
  const cats = Array.isArray(r.cats) && r.cats.length > 0
    ? r.cats.slice(0, MAX_CATS).map((c, i) => sanitizeCat(c, i === 0 ? d.cats[0] : randomCat([])))
    : d.cats;
  const ids = new Set<string>();
  for (const c of cats) {
    while (ids.has(c.id)) c.id += "x";
    ids.add(c.id);
  }
  return {
    version: 1,
    hearts: Math.max(0, num(r.hearts, 0)),
    totalHearts: Math.max(0, num(r.totalHearts, 0)),
    upgrades,
    furniture,
    cats,
    lastSeen: num(r.lastSeen, now),
    muted: r.muted === true,
    timeMode: (["auto", "day", "evening", "night"] as const).includes(r.timeMode as TimeMode) ? r.timeMode! : "auto",
    hint: Math.max(0, Math.floor(num(r.hint, 0))),
    stats: {
      pets: num(r.stats?.pets, 0),
      pounces: num(r.stats?.pounces, 0),
      knocks: num(r.stats?.knocks, 0),
    },
  };
}

type KV = Pick<Storage, "getItem" | "setItem">;

export function loadState(storage: KV, now: number): SaveState {
  try {
    const text = storage.getItem(STORAGE_KEY);
    return sanitize(text ? JSON.parse(text) : null, now);
  } catch {
    return defaultState(now);
  }
}

export function saveState(storage: KV, state: SaveState): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked (private mode). The game still works, it just won't persist.
  }
}

export function clearState(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(STORAGE_KEY);
}
