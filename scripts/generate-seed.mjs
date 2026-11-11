// Deterministic generator for data/seed.json.
// Run: node scripts/generate-seed.mjs
// Totals are constructed so that SKU-level orders reconcile exactly with the
// month-level metrics (and, for S1, with the numbers in the assignment brief).

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Small seeded PRNG so the output never changes between runs.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Split `total` into integers proportional to `weights` (largest remainder).
function distribute(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - Math.floor(r), i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < left; k++) out[order[k][1]] += 1;
  return out;
}

const round2 = (n) => Math.round(n * 100) / 100;
const roundTo = (n, step) => Math.round(n / step) * step - 1; // 449, 599 style

function sku(o) {
  const base = {
    stock: 0,
    status: "live",
    rating: 4.2,
    dispatchDays: 1.5,
    dispatchDaysLast: 1.5,
    oosLastMonth: false,
  };
  const s = { ...base, ...o };
  s.priceLast = s.priceLast ?? s.price;
  s.searchRankLast = s.searchRankLast ?? s.searchRank;
  const demand = s.stock === 0 ? s.ordersLast : Math.max(s.ordersThis, 1);
  s.avgDailySales = round2(demand / 30);
  return s;
}

// ------------------------------------------------------------------ S1
function buildS1() {
  const r = rng(101);
  const out = [];
  const sellerId = "S1";

  // 4 former top sellers that went out of stock this month (still live, so
  // orders keep arriving and get cancelled for "no stock").
  const top = [
    ["HK-112", "Steel water bottle 1L", 449, 255, 30, 9, 2, 38, 4.5, 12],
    ["HK-087", "Non-stick tawa 28cm", 599, 350, 24, 7, 4, 45, 4.3, 10],
    ["HK-145", "Airtight container set (6)", 699, 420, 19, 6, 5, 52, 4.4, 9],
    ["HK-063", "Cotton kitchen towels (4)", 349, 190, 15, 4, 8, 60, 4.2, 6],
  ];
  for (const [id, name, price, cost, ol, ot, rl, rk, rating, since] of top) {
    out.push(
      sku({
        sku: id, sellerId, name, price, cost, ordersLast: ol, ordersThis: ot,
        searchRankLast: rl, searchRank: rk, rating, oosSinceDays: since,
      }),
    );
  }

  // 9 tail SKUs newly out of stock (1 order each last month).
  const tailNames = [
    "Silicone spatula", "Wooden spice box", "Steel tea strainer",
    "Glass oil dispenser", "Bamboo chopping board", "Ceramic salt jar",
    "Steel soap dish", "Plastic tiffin (2 tier)", "Kitchen apron",
  ];
  tailNames.forEach((name, i) => {
    const price = roundTo(150 + r() * 300, 50);
    out.push(
      sku({
        sku: `HK-${200 + i}`, sellerId, name, price, cost: Math.round(price * 0.58),
        ordersLast: 1, ordersThis: 0, searchRankLast: 140 + i * 12,
        searchRank: 210 + i * 15, rating: 4.0, oosSinceDays: 5 + (i % 6),
      }),
    );
  });

  // 5 SKUs that were already out of stock last month (already unavailable).
  ["Copper water jug", "Brass diya set", "Steel pressure cooker gasket",
    "Marble rolling board", "Cast iron kadai"].forEach((name, i) => {
    const price = roundTo(300 + r() * 600, 50);
    out.push(
      sku({
        sku: `HK-${300 + i}`, sellerId, name, price, cost: Math.round(price * 0.6),
        ordersLast: 0, ordersThis: 0, status: "unavailable", oosLastMonth: true,
        searchRankLast: 400 + i * 10, searchRank: 420 + i * 10, rating: 4.1,
        oosSinceDays: 40 + i * 3,
      }),
    );
  });

  // 42 live, in-stock SKUs. Last month 303 orders -> this month 244.
  const liveNames = [
    "Glass storage jars (3)", "Steel lunch box", "Vegetable chopper",
    "Masala dabba", "Insulated casserole 1.5L", "Steel kadhai 2L",
    "Dish drying rack", "Glass tumblers (6)", "Ceramic dinner plates (4)",
    "Steel mixing bowls (3)", "Kitchen knife set", "Peeler and grater combo",
    "Roti box", "Fridge storage boxes (4)", "Steel thermos 500ml",
    "Silicone baking mat", "Measuring cups set", "Spice rack organiser",
    "Pressure cooker 3L", "Idli maker", "Steel colander", "Cutlery holder",
    "Glass bowls (2)", "Water jug 1.5L", "Kitchen scale digital",
    "Oil sprayer bottle", "Cotton napkins (6)", "Table mats (6)",
    "Steel ladle set", "Vacuum flask 1L", "Bread box", "Pickle jars (2)",
    "Tea coasters (6)", "Steel glasses (4)", "Fruit basket",
    "Sink organiser", "Microwave bowl set", "Chai cups (6)",
    "Steel serving tray", "Wall hooks (6)", "Cling wrap dispenser",
    "Hand blender",
  ];
  const weights = liveNames.map((_, i) => 13 - (i * 11.5) / 41);
  const last = distribute(303, weights);
  const thisW = last.map((l) => l * (0.74 + r() * 0.12));
  const now = distribute(244, thisW);
  liveNames.forEach((name, i) => {
    const price = roundTo(200 + r() * 700, 50);
    const daily = Math.max(now[i], 1) / 30;
    // Three mid-sellers are running low (< 5 days of cover).
    const lowStock = i === 3 || i === 6 || i === 9;
    const stock = lowStock ? Math.max(1, Math.round(daily * 3)) : Math.ceil(daily * (25 + r() * 40));
    out.push(
      sku({
        sku: `HK-${String(10 + i * 2).padStart(3, "0")}`, // even ids, never clash with top SKUs
        sellerId, name, price, cost: Math.round(price * 0.6), stock,
        ordersLast: last[i], ordersThis: now[i],
        searchRankLast: 12 + i * 4, searchRank: 18 + i * 4 + Math.round(r() * 6),
        rating: round2(3.9 + r() * 0.6),
      }),
    );
  });
  return out;
}

