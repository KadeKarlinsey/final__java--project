// ---------- Config ----------
const API_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/";
const MAKES = ["Toyota","Honda","Ford","Chevrolet","Nissan","Subaru","Hyundai","Kia","Mazda","Volkswagen","Jeep","BMW","Lexus","Dodge"];
const ALIASES = { chevy: "Chevrolet", vw: "Volkswagen" };
const BASE_PRICE = {
  Toyota: 27000, Honda: 26000, Ford: 30000, Chevrolet: 29000, Nissan: 25000, Subaru: 28000,
  Hyundai: 24000, Kia: 24000, Mazda: 26000, Volkswagen: 27000, Jeep: 33000, BMW: 46000, Lexus: 44000, Dodge: 31000
};
const COLORS = [
  { name: "White",  hex: "#F2F4F6" }, { name: "Black",  hex: "#252A31" },
  { name: "Silver", hex: "#B6BDC6" }, { name: "Gray",   hex: "#6B7581" },
  { name: "Blue",   hex: "#2F5DA8" }, { name: "Red",    hex: "#B7312C" },
  { name: "Green",  hex: "#2F6B50" }
];
const FALLBACK = {
  Toyota: ["Camry","Corolla","RAV4","Tacoma","Highlander"], Honda: ["Civic","Accord","CR-V","Pilot","Fit"],
  Ford: ["F-150","Mustang","Escape","Explorer","Focus"], Chevrolet: ["Malibu","Silverado","Equinox","Camaro","Tahoe"],
  Nissan: ["Altima","Rogue","Sentra","Frontier","Maxima"], Subaru: ["Outback","Forester","Impreza","Crosstrek","Legacy"],
  Hyundai: ["Elantra","Sonata","Tucson","Santa Fe","Kona"], Kia: ["Soul","Sorento","Optima","Sportage","Forte"],
  Mazda: ["Mazda3","CX-5","Mazda6","CX-9","MX-5 Miata"], Volkswagen: ["Jetta","Golf","Passat","Tiguan","Atlas"],
  Jeep: ["Wrangler","Grand Cherokee","Cherokee","Compass","Renegade"], BMW: ["3 Series","5 Series","X3","X5","M3"],
  Lexus: ["IS 250","RX 350","ES 350","GX 460","NX 300"], Dodge: ["Charger","Challenger","Durango","Ram 1500","Journey"]
};
const PAGE_SIZE = 24;
const CURRENT_YEAR = 2026;

// ---------- State ----------
const modelCache = {};
let listings = [];
let visibleCount = PAGE_SIZE;
let searchToken = 0;

// ---------- Elements ----------
const $ = (id) => document.getElementById(id);
const form = $("search-form"), input = $("search-input"), searchBtn = $("search-btn");
const grid = $("grid"), statusEl = $("status"), notice = $("notice"), moreBtn = $("more-btn");
const makeSel = $("make-filter"), priceRange = $("price-filter"), priceOut = $("price-output"), sortSel = $("sort");
const dialog = $("detail"), dialogContent = $("detail-content");

// ---------- Helpers ----------
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("en-US");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build one sample listing from a real make/model name
function makeListing(make, model, id) {
  const rand = rng(hash(make + "|" + model + "|" + id));
  const year = 2015 + Math.floor(rand() * 11); // 2015-2025
  const age = Math.max(1, CURRENT_YEAR - year);
  const mileage = Math.round((age * (8500 + rand() * 5000) + rand() * 4000) / 10) * 10;
  const raw = (BASE_PRICE[make] || 27000) * Math.pow(0.88, age) * (0.9 + rand() * 0.2);
  const price = Math.max(3500, Math.round(raw / 100) * 100 - 5);
  const color = COLORS[Math.floor(rand() * COLORS.length)];
  const transmission = rand() > 0.12 ? "Automatic" : "Manual";
  const mpg = Math.round(18 + rand() * 16);
  return { id: make + "-" + id, make, model, year, mileage, price, color, transmission, mpg };
}

