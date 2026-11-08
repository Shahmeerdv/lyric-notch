import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Media { title: string; artist: string; position_ms: number; duration_ms: number; playing: boolean; has_art: boolean }
interface Line { t: number; text: string }

const $ = (id: string) => document.getElementById(id)!;
const notch = $("notch");
const artEl = $("art") as HTMLImageElement;
// SMTC position lags real playback; show lines slightly early.
let leadMs = Number(localStorage.getItem("leadMs") ?? 400);
const setLead = (v: number) => { leadMs = v; localStorage.setItem("leadMs", String(v)); };

// ---- Preferences (toggles) ----
const PREFS = ["glow", "spin", "eq", "float"] as const;
type Pref = (typeof PREFS)[number];
const pref = (k: Pref) => localStorage.getItem(`pref-${k}`) !== "off";
const applyPrefs = () => PREFS.forEach((k) => document.documentElement.classList.toggle(`no-${k}`, !pref(k)));
applyPrefs();

// ---- Custom right-click menu ----
// The window is tiny, so grow it while the menu is open and shrink it back after.
const menuEl = $("menu");
const leadVal = $("lead-val");
const BASE_W = 520, BASE_H = 158;
let size = Number(localStorage.getItem("size") ?? 1); // notch scale: 0.8 small, 1 medium, 1.25 large
const winW = () => BASE_W * size;
const FLOAT_GAP = 12; // px between screen top and the floating notch
const gap = () => (pref("float") ? FLOAT_GAP : 0);
const winH = () => BASE_H * size + gap();
const menuWinH = () => Math.max(400, 148 * size + 335 + gap());
const resizeWindow = (menu: boolean) => invoke("set_window_size", { width: winW(), height: menu ? menuWinH() : winH() });
const applySize = () => { notch.style.zoom = String(size); resizeWindow(menuOpen); };

let menuOpen = false;

// ---- Accent color: "auto" follows the cover, otherwise a fixed theme color ----
const DEFAULT_ACCENT = "#1db954";
let coverAccent = DEFAULT_ACCENT;
let theme = localStorage.getItem("theme") ?? "auto";
const applyAccent = () => document.documentElement.style.setProperty("--accent", theme === "auto" ? coverAccent : theme);
applyAccent();

const syncMenu = () => {
  menuEl.querySelectorAll<HTMLElement>("[data-theme]").forEach((el) => el.classList.toggle("on", el.dataset.theme === theme));
  menuEl.querySelectorAll<HTMLElement>("[data-size]").forEach((el) => el.classList.toggle("on", Number(el.dataset.size) === size));
  leadVal.textContent = `${leadMs} ms`;
  menuEl.querySelectorAll<HTMLElement>("[data-pref]").forEach((el) => el.classList.toggle("on", pref(el.dataset.pref as Pref)));
};
const openMenu = () => {
  menuOpen = true;
  notch.classList.add("pinned"); // keep the expanded hover view while the menu is open
  syncMenu();
  // Sit centered under the notch (its expanded height while pinned), regardless of where you clicked.
  const w = menuEl.offsetWidth;
  const notchBottom = (notch.classList.contains("live") ? 140 : 36) * size + gap();
  menuEl.style.setProperty("--mx", `${Math.max(4, (window.innerWidth - w) / 2)}px`);
  menuEl.style.setProperty("--my", `${notchBottom + 8}px`);
  resizeWindow(true).then(() => document.body.classList.add("menu-open"));
};
const closeMenu = () => {
  if (!menuOpen) return;
  menuOpen = false;
  notch.classList.remove("pinned");
  document.body.classList.remove("menu-open");
  setTimeout(() => { if (!menuOpen) resizeWindow(false); }, 180);
};

window.addEventListener("contextmenu", (e) => { e.preventDefault(); menuOpen ? closeMenu() : openMenu(); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
window.addEventListener("blur", closeMenu);
$("scrim").addEventListener("mousedown", closeMenu);

applySize();

menuEl.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act],[data-pref],[data-size],[data-theme]");
  if (!el) return;
  if (el.dataset.theme) {
    theme = el.dataset.theme;
    localStorage.setItem("theme", theme);
    applyAccent(); syncMenu();
  } else if (el.dataset.size) {
    size = Number(el.dataset.size);
    localStorage.setItem("size", String(size));
    applySize(); syncMenu();
  } else if (el.dataset.pref) {
    const k = el.dataset.pref as Pref;
    localStorage.setItem(`pref-${k}`, pref(k) ? "off" : "on");
    applyPrefs(); syncMenu();
    if (k === "float") resizeWindow(menuOpen);
  } else if (el.dataset.act === "lead-up") { setLead(leadMs + 100); syncMenu(); }
  else if (el.dataset.act === "lead-down") { setLead(leadMs - 100); syncMenu(); }
  else if (el.dataset.act === "lead-reset") { setLead(400); syncMenu(); }
  else if (el.dataset.act === "quit") invoke("quit");
});
const fill = $("fill");
const cur = $("current");
const curText = cur.querySelector("span")!;
const measure = $("measure");