// ------------------------------------------------------------------ S2
function buildS2() {
  const r = rng(202);
  const out = [];
  const sellerId = "S2";

  // Seller raised prices ~18%; a competitor cut prices on 3 top kurtis.
  const top = [
    ["PE-201", "Cotton Anarkali kurti", 799, 949, 749, 430, 48, 14, 3, 27],
    ["PE-118", "Rayon straight kurti", 649, 769, 599, 350, 40, 13, 5, 31],
    ["PE-305", "Chikankari kurti", 999, 1179, 899, 900, 32, 10, 7, 35],
  ];
  for (const [id, name, pl, p, cp, cost, ol, ot, rl, rk] of top) {
    out.push(
      sku({
        sku: id, sellerId, name, priceLast: pl, price: p, competitorPrice: cp, cost,
        ordersLast: ol, ordersThis: ot, searchRankLast: rl, searchRank: rk,
        stock: 40 + Math.round(r() * 40), rating: 4.3, dispatchDays: 1.6, dispatchDaysLast: 1.6,
      }),
    );
  }

  // 12 more SKUs with the ~18% price rise (no competitor move).
  const raisedNames = [
    "Printed palazzo set", "Bandhani dupatta", "Cotton kurta set",
    "Georgette saree", "Leheriya kurti", "Embroidered dupatta",
    "Linen kurti", "Ikat kurta", "Silk blend saree", "Block print kurti",
    "Mirror work top", "Sharara set",
  ];
  const rLast = distribute(70, raisedNames.map((_, i) => 9 - i * 0.5));
  const rNow = distribute(58, rLast.map((l) => l * (0.8 + r() * 0.08)));
  raisedNames.forEach((name, i) => {
    const pl = roundTo(500 + r() * 900, 50);
    const p = roundTo(pl * 1.18, 10);
    out.push(
      sku({
        sku: `PE-${400 + i * 3}`, sellerId, name, priceLast: pl, price: p,
        competitorPrice: pl, cost: Math.round(pl * 0.55),
        ordersLast: rLast[i], ordersThis: rNow[i],
        searchRankLast: 15 + i * 5, searchRank: 22 + i * 6,
        stock: 20 + Math.round(r() * 50), rating: round2(4.0 + r() * 0.4),
        dispatchDays: 1.6, dispatchDaysLast: 1.6,
      }),
    );
  });

  // 23 SKUs with unchanged prices.
  const plainNames = [
    "Cotton leggings", "Churidar", "Basic cotton kurti", "Stole", "Dupatta plain",
    "Night suit", "Cotton salwar", "Kids kurta", "Jhumka set", "Bangles set",
    "Potli bag", "Hair accessory set", "Cotton top", "Ethnic jacket",
    "Skirt flared", "Patiala salwar", "Cotton saree", "Kurti with pants",
    "Shrug ethnic", "Mojari women", "Clutch embroidered", "Bindi box",
    "Saree cover",
  ];
  const pLast = distribute(110, plainNames.map((_, i) => 8 - i * 0.28));
  const pNow = distribute(95, pLast.map((l) => l * (0.82 + r() * 0.1)));
  plainNames.forEach((name, i) => {
    const price = roundTo(200 + r() * 600, 50);
    out.push(
      sku({
        sku: `PE-${600 + i * 2}`, sellerId, name, price, cost: Math.round(price * 0.55),
        ordersLast: pLast[i], ordersThis: pNow[i],
        searchRankLast: 30 + i * 6, searchRank: 34 + i * 6,
        stock: 15 + Math.round(r() * 60), rating: round2(4.0 + r() * 0.4),
        dispatchDays: 1.6, dispatchDaysLast: 1.6,
      }),
    );
  });

  ["Velvet lehenga", "Silk kurta set"].forEach((name, i) => {
    out.push(
      sku({
        sku: `PE-${900 + i}`, sellerId, name, price: 1899 + i * 300, cost: 1100 + i * 150,
        ordersLast: 0, ordersThis: 0, status: "unavailable", oosLastMonth: true,
        searchRankLast: 500, searchRank: 520, oosSinceDays: 45,
        dispatchDays: 1.6, dispatchDaysLast: 1.6,
      }),
    );
  });
  return out;
}

