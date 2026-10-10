import {
  CAT_COSTS,
  FURNITURE,
  MAX_CATS,
  UPGRADES,
  formatNumber,
  formatRate,
  upgradeCost,
  type FurnitureId,
  type UpgradeId,
} from "./game/economy";
import { COATS, COAT_COLORS, EYE_COLORS, type CatData, type SaveState, type TimeMode } from "./game/state";

export interface HudActions {
  state(): SaveState;
  rate(): number;
  buyUpgrade(id: UpgradeId): void;
  buyFurniture(id: FurnitureId): void;
  adoptCat(): void;
  updateCat(id: string, patch: Partial<CatData>): void;
  setMuted(muted: boolean): void;
  setTimeMode(mode: TimeMode): void;
  reset(): void;
  capture(): HTMLCanvasElement;
  setInputEnabled(enabled: boolean): void;
}

type Panel = "shop" | "cats" | "settings";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export class Hud {
  private hearts = $("#hearts");
  private rateEl = $("#rate");
  private combo = $("#combo");
  private hintEl = $("#hint");
  private sheet = $("#sheet");
  private body = $("#sheet-body");
  private title = $("#sheet-title");
  private panel: Panel | null = null;
  private editing: string | null = null;
  private shownHearts = 0;

  constructor(private a: HudActions) {
    document.querySelectorAll<HTMLButtonElement>("[data-panel]").forEach((b) =>
      b.addEventListener("click", () => {
        const p = b.dataset.panel as Panel;
        if (this.panel === p) this.close();
        else this.open(p);
      }),
    );
    $("#sheet-close").addEventListener("click", () => this.close());
    this.body.addEventListener("click", (e) => this.onClick(e));
    this.body.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.name === "cat-name" && this.editing) this.a.updateCat(this.editing, { name: el.value.slice(0, 20) || "Katt" });
    });
    this.setupPhoto();
  }

  // ---------- frame update ----------

  update(dt: number, comboMult: number) {
    const s = this.a.state();
    // Count up smoothly instead of jumping
    this.shownHearts += (s.hearts - this.shownHearts) * Math.min(1, dt * 12);
    if (Math.abs(s.hearts - this.shownHearts) < 1) this.shownHearts = s.hearts;
    this.hearts.textContent = formatNumber(this.shownHearts);
    this.rateEl.textContent = `+${formatRate(this.a.rate())} ❤/s`;
    this.combo.classList.toggle("hidden", comboMult <= 1);
    if (comboMult > 1) this.combo.textContent = `Combo ×${formatRate(comboMult)}`;
    if (this.panel) {
      this.body.querySelectorAll<HTMLButtonElement>("button[data-cost]").forEach((b) => {
        b.disabled = Number(b.dataset.cost) > s.hearts;
      });
    }
  }

  bump() {
    this.hearts.parentElement!.classList.remove("bump");
    void this.hearts.offsetWidth;
    this.hearts.parentElement!.classList.add("bump");
  }

  float(x: number, y: number, text: string, cls = "") {
    const el = document.createElement("div");
    el.className = `float ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    $("#floats").appendChild(el);
    el.addEventListener("animationend", () => el.remove());
  }

  toast(text: string, ms = 3500) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    $("#toasts").appendChild(el);
    setTimeout(() => el.classList.add("out"), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  hint(text: string | null) {
    this.hintEl.classList.toggle("hidden", !text);
    if (text && this.hintEl.textContent !== text) this.hintEl.textContent = text;
  }

  // ---------- sheets ----------

  open(panel: Panel) {
    this.panel = panel;
    this.editing = null;
    this.sheet.classList.remove("hidden");
    document.querySelectorAll<HTMLButtonElement>("[data-panel]").forEach((b) => b.classList.toggle("active", b.dataset.panel === panel));
    this.render();
  }

  close() {
    this.panel = null;
    this.editing = null;
    this.sheet.classList.add("hidden");
    document.querySelectorAll("[data-panel]").forEach((b) => b.classList.remove("active"));
  }

  render() {
    const s = this.a.state();
    if (this.panel === "shop") {
      this.title.textContent = "Butik";
      this.body.innerHTML = this.shopHtml(s);
    } else if (this.panel === "cats") {
      const cat = s.cats.find((c) => c.id === this.editing);
      this.title.textContent = cat ? `Ändra ${cat.name}` : "Katter";
      this.body.innerHTML = cat ? this.editorHtml(cat) : this.catsHtml(s);
    } else if (this.panel === "settings") {
      this.title.textContent = "Mer";
      this.body.innerHTML = this.settingsHtml(s);
    }
    this.update(0, 1);
  }

  private shopHtml(s: SaveState) {
    const ups = UPGRADES.map((u) => {
      const lvl = s.upgrades[u.id];
      const maxed = lvl >= u.max;
      const cost = upgradeCost(u, lvl);
      return `<div class="card">
        <div class="icon">${u.icon}</div>
        <div class="info"><b>${u.name} <span class="lvl">nivå ${lvl}</span></b><small>${u.desc}</small></div>
        ${maxed ? `<button disabled>Max</button>` : `<button class="buy" data-act="upgrade" data-id="${u.id}" data-cost="${cost}">❤ ${formatNumber(cost)}</button>`}
      </div>`;
    }).join("");
    const furn = FURNITURE.map((f) => {
      const owned = s.furniture.includes(f.id);
      return `<div class="card ${owned ? "owned" : ""}">
        <div class="icon">${f.icon}</div>
        <div class="info"><b>${f.name}</b><small>${f.desc} <span class="rate">+${formatRate(f.rate)} ❤/s</span></small></div>
        ${owned ? `<button disabled>Köpt ✓</button>` : `<button class="buy" data-act="furniture" data-id="${f.id}" data-cost="${f.cost}">❤ ${formatNumber(f.cost)}</button>`}
      </div>`;
    }).join("");
    return `<h3>Uppgraderingar</h3>${ups}<h3>Möbler och leksaker</h3>${furn}`;
  }

  private catsHtml(s: SaveState) {
    const rows = s.cats.map((c) => {
      const coat = COATS.find((x) => x.id === c.coat)?.name ?? "";
      return `<div class="card">
        <div class="swatch" style="background:${c.color}"></div>
        <div class="info"><b>${esc(c.name)}</b><small>${coat}</small></div>
        <button data-act="edit" data-id="${c.id}">Ändra</button>
      </div>`;
    }).join("");
    const n = s.cats.length;
    const adopt = n >= MAX_CATS
      ? `<p class="muted">Rummet är fullt, ${MAX_CATS} katter är max.</p>`
      : `<button class="buy wide" data-act="adopt" data-cost="${CAT_COSTS[n]}">🐱 Adoptera en katt till · ❤ ${formatNumber(CAT_COSTS[n])}</button>`;
    return `${rows}${adopt}<p class="muted">Varje katt ger +0,5 ❤/s och har sin egen personlighet.</p>`;
  }

  private editorHtml(c: CatData) {
    const chip = (act: string, value: string, label: string, on: boolean, style = "") =>
      `<button class="chip ${on ? "on" : ""}" data-act="${act}" data-value="${value}" style="${style}">${label}</button>`;
    return `
      <label class="field">Namn<input name="cat-name" maxlength="20" value="${esc(c.name)}" autocomplete="off"></label>
      <div class="field">Päls<div class="chips">${COATS.map((x) => chip("coat", x.id, x.name, x.id === c.coat)).join("")}</div></div>
      <div class="field">Färg<div class="chips">${COAT_COLORS.map((x) => chip("color", x.hex, "", x.hex === c.color, `background:${x.hex}`)).join("")}</div></div>
      <div class="field">Ögon<div class="chips">${EYE_COLORS.map((x) => chip("eyes", x, "", x === c.eyes, `background:${x}`)).join("")}</div></div>
      <button class="wide" data-act="back">Klar</button>`;
  }

  private settingsHtml(s: SaveState) {
    const modes: [TimeMode, string][] = [["auto", "Riktig tid"], ["day", "Dag"], ["evening", "Kväll"], ["night", "Natt"]];
    return `
      <div class="field">Ljud<div class="chips">
        <button class="chip ${!s.muted ? "on" : ""}" data-act="sound" data-value="on">🔊 På</button>
        <button class="chip ${s.muted ? "on" : ""}" data-act="sound" data-value="off">🔇 Av</button>
      </div></div>
      <div class="field">Tid på dygnet<div class="chips">${modes.map(([m, l]) => `<button class="chip ${s.timeMode === m ? "on" : ""}" data-act="time" data-value="${m}">${l}</button>`).join("")}</div></div>
      <div class="stats">
        <div><b>${formatNumber(s.stats.pets)}</b><small>klappar</small></div>
        <div><b>${formatNumber(s.stats.pounces)}</b><small>fångade prickar</small></div>
        <div><b>${formatNumber(s.stats.knocks)}</b><small>saker på golvet</small></div>
        <div><b>${formatNumber(s.totalHearts)}</b><small>❤ totalt</small></div>
      </div>
      <p class="muted"><b>Spela som en app:</b> på iPhone, tryck Dela och sedan "Lägg till på hemskärmen". På Android, öppna menyn och välj "Installera app".</p>
      <p class="muted">Styrning: dra över en katt för att klappa, håll på golvet för laser, tryck på saker för att knuffa dem, dra i bakgrunden för att vrida och nyp för att zooma.</p>
      <button class="danger wide" data-act="reset">Börja om från början</button>`;
  }

  private onClick(e: Event) {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn || btn.disabled) return;
    const { act, id, value } = btn.dataset;
    switch (act) {
      case "upgrade":
        this.a.buyUpgrade(id as UpgradeId);
        break;
      case "furniture":
        this.a.buyFurniture(id as FurnitureId);
        break;
      case "adopt":
        this.a.adoptCat();
        break;
      case "edit":
        this.editing = id!;
        break;
      case "back":
        this.editing = null;
        break;
      case "coat":
      case "color":
      case "eyes":
        if (this.editing) this.a.updateCat(this.editing, { [act]: value });
        break;
      case "sound":
        this.a.setMuted(value === "off");
        break;
      case "time":
        this.a.setTimeMode(value as TimeMode);
        break;
      case "reset":
        if (confirm("Vill du verkligen börja om? Alla katter, möbler och ❤ försvinner.")) this.a.reset();
        break;
    }
    this.render();
  }

  // ---------- photo mode ----------

  private setupPhoto() {
    const overlay = $("#photo");
    const result = $("#photo-result");
    const img = $<HTMLImageElement>("#photo-img");
    let blob: Blob | null = null;

    const exit = () => {
      document.body.classList.remove("photo-mode");
      overlay.classList.add("hidden");
      result.classList.add("hidden");
      this.a.setInputEnabled(true);
    };
    $("#photo-btn").addEventListener("click", () => {
      this.close();
      document.body.classList.add("photo-mode");
      overlay.classList.remove("hidden");
    });
    $("#photo-close").addEventListener("click", exit);
    $("#photo-back").addEventListener("click", exit);
    $("#shutter").addEventListener("click", () => {
      const canvas = this.a.capture();
      overlay.classList.add("flash");
      setTimeout(() => overlay.classList.remove("flash"), 350);
      canvas.toBlob((b) => {
        blob = b;
        if (!b) return;
        img.src = URL.createObjectURL(b);
        result.classList.remove("hidden");
        this.a.setInputEnabled(false);
      }, "image/jpeg", 0.92);
    });
    $("#photo-share").addEventListener("click", async () => {
      if (!blob) return;
      const file = new File([blob], "kattrummet.jpg", { type: "image/jpeg" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Kattrummet" });
        } catch {
          // user cancelled
        }
      } else {
        const a = document.createElement("a");
        a.href = img.src;
        a.download = "kattrummet.jpg";
        a.click();
      }
    });
  }
}