// Collapsed pill has a fixed width; any lyric wider than the text area scrolls sideways.
const PILL_WIDTH = 420, PILL_OVERHEAD = 107; // overhead = padding + cover + gaps + equalizer
function fitPill(text: string) {
  measure.textContent = text;
  const w = measure.offsetWidth;
  const over = w - (PILL_WIDTH - PILL_OVERHEAD);
  cur.classList.toggle("scroll", over > 0);
  if (over > 0) {
    cur.style.setProperty("--shift", `${over + 6}px`);
    cur.style.setProperty("--dur", `${Math.min(8, Math.max(2.5, over / 45 + 1.5))}s`);
  }
}

// Pick a vivid accent from the cover art.
const autoSwatch = document.querySelector<HTMLElement>('[data-theme="auto"]')!;
artEl.addEventListener("load", () => {
  // "Auto" swatch shows the current cover instead of the rainbow fallback.
  autoSwatch.style.backgroundImage = `url("${artEl.src}")`;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const g = c.getContext("2d")!;
    g.drawImage(artEl, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let r = 0, gr = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      const wt = (mx - mn) * (mx > 60 ? 1 : 0.1) + 1; // favor saturated, bright pixels
      r += d[i] * wt; gr += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
    }
    let R = r / w, G = gr / w, B = b / w;
    const m = Math.max(R, G, B) || 1, k = 215 / m; // normalise brightness so glow is vivid
    coverAccent = `rgb(${Math.min(255, R * k) | 0},${Math.min(255, G * k) | 0},${Math.min(255, B * k) | 0})`;
    applyAccent();
  } catch { /* keep previous accent */ }
});

let media: Media | null = null;
let receivedAt = 0;
let trackKey = "";
let lines: Line[] = [];
let lastIdx = -2;
let artKey = "";

function parseLrc(lrc: string): Line[] {
  const out: Line[] = [];
  for (const raw of lrc.split("\n")) {
    const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (m) out.push({ t: (+m[1] * 60 + +m[2]) * 1000, text: m[3].trim() });
  }
  return out.sort((a, b) => a.t - b.t);
}

async function loadLyrics(m: Media) {
  const key = `${m.artist}|${m.title}`;
  lines = [];
  const q = new URLSearchParams({ artist_name: m.artist, track_name: m.title, duration: String(Math.round(m.duration_ms / 1000)) });
  try {
    let res = await fetch(`https://lrclib.net/api/get?${q}`);
    let data = res.ok ? await res.json() : null;
    if (!data?.syncedLyrics) {
      const s = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${m.artist} ${m.title}`)}`);
      const list = s.ok ? await s.json() : [];
      data = list.find((x: any) => x.syncedLyrics) ?? null;
    }
    if (key !== trackKey) return; // track changed meanwhile
    lines = data?.syncedLyrics ? parseLrc(data.syncedLyrics) : [];
  } catch { /* offline / not found: show title only */ }
  lastIdx = -2;
}

listen<Media | null>("media", (e) => {
  media = e.payload;
  receivedAt = performance.now();
  if (!media) { trackKey = ""; return; }
  const key = `${media.artist}|${media.title}`;
  if (key !== trackKey) {
    trackKey = key;
    $("title").textContent = media.title;
    $("artist").textContent = media.artist;
    artEl.removeAttribute("src");
    loadLyrics(media);
  }
  if (media.has_art && artKey !== trackKey) {
    artKey = trackKey;
    invoke<string | null>("get_art").then((a) => { if (a) artEl.src = a; else artKey = ""; });
  }
});

function render() {
  requestAnimationFrame(render);
  if (!media) { notch.className = "idle"; return; }
  notch.classList.remove("idle");
  notch.classList.add("live");
  notch.classList.toggle("playing", media.playing);
  const pos = media.position_ms + leadMs + (media.playing ? performance.now() - receivedAt : 0);
  if (media.duration_ms > 0) fill.style.width = `${Math.min(100, (pos / media.duration_ms) * 100)}%`;
  let idx = -1;
  for (let i = 0; i < lines.length && lines[i].t <= pos; i++) idx = i;
  if (idx === lastIdx) return;
  lastIdx = idx;
  const text = idx >= 0 ? lines[idx].text : "";
  const shown = text || (lines.length ? "♪" : `${media.title} — ${media.artist}`);
  curText.textContent = shown;
  fitPill(shown);
  cur.classList.remove("pop"); void cur.offsetWidth; cur.classList.add("pop");
  $("prev").textContent = lines[idx - 1]?.text ?? "";
  $("next").textContent = lines[idx + 1]?.text ?? "";
}
requestAnimationFrame(render);

// Transport buttons. Optimistic toggle; next poll (<400 ms) corrects it.
$("ctrl").addEventListener("click", (e) => {
  const act = (e.target as HTMLElement).closest("button")?.dataset.act;
  if (!act) return;
  if (act === "toggle" && media) { media.playing = !media.playing; receivedAt = performance.now(); }
  invoke("media_control", { action: act }).catch(() => {});
});