// ------------------------------------------------------------------ S3
function buildS3() {
  const r = rng(303);
  const out = [];
  const sellerId = "S3";

  // 30 SKUs packed at the main Lucknow warehouse: dispatch 1.2 -> 4.3 days.
  const slowNames = [
    "20W fast charger", "Type-C braided cable 1m", "TWS earbuds",
    "Phone back cover", "Tempered glass (2)", "Power bank 10000mAh",
    "Car charger dual USB", "Neckband earphones", "Phone stand", "OTG adapter",
    "Lightning cable 1m", "Bike phone holder", "Selfie stick", "Ring light 10in",
    "Wireless charger pad", "Smartwatch strap", "Camera lens protector",
    "Earbuds case cover", "Pop socket", "USB hub 4-port", "Aux cable",
    "Micro USB cable", "Mobile cleaning kit", "Car phone mount",
    "65W GaN charger", "Type-C to 3.5mm adapter", "Laptop sleeve 14in",
    "Gaming triggers", "Cable organiser", "Phone lanyard",
  ];
  const sLast = distribute(360, slowNames.map((_, i) => 26 - i * 0.75));
  const sNow = distribute(260, sLast.map((l) => l * (0.68 + r() * 0.1)));
  const slowIds = ["GH-501", "GH-322", "GH-417", "GH-209"];
  slowNames.forEach((name, i) => {
    const price = i < 4 ? [399, 249, 999, 199][i] : roundTo(120 + r() * 500, 50);
    out.push(
      sku({
        sku: slowIds[i] ?? `GH-${600 + i * 3}`, sellerId, name, price,
        cost: Math.round(price * 0.55), ordersLast: sLast[i], ordersThis: sNow[i],
        searchRankLast: 4 + i * 4, searchRank: 14 + i * 6,
        stock: 30 + Math.round(r() * 120), rating: round2(3.7 + r() * 0.4),
        dispatchDaysLast: 1.2, dispatchDays: 4.3,
      }),
    );
  });

  // 14 SKUs shipped by a partner warehouse: dispatch unchanged.
  const fastNames = [
    "Bluetooth speaker mini", "Laptop stand", "Wireless mouse", "Keyboard cover",
    "Webcam cover (3)", "HDMI cable 1.5m", "Pen drive 64GB", "SD card 64GB",
    "Mouse pad XL", "Laptop cooling pad", "USB desk fan", "Card reader",
    "Ethernet cable 3m", "Phone tripod",
  ];
  const fLast = distribute(140, fastNames.map((_, i) => 13 - i * 0.4));
  const fNow = distribute(120, fLast.map((l) => l * (0.82 + r() * 0.08)));
  fastNames.forEach((name, i) => {
    const price = roundTo(150 + r() * 600, 50);
    out.push(
      sku({
        sku: `GH-${800 + i * 2}`, sellerId, name, price, cost: Math.round(price * 0.55),
        ordersLast: fLast[i], ordersThis: fNow[i],
        searchRankLast: 20 + i * 5, searchRank: 23 + i * 5,
        stock: 25 + Math.round(r() * 80), rating: round2(4.0 + r() * 0.4),
        dispatchDaysLast: 1.2, dispatchDays: 1.3,
      }),
    );
  });

  out.push(
    sku({
      sku: "GH-990", sellerId, name: "Gimbal stabiliser", price: 3499, cost: 2400,
      ordersLast: 0, ordersThis: 0, status: "unavailable", oosLastMonth: true,
      searchRankLast: 300, searchRank: 310, oosSinceDays: 50,
      dispatchDaysLast: 1.2, dispatchDays: 1.2,
    }),
  );
  return out;
}

