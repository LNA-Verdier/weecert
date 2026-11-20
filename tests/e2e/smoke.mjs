// Test de bout en bout du site avec un faux Supabase (aucun serveur réel).
//   node tests/e2e/smoke.mjs        (Playwright + Chromium requis)
// Vérifie : écran de connexion, inscription refusée hors liste, connexion, chargement des questions,
// sauvegarde de la progression, gestion de l'équipe (propriétaire) et droits d'une utilisatrice.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".txt": "text/plain" };
const OWNER = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const SEED = {
  members: [
    { email: "lolo@exemple.fr", role: "owner", user_id: OWNER, display_name: "Loïc", password: "motdepasse42" },
    { email: "camille@exemple.fr", role: "user", user_id: USER, display_name: "Camille", password: "motdepasse42" },
    { email: "nouveau@exemple.fr", role: "user" },
  ],
  questions: [
    { id: "imp-t-1", data: { c: "dea", d: "plat", dl: "Plateforme Databricks", q: "Question importée 1", o: ["A", "B"], a: [0], e: "", code: "", s: "Test" } },
    { id: "imp-t-2", data: { c: "dea", d: "plat", dl: "Plateforme Databricks", q: "Question importée 2", o: ["A", "B", "C"], a: [2], e: "", code: "", s: "Test" } },
  ],
};

let failures = 0;
const check = (cond, what) => { console.log(`${cond ? "ok" : "ÉCHEC"} : ${what}`); if (!cond) failures++; };

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = join(ROOT, path.endsWith("/") ? path + "index.html" : path);
    if (!file.startsWith(ROOT)) throw new Error("hors racine");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }); res.end(body);
  } catch (e) { res.writeHead(404); res.end(); }
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
async function page() {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  await ctx.addInitScript((seed) => { window.__FAKE_SEED = seed; }, SEED);
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm", async (r) =>
    r.fulfill({ contentType: "text/javascript", body: await readFile(join(ROOT, "tests/e2e/fake_supabase.js"), "utf8") }));
  await ctx.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript",
    body: 'export const SUPABASE_URL="https://test.supabase.co";export const SUPABASE_ANON_KEY="test";' }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(BASE);
  return { p, errors, ctx };
}
async function login(p, email) {
  await p.fill("#aEmail", email);
  await p.fill("#aPass", "motdepasse42");
  await p.click('#aform button[type="submit"]');
  await p.waitForFunction(() => document.getElementById("auth").hidden, null, { timeout: 8000 });
  await p.waitForFunction(() => typeof S !== "undefined" && S.online, null, { timeout: 8000 });
}

try {
  // Propriétaire
  const { p, errors, ctx } = await page();
  await p.waitForSelector("#aEmail");
  check(await p.isVisible("text=Se connecter"), "l'écran de connexion s'affiche avant l'app");
  check(await p.evaluate(() => typeof S === "undefined"), "l'application ne démarre pas sans connexion");

  await p.click('[data-auth="signup"]');
  await p.fill("#aName", "Intrus"); await p.fill("#aEmail", "intrus@exemple.fr"); await p.fill("#aPass", "motdepasse42");
  await p.click('#aform button[type="submit"]');
  await p.waitForSelector(".amsg.err");
  check((await p.textContent(".amsg.err")).includes("pas autorisée"), "inscription refusée pour une adresse hors liste");

  await p.click('[data-auth="login"]');
  await login(p, "lolo@exemple.fr");
  check(await p.evaluate(() => S.imported.length === 2), "les questions importées sont chargées depuis la base");
  check(await p.evaluate(() => S.isOwner && S.isAdmin), "le propriétaire est administrateur");
  check(await p.isVisible('.tab[data-tab="import"]'), "l'onglet Importer est visible pour le propriétaire");

  await p.evaluate(() => { addXp(30); savePlayer(); });
  await p.waitForFunction((id) => (window.__fake.players.find((x) => x.user_id === id)?.data?.xp || 0) >= 30, OWNER, { timeout: 5000 });
  check(true, "la progression est enregistrée dans la base");

  await p.click('.tab[data-tab="profile"]');
  await p.waitForSelector("text=Équipe et accès");
  check(await p.isVisible("text=En attente d'inscription"), "la liste montre les adresses en attente");
  await p.fill("#weeAdd", "Pote@Exemple.fr");
  await p.click('[data-act="wee-add"]');
  await p.waitForFunction(() => window.__fake.members.some((m) => m.email === "pote@exemple.fr"), null, { timeout: 5000 });
  check(true, "le propriétaire ajoute une adresse (mise en minuscules)");
  await p.click('[data-act="wee-role"][data-email="camille@exemple.fr"]');
  await p.waitForFunction(() => window.__fake.members.find((m) => m.email === "camille@exemple.fr").role === "admin", null, { timeout: 5000 });
  check(true, "le propriétaire nomme une administratrice");
  await p.click('[data-act="wee-role"][data-email="camille@exemple.fr"]');
  await p.waitForFunction(() => window.__fake.members.find((m) => m.email === "camille@exemple.fr").role === "user", null, { timeout: 5000 });
  await mkdir(join(ROOT, "tests/output"), { recursive: true });
  await p.screenshot({ path: join(ROOT, "tests/output/profil.png") });
  check(errors.length === 0, `aucune erreur JavaScript côté propriétaire${errors.length ? " : " + errors.join(" | ") : ""}`);

  // Utilisatrice, dans un autre navigateur (nouveau stockage)
  const storage = await p.evaluate(() => localStorage.getItem("fake-sb"));
  const u = await page();
  await u.p.evaluate((s) => { const o = JSON.parse(s); o.session = null; localStorage.setItem("fake-sb", JSON.stringify(o)); }, storage);
  await u.p.reload();
  await u.p.waitForSelector("#aEmail");
  await login(u.p, "camille@exemple.fr");
  check(await u.p.evaluate(() => !S.isAdmin), "Camille est utilisatrice");
  check(!(await u.p.isVisible('.tab[data-tab="import"]')), "l'onglet Importer est masqué pour une utilisatrice");
  await u.p.click('.tab[data-tab="league"]');
  await u.p.waitForFunction(() => S.players.length >= 1, null, { timeout: 5000 });
  check(await u.p.evaluate((id) => S.players.some((x) => x.id === id), OWNER), "le classement montre la progression du propriétaire");
  await u.p.click('.tab[data-tab="profile"]');
  check(!(await u.p.isVisible("text=Équipe et accès")), "la gestion de l'équipe est réservée au propriétaire");
  check(await u.p.evaluate(() => localStorage.getItem("briko:uid")) === USER, "le cache local est propre au compte connecté");
  check(u.errors.length === 0, `aucune erreur JavaScript côté utilisatrice${u.errors.length ? " : " + u.errors.join(" | ") : ""}`);
  await u.ctx.close(); await ctx.close();
} catch (e) {
  console.log("ÉCHEC : " + e.message); failures++;
} finally {
  await browser.close(); server.close();
}
console.log(failures ? `${failures} échec(s)` : "Site : tous les tests passent.");
process.exit(failures ? 1 : 0);
