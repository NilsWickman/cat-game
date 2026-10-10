export type UpgradeId = "hand" | "laser" | "chaos" | "treats";
export type FurnitureId =
  | "box"
  | "yarn"
  | "lamp"
  | "bowl"
  | "cushion"
  | "plant"
  | "tree"
  | "shelf"
  | "aquarium";

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  icon: string;
  desc: string;
  baseCost: number;
  growth: number;
  max: number;
}

export interface FurnitureDef {
  id: FurnitureId;
  name: string;
  icon: string;
  desc: string;
  cost: number;
  rate: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: "hand", name: "Mjukare hand", icon: "🖐️", desc: "Mer ❤ per klapp", baseCost: 15, growth: 1.6, max: 40 },
  { id: "laser", name: "Laserpekare Pro", icon: "🔴", desc: "Mer ❤ när en katt fångar pricken", baseCost: 40, growth: 1.7, max: 30 },
  { id: "chaos", name: "Mer kaos", icon: "💥", desc: "Katterna knuffar ner saker oftare, och kraschen ger mer ❤", baseCost: 80, growth: 1.8, max: 20 },
  { id: "treats", name: "Godisburk", icon: "🍬", desc: "+15 % passiv inkomst per nivå", baseCost: 200, growth: 2.1, max: 25 },
];

export const FURNITURE: FurnitureDef[] = [
  { id: "box", name: "Kartong", icon: "📦", desc: "Om den passar, sitter den.", cost: 30, rate: 0.5 },
  { id: "yarn", name: "Garnboll", icon: "🧶", desc: "Katterna jagar den. Du kan också knuffa den.", cost: 75, rate: 1 },
  { id: "lamp", name: "Golvlampa", icon: "💡", desc: "Mysigt ljus på kvällen.", cost: 150, rate: 1.5 },
  { id: "bowl", name: "Matskål", icon: "🍲", desc: "Mätta katter är glada katter.", cost: 250, rate: 2.5 },
  { id: "cushion", name: "Solkudde", icon: "☀️", desc: "Bästa sovplatsen, under fönstret.", cost: 500, rate: 4 },
  { id: "plant", name: "Monstera", icon: "🪴", desc: "Snygg. Lite gnagd.", cost: 900, rate: 6 },
  { id: "tree", name: "Klätterträd", icon: "🌳", desc: "Utsikt från toppen.", cost: 1800, rate: 10 },
  { id: "shelf", name: "Hylla med prylar", icon: "🏺", desc: "Fler saker att knuffa ner.", cost: 3500, rate: 16 },
  { id: "aquarium", name: "Akvarium", icon: "🐠", desc: "Bättre än TV.", cost: 8000, rate: 30 },
];

/** Cost of the n:th cat (index 0 is the starting cat). */
export const CAT_COSTS = [0, 200, 1500, 7500, 30000];
export const MAX_CATS = CAT_COSTS.length;
export const CAT_RATE = 0.5;

export const OFFLINE_CAP_S = 8 * 3600;
export const OFFLINE_FACTOR = 0.5;

export function upgradeCost(def: UpgradeDef, level: number): number {
  return Math.ceil(def.baseCost * def.growth ** level);
}

export function petValue(handLevel: number): number {
  return Math.floor((1 + handLevel) * 1.12 ** handLevel);
}

export function pounceValue(laserLevel: number): number {
  return Math.floor(5 * (1 + laserLevel) * 1.1 ** laserLevel);
}

export function knockValue(chaosLevel: number): number {
  return Math.floor(15 * (1 + chaosLevel) * 1.12 ** chaosLevel);
}

export function passiveRate(furniture: FurnitureId[], catCount: number, treatsLevel: number): number {
  const fromFurniture = FURNITURE.filter((f) => furniture.includes(f.id)).reduce((sum, f) => sum + f.rate, 0);
  return (fromFurniture + catCount * CAT_RATE) * (1 + 0.15 * treatsLevel);
}

/** Hearts earned while away. Short absences give nothing so reloads don't spam a welcome toast. */
export function offlineEarnings(rate: number, elapsedMs: number): number {
  const seconds = Math.min(Math.max(elapsedMs / 1000, 0), OFFLINE_CAP_S);
  if (seconds < 30) return 0;
  return Math.floor(rate * seconds * OFFLINE_FACTOR);
}

/** Petting quickly builds a combo: every 10 pets in a row adds +0.5x, up to 3x. */
export function comboMultiplier(combo: number): number {
  return Math.min(3, 1 + Math.floor(combo / 10) * 0.5);
}

const UNITS = ["", "k", "M", " mdr", " bn"];

export function formatNumber(n: number): string {
  let i = 0;
  while (n >= 1000 && i < UNITS.length - 1) {
    n /= 1000;
    i++;
  }
  if (i === 0) return Math.floor(n).toString();
  const shown = n < 100 ? Math.floor(n * 10) / 10 : Math.floor(n);
  return shown.toString().replace(".", ",") + UNITS[i];
}

export function formatRate(n: number): string {
  if (n < 10) return (Math.round(n * 10) / 10).toString().replace(".", ",");
  return formatNumber(n);
}