// ------------------------------------------------------------------ metrics
const m = (sellerId, month, sales, orders, cancelRate, asp, oosCount, cancelReasons, avgDispatchDays, rating, adsActive) => ({
  sellerId, month, sales, orders, cancelRate, asp, oosCount, cancelReasons, avgDispatchDays, rating, adsActive,
});

const metrics = [
  m("S1", "last", 200000, 400, 8, 500, 5, { seller_no_stock: 6, customer_changed_mind: 17, delivery_delay: 9 }, 1.5, 4.3, true),
  m("S1", "this", 135000, 270, 14, 500, 18, { seller_no_stock: 26, customer_changed_mind: 7, delivery_delay: 5 }, 1.5, 4.2, false),
  m("S2", "last", 210000, 300, 6, 700, 2, { customer_changed_mind: 10, size_issue: 5, delivery_delay: 3 }, 1.6, 4.2, true),
  m("S2", "this", 156750, 190, 6.3, 825, 2, { customer_changed_mind: 7, size_issue: 3, delivery_delay: 2 }, 1.6, 4.2, true),
  m("S3", "last", 150000, 500, 7, 300, 1, { delivery_delay: 8, customer_changed_mind: 18, seller_no_stock: 3, wrong_item: 6 }, 1.2, 4.3, true),
  m("S3", "this", 114000, 380, 15, 300, 1, { delivery_delay: 38, customer_changed_mind: 14, seller_no_stock: 2, wrong_item: 3 }, 3.4, 3.9, true),
];

const sellers = [
  { id: "S1", name: "Rohit Sharma", store: "Sharma Home & Kitchen", category: "Home & Kitchen", city: "Jaipur", since: "2019", phone_pref_lang: "hi" },
  { id: "S2", name: "Priya Nair", store: "Priya Ethnic Wear", category: "Fashion", city: "Surat", since: "2020", phone_pref_lang: "en" },
  { id: "S3", name: "Imran Qureshi", store: "GadgetHub", category: "Mobile accessories", city: "Lucknow", since: "2021", phone_pref_lang: "hi" },
];

const skus = [...buildS1(), ...buildS2(), ...buildS3()];

// Self-check: SKU orders must reconcile with month metrics.
for (const s of sellers) {
  const mine = skus.filter((k) => k.sellerId === s.id);
  const lastM = metrics.find((x) => x.sellerId === s.id && x.month === "last");
  const thisM = metrics.find((x) => x.sellerId === s.id && x.month === "this");
  const sumL = mine.reduce((a, k) => a + k.ordersLast, 0);
  const sumT = mine.reduce((a, k) => a + k.ordersThis, 0);
  const oosT = mine.filter((k) => k.stock === 0).length;
  const oosL = mine.filter((k) => k.oosLastMonth).length;
  const ids = new Set(mine.map((k) => k.sku));
  if (sumL !== lastM.orders || sumT !== thisM.orders) throw new Error(`${s.id} orders mismatch ${sumL}/${sumT}`);
  if (oosT !== thisM.oosCount || oosL !== lastM.oosCount) throw new Error(`${s.id} oos mismatch ${oosL}/${oosT}`);
  if (ids.size !== mine.length) throw new Error(`${s.id} duplicate sku ids`);
  console.log(`${s.id}: ${mine.length} SKUs, orders ${sumL} -> ${sumT}, OOS ${oosL} -> ${oosT}`);
}

const seed = {
  sellers, skus, metrics,
  actions: [], alerts: [], deals: [], followUps: [], escalations: [], callLogs: [],
};

const file = join(root, "data", "seed.json");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(seed, null, 2) + "\n");
console.log(`wrote ${file}`);