// Simple side-view car drawn as inline SVG, colored per listing
function carSVG(color, label) {
  return `<svg viewBox="0 0 240 110" role="img" aria-label="${esc(label)}">
    <ellipse cx="120" cy="98" rx="104" ry="6" fill="rgba(23,33,43,.14)"/>
    <path d="M16 80 L21 62 Q23 56 32 54 L62 49 L82 29 Q86 25 92 25 L152 25 Q160 25 165 30 L184 51 L210 57 Q221 59 223 67 L225 80 Q225 86 218 86 L22 86 Q15 86 16 80 Z" fill="${color}" stroke="rgba(0,0,0,.28)" stroke-width="1.5"/>
    <path d="M87 33 L116 33 L116 48 L71 48 Z" fill="#CFE0EC" stroke="rgba(0,0,0,.2)"/>
    <path d="M122 33 L150 33 Q154 33 157 37 L168 48 L122 48 Z" fill="#CFE0EC" stroke="rgba(0,0,0,.2)"/>
    <rect x="205" y="64" width="12" height="6" rx="2" fill="#FFE9A8"/>
    <rect x="19" y="64" width="9" height="6" rx="2" fill="#E57373"/>
    <circle cx="66" cy="86" r="17" fill="#1B1F24"/><circle cx="66" cy="86" r="8" fill="#C9D1D9"/>
    <circle cx="178" cy="86" r="17" fill="#1B1F24"/><circle cx="178" cy="86" r="8" fill="#C9D1D9"/>
  </svg>`;
}

// ---------- API ----------
async function fetchModels(make) {
  if (modelCache[make]) return modelCache[make];
  const res = await fetch(API_BASE + encodeURIComponent(make.toLowerCase()) + "?format=json");
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  const seen = new Set();
  const models = [];
  (data.Results || []).forEach((r) => {
    const name = (r.Model_Name || "").trim();
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      models.push({ id: r.Model_ID, name });
    }
  });
  modelCache[make] = models;
  return models;
}

function parseQuery(q) {
  let text = q.trim().toLowerCase();
  const found = [];
  Object.keys(ALIASES).forEach((a) => {
    const re = new RegExp("\\b" + a + "\\b");
    if (re.test(text)) { found.push(ALIASES[a]); text = text.replace(re, " "); }
  });
  MAKES.forEach((m) => {
    if (text.includes(m.toLowerCase())) { found.push(m); text = text.replace(m.toLowerCase(), " "); }
  });
  return { makes: [...new Set(found)], tokens: text.split(/\s+/).filter(Boolean) };
}

