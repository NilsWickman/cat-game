import { describe, expect, it } from "vitest";
import {
  UPGRADES,
  comboMultiplier,
  formatNumber,
  formatRate,
  offlineEarnings,
  passiveRate,
  petValue,
  upgradeCost,
} from "./economy";
import { defaultState, loadState, randomCat, sanitize, saveState } from "./state";

describe("economy", () => {
  it("upgrade costs grow and start at base cost", () => {
    const hand = UPGRADES.find((u) => u.id === "hand")!;
    expect(upgradeCost(hand, 0)).toBe(15);
    expect(upgradeCost(hand, 1)).toBeGreaterThan(upgradeCost(hand, 0));
    expect(upgradeCost(hand, 10)).toBeGreaterThan(upgradeCost(hand, 9));
  });

  it("pet value starts at 1 and increases every level", () => {
    expect(petValue(0)).toBe(1);
    for (let l = 0; l < 40; l++) expect(petValue(l + 1)).toBeGreaterThan(petValue(l));
  });

  it("passive rate sums furniture and cats, scaled by treats", () => {
    expect(passiveRate([], 1, 0)).toBe(0.5);
    expect(passiveRate(["box", "yarn"], 2, 0)).toBe(0.5 + 1 + 1);
    expect(passiveRate(["box"], 1, 2)).toBeCloseTo(1 * 1.3);
  });

  it("offline earnings ignore short absences and cap at 8 hours", () => {
    expect(offlineEarnings(10, 10_000)).toBe(0);
    expect(offlineEarnings(10, 60_000)).toBe(300);
    expect(offlineEarnings(10, 100 * 3600_000)).toBe(offlineEarnings(10, 8 * 3600_000));
    expect(offlineEarnings(10, -5000)).toBe(0);
  });

  it("combo multiplier steps up and caps at 3x", () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(10)).toBe(1.5);
    expect(comboMultiplier(1000)).toBe(3);
  });

  it("formats numbers the Swedish way", () => {
    expect(formatNumber(999.9)).toBe("999");
    expect(formatNumber(1234)).toBe("1,2k");
    expect(formatNumber(250_000)).toBe("250k");
    expect(formatNumber(3_400_000)).toBe("3,4M");
    expect(formatRate(2.25)).toBe("2,3");
  });
});

describe("state", () => {
  it("sanitize falls back to defaults for garbage", () => {
    expect(sanitize(null, 5)).toEqual(defaultState(5));
    expect(sanitize("nope", 5)).toEqual(defaultState(5));
  });

  it("sanitize clamps and filters invalid fields", () => {
    const s = sanitize(
      {
        hearts: -10,
        upgrades: { hand: 999, laser: "x" },
        furniture: ["box", "spaceship", "box"],
        cats: [{ name: "Ada", coat: "dragon", color: "red", size: 5 }],
        timeMode: "midnight",
      },
      0,
    );
    expect(s.hearts).toBe(0);
    expect(s.upgrades.hand).toBe(40);
    expect(s.upgrades.laser).toBe(0);
    expect(s.furniture).toEqual(["box"]);
    expect(s.cats[0].name).toBe("Ada");
    expect(s.cats[0].coat).toBe("tabby");
    expect(s.cats[0].color).toBe("#e8913a");
    expect(s.cats[0].size).toBe(1.2);
    expect(s.timeMode).toBe("auto");
  });

  it("round-trips through storage", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const s = defaultState(1);
    s.hearts = 42;
    s.furniture = ["yarn"];
    s.cats.push(randomCat(s.cats, () => 0.5));
    saveState(storage, s);
    expect(loadState(storage, 2)).toEqual(s);
  });

  it("random cats avoid names already in use", () => {
    const first = defaultState(0).cats;
    for (let i = 0; i < 20; i++) expect(randomCat(first).name).not.toBe("Misse");
  });
});