// ---------- Search ----------
async function runSearch(query) {
  const token = ++searchToken;
  const { makes, tokens } = parseQuery(query);
  const targetMakes = makes.length ? makes : MAKES;

  setLoading(true);
  notice.hidden = true;

  const settled = await Promise.allSettled(targetMakes.map((m) => fetchModels(m)));
  if (token !== searchToken) return; // a newer search replaced this one

  let rows = [];
  const failed = settled.filter((s) => s.status === "rejected").length;

  if (failed === settled.length) {
    showNotice("Couldn’t reach the NHTSA database, so you’re seeing a small built-in sample list. Check your connection and search again.", true);
    targetMakes.forEach((make) => {
      (FALLBACK[make] || []).forEach((name) => rows.push(makeListing(make, name, hash(name) % 100000)));
    });
  } else {
    settled.forEach((s, i) => {
      if (s.status !== "fulfilled") return;
      s.value.forEach((m) => rows.push(makeListing(targetMakes[i], m.name, m.id)));
    });
    if (failed > 0) showNotice("Some makes couldn’t be loaded. Results may be incomplete.", true);
  }

  if (tokens.length) {
    rows = rows.filter((r) => {
      const hay = (makes.length ? r.model : r.make + " " + r.model).toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }

  listings = rows;
  visibleCount = PAGE_SIZE;
  refreshMakeOptions();
  setLoading(false);
  render(query);
}

function setLoading(on) {
  searchBtn.disabled = on;
  grid.setAttribute("aria-busy", String(on));
  if (on) {
    grid.innerHTML = `<div class="state"><div class="spinner" aria-hidden="true"></div><strong>Loading cars…</strong>Fetching models from the NHTSA database.</div>`;
    statusEl.textContent = "Loading…";
    moreBtn.hidden = true;
  }
}

function showNotice(msg, isError) {
  notice.textContent = msg;
  notice.classList.toggle("error", !!isError);
  notice.hidden = false;
}

// ---------- Filters, sorting, rendering ----------
function refreshMakeOptions() {
  const current = makeSel.value;
  const makes = [...new Set(listings.map((l) => l.make))].sort();
  makeSel.innerHTML = `<option value="">All makes</option>` + makes.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
  makeSel.value = makes.includes(current) ? current : "";
}

function getFiltered() {
  const maxPrice = Number(priceRange.value);
  const make = makeSel.value;
  const noLimit = maxPrice >= Number(priceRange.max);
  const rows = listings.filter((l) => (!make || l.make === make) && (noLimit || l.price <= maxPrice));
  const name = (l) => (l.make + " " + l.model).toLowerCase();
  const sorters = {
    newest: (a, b) => b.year - a.year || name(a).localeCompare(name(b)),
    oldest: (a, b) => a.year - b.year || name(a).localeCompare(name(b)),
    az: (a, b) => name(a).localeCompare(name(b)),
    za: (a, b) => name(b).localeCompare(name(a)),
    "price-low": (a, b) => a.price - b.price,
    "price-high": (a, b) => b.price - a.price
  };
  return rows.sort(sorters[sortSel.value]);
}

function render(query) {
  const rows = getFiltered();
  const shown = rows.slice(0, visibleCount);

  if (!rows.length) {
    const q = (query ?? input.value).trim();
    grid.innerHTML = `<div class="state"><strong>No cars match</strong>${q ? "Nothing found for “" + esc(q) + "” with these filters. " : ""}Try a make like Toyota, a model like Camry, or raise the price limit.</div>`;
    statusEl.textContent = "0 cars";
    moreBtn.hidden = true;
    return;
  }

  grid.innerHTML = shown.map((l) => `
    <article class="card">
      <div class="card-photo">
        <div class="price-tag">${money.format(l.price)}</div>
        ${carSVG(l.color.hex, l.year + " " + l.make + " " + l.model + ", " + l.color.name)}
      </div>
      <div class="card-body">
        <h3><span class="year">${l.year}</span>${esc(l.make)} ${esc(l.model)}</h3>
        <ul class="specs">
          <li><span>Mileage</span>${number.format(l.mileage)} mi</li>
          <li><span>Color</span>${l.color.name}</li>
          <li><span>Transmission</span>${l.transmission}</li>
          <li><span>Fuel economy</span>${l.mpg} MPG</li>
        </ul>
        <button class="btn btn-blue" type="button" data-id="${esc(l.id)}">View details</button>
      </div>
    </article>`).join("");

  statusEl.textContent = `Showing ${shown.length} of ${rows.length} car${rows.length === 1 ? "" : "s"}`;
  moreBtn.hidden = shown.length >= rows.length;
}

// ---------- Details dialog ----------
function openDetail(id) {
  const l = listings.find((x) => x.id === id);
  if (!l) return;
  const down = l.price * 0.1, principal = l.price - down, r = 0.07 / 12, n = 60;
  const monthly = (principal * r) / (1 - Math.pow(1 + r, -n));
  dialogContent.innerHTML = `
    <div class="dialog-photo">${carSVG(l.color.hex, l.year + " " + l.make + " " + l.model)}</div>
    <div class="dialog-body">
      <h2 id="detail-title">${l.year} ${esc(l.make)} ${esc(l.model)}</h2>
      <p class="dialog-price">${money.format(l.price)}</p>
      <dl>
        <dt>Mileage</dt><dd>${number.format(l.mileage)} mi</dd>
        <dt>Color</dt><dd>${l.color.name}</dd>
        <dt>Transmission</dt><dd>${l.transmission}</dd>
        <dt>Fuel economy</dt><dd>${l.mpg} MPG combined</dd>
        <dt>Estimated payment</dt><dd>${money.format(monthly)}/mo</dd>
      </dl>
      <p class="fine">Payment assumes 10% down, 7% APR, 60 months. Listing details are sample data for this demo.</p>
      <button class="btn btn-outline" type="button" id="close-dialog">Close</button>
    </div>`;
  dialog.showModal();
  $("close-dialog").addEventListener("click", () => dialog.close());
}

// ---------- Events ----------
form.addEventListener("submit", (e) => { e.preventDefault(); runSearch(input.value); });
document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => { input.value = chip.dataset.q; runSearch(chip.dataset.q); });
});
makeSel.addEventListener("change", () => { visibleCount = PAGE_SIZE; render(); });
sortSel.addEventListener("change", () => { visibleCount = PAGE_SIZE; render(); });
priceRange.addEventListener("input", () => {
  const v = Number(priceRange.value);
  priceOut.textContent = v >= Number(priceRange.max) ? "Any price" : "Up to " + money.format(v);
  visibleCount = PAGE_SIZE;
  render();
});
moreBtn.addEventListener("click", () => { visibleCount += PAGE_SIZE; render(); });
grid.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-id]");
  if (btn) openDetail(btn.dataset.id);
});
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

// ---------- Start ----------
runSearch("");