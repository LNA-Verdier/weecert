// WeeCert : connexion Supabase, écran de compte et couche d'accès aux données.
// L'application (index.html, scripts type="text/weecert") a été écrite pour une API de documents
// (doc(path).get/set/delete/onSnapshot, collection(path).onSnapshot) et une API « user ».
// Ce module fournit ces deux API au-dessus de Supabase, puis lance l'application une fois connecté.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

const HOME = location.origin + location.pathname;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLE_LABEL = { owner: "Propriétaire", admin: "Administrateur", user: "Utilisateur" };

let sb = null;
let me = null; // { id, email, name, role }
let started = false;

/* ---------------------------------------------------------------------------
   Écran de compte
--------------------------------------------------------------------------- */
const authEl = $("#auth");
const bodyEl = $("#authBody");
let mode = "login";
let msg = null; // { kind: "err" | "ok", text }

function field(id, label, type, extra = "") {
  return `<label class="afield" for="${id}"><span>${label}</span><input id="${id}" class="txtin" type="${type}" ${extra}></label>`;
}
function msgHtml() {
  return msg ? `<p class="amsg ${msg.kind}" role="${msg.kind === "err" ? "alert" : "status"}">${esc(msg.text)}</p>` : "";
}
function showAuth(m, message = null) {
  mode = m; msg = message;
  authEl.hidden = false;
  document.body.classList.add("locked");
  renderAuth();
}
function renderAuth() {
  const seg = (m) => `<div class="seg" role="tablist"><button type="button" data-auth="login" aria-pressed="${m === "login"}">Se connecter</button><button type="button" data-auth="signup" aria-pressed="${m === "signup"}">Créer mon compte</button></div>`;
  let h = "";
  if (mode === "loading") h = `<div class="aload"><span class="spin"></span><span>Connexion…</span></div>`;
  else if (mode === "config") h = `<div class="card"><b class="astrong">WeeCert n'est pas encore configuré</b><p>Renseigne l'adresse et la clé publique de ton projet Supabase dans <code>config.js</code>, puis recharge la page (voir README).</p></div>`;
  else if (mode === "login") h = `${seg("login")}<form id="aform" class="aform" novalidate>${field("aEmail", "Adresse e-mail", "email", 'autocomplete="email" required')}${field("aPass", "Mot de passe", "password", 'autocomplete="current-password" required')}${msgHtml()}<button class="btn" type="submit">Se connecter</button><button class="alink" type="button" data-auth="forgot">Mot de passe oublié ?</button></form>`;
  else if (mode === "signup") h = `${seg("signup")}<form id="aform" class="aform" novalidate>${field("aName", "Prénom", "text", 'autocomplete="given-name" maxlength="40" required')}${field("aEmail", "Adresse e-mail professionnelle", "email", 'autocomplete="email" required')}${field("aPass", "Mot de passe (10 caractères minimum)", "password", 'autocomplete="new-password" minlength="10" required')}<p class="note">L'inscription est réservée aux adresses ajoutées par l'administrateur de WeeCert.</p>${msgHtml()}<button class="btn" type="submit">Créer mon compte</button></form>`;
  else if (mode === "forgot") h = `<form id="aform" class="aform" novalidate><b class="astrong">Mot de passe oublié</b><p class="note">Saisis ton adresse : tu recevras un lien pour choisir un nouveau mot de passe.</p>${field("aEmail", "Adresse e-mail", "email", 'autocomplete="email" required')}${msgHtml()}<button class="btn" type="submit">Envoyer le lien</button><button class="alink" type="button" data-auth="login">Retour à la connexion</button></form>`;
  else if (mode === "recover") h = `<form id="aform" class="aform" novalidate><b class="astrong">Nouveau mot de passe</b>${field("aPass", "Nouveau mot de passe (10 caractères minimum)", "password", 'autocomplete="new-password" minlength="10" required')}${msgHtml()}<button class="btn" type="submit">Enregistrer</button></form>`;
  else if (mode === "checkmail") h = `<div class="card"><b class="astrong">Vérifie ta boîte mail</b><p>${esc(msg ? msg.text : "")}</p><button class="btn ghost" type="button" data-auth="login">Retour à la connexion</button></div>`;
  else if (mode === "denied") h = `<div class="card"><b class="astrong">Accès non autorisé</b><p>Ton compte n'est pas (ou plus) dans la liste de l'équipe WeeCert. Demande à l'administrateur de l'app d'ajouter ton adresse.</p><button class="btn ghost" type="button" data-auth="logout">Se déconnecter</button></div>`;
  bodyEl.innerHTML = h;
  const first = bodyEl.querySelector("input");
  if (first) first.focus({ preventScroll: true });
}

function authError(error) {
  const t = `${error?.message || ""} ${error?.code || ""}`;
  if (/invalid login credentials|invalid_credentials/i.test(t)) return "E-mail ou mot de passe incorrect.";
  if (/email not confirmed|email_not_confirmed/i.test(t)) return "Confirme d'abord ton adresse avec le lien reçu par e-mail.";
  if (/database error saving new user|WEECERT_NOT_ALLOWED|unexpected_failure/i.test(t)) return "Cette adresse n'est pas autorisée. Demande à l'administrateur de WeeCert de l'ajouter à la liste.";
  if (/already registered|user_already_exists/i.test(t)) return "Un compte existe déjà avec cette adresse. Connecte-toi, ou utilise « Mot de passe oublié ».";
  if (/password/i.test(t) && /(short|weak|characters|length)/i.test(t)) return "Mot de passe trop faible : 10 caractères minimum, avec des lettres et des chiffres.";
  if (/rate limit|too many|over_email_send_rate_limit/i.test(t)) return "Trop de tentatives. Patiente quelques minutes avant de réessayer.";
  if (/fetch|network/i.test(t)) return "Impossible de joindre le serveur. Vérifie ta connexion internet.";
  return "Une erreur est survenue. Réessaie dans un instant.";
}

bodyEl.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-auth]");
  if (!b) return;
  const a = b.dataset.auth;
  if (a === "logout") { await sb.auth.signOut(); location.replace(HOME); return; }
  showAuth(a);
});

bodyEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = bodyEl.querySelector('button[type="submit"]');
  const email = ($("#aEmail")?.value || "").trim().toLowerCase();
  const pass = $("#aPass")?.value || "";
  const name = ($("#aName")?.value || "").trim();
  const fail = (text) => { msg = { kind: "err", text }; renderAuth(); };
  if ($("#aEmail") && !EMAIL_RE.test(email)) return fail("Saisis une adresse e-mail valide.");
  if ($("#aName") && !name) return fail("Saisis ton prénom : il apparaîtra dans le classement.");
  if ((mode === "signup" || mode === "recover") && (pass.length < 10 || !/[a-z]/i.test(pass) || !/\d/.test(pass)))
    return fail("Mot de passe trop faible : 10 caractères minimum, avec des lettres et des chiffres.");
  if (mode === "login" && !pass) return fail("Saisis ton mot de passe.");
  btn.disabled = true;
  try {
    if (mode === "login") {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) return fail(authError(error));
      await enter(data.session);
    } else if (mode === "signup") {
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { name }, emailRedirectTo: HOME } });
      if (error) return fail(authError(error));
      if (data.session) await enter(data.session);
      else showAuth("checkmail", { kind: "ok", text: `Un lien de confirmation a été envoyé à ${email}. Clique dessus pour activer ton compte, puis reviens te connecter.` });
    } else if (mode === "forgot") {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: HOME });
      if (error) return fail(authError(error));
      showAuth("checkmail", { kind: "ok", text: `Si un compte existe pour ${email}, un lien pour changer le mot de passe vient d'être envoyé.` });
    } else if (mode === "recover") {
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) return fail(authError(error));
      history.replaceState(null, "", HOME);
      const { data } = await sb.auth.getSession();
      await enter(data.session);
    }
  } catch (err) {
    fail(authError(err));
  } finally {
    if (btn.isConnected) btn.disabled = false;
  }
});

/* ---------------------------------------------------------------------------
   Couche d'accès aux données (API de documents attendue par l'application)
--------------------------------------------------------------------------- */
function wrap(error) {
  const e = new Error(error?.message || "Erreur Supabase");
  const t = `${error?.code || ""} ${error?.message || ""}`;
  e.code = /42501|row-level security|permission denied/i.test(t) ? "not_granted" : "unavailable";
  return e;
}
function parse(path) {
  const p = String(path).split("/");
  if (p.length === 2 && p[0] === "players") return { kind: "players", table: "players", key: "user_id", id: p[1] };
  if (p.length === 2 && p[0] === "questions") return { kind: "questions", table: "questions", key: "id", id: p[1] };
  if (p.length === 4 && p[0] === "data" && p[1] === "users") return { kind: "user_data", uid: p[2], id: p[3] };
  if (path === "config/roles") return { kind: "roles" };
  throw Object.assign(new Error("Chemin non pris en charge : " + path), { code: "unavailable" });
}
const snap = (id, data) => ({ id, exists: data != null, data: () => data });

async function fetchAdmins() {
  const { data, error } = await sb.rpc("list_admins");
  if (error) throw wrap(error);
  return (data || []).map((x) => (typeof x === "string" ? x : x.list_admins)).filter(Boolean);
}
async function fetchAll(table, key) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(`${key},data`).order(key).range(from, from + 999);
    if (error) throw wrap(error);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// Rafraîchissements regroupés par sujet (temps réel, focus, écriture locale)
const topics = { players: new Set(), questions: new Set(), roles: new Set() };
const timers = {};
function bump(topic, delay = 900) {
  clearTimeout(timers[topic]);
  timers[topic] = setTimeout(() => topics[topic].forEach((fn) => fn()), delay);
}
function listen(topic, fn) { topics[topic].add(fn); fn(); return () => topics[topic].delete(fn); }

const db = {
  doc(path) {
    const r = parse(path);
    return {
      async get() {
        if (r.kind === "roles") return snap("roles", { admins: await fetchAdmins() });
        let q;
        if (r.kind === "user_data") q = sb.from("user_data").select("data").eq("user_id", r.uid).eq("key", r.id);
        else q = sb.from(r.table).select("data").eq(r.key, r.id);
        const { data, error } = await q.maybeSingle();
        if (error) throw wrap(error);
        return snap(r.id, data ? data.data : null);
      },
      async set(value) {
        const v = JSON.parse(JSON.stringify(value ?? {}));
        let res;
        if (r.kind === "roles") { res = await sb.rpc("set_admins", { ids: Array.isArray(v.admins) ? v.admins : [] }); if (!res.error) bump("roles", 50); }
        else if (r.kind === "user_data") res = await sb.from("user_data").upsert({ user_id: r.uid, key: r.id, data: v });
        else if (r.kind === "players") res = await sb.from("players").upsert({ user_id: r.id, data: v });
        else res = await sb.from("questions").upsert({ id: r.id, data: v });
        if (res.error) throw wrap(res.error);
      },
      async delete() {
        let res;
        if (r.kind === "user_data") res = await sb.from("user_data").delete().eq("user_id", r.uid).eq("key", r.id);
        else if (r.kind === "roles") return;
        else res = await sb.from(r.table).delete().eq(r.key, r.id);
        if (res.error) throw wrap(res.error);
      },
      onSnapshot(cb, onErr) {
        const topic = r.kind === "roles" ? "roles" : r.kind === "players" ? "players" : r.kind === "questions" ? "questions" : null;
        const run = () => this.get().then(cb, (e) => onErr && onErr(e));
        if (!topic) { run(); return () => {}; }
        return listen(topic, run);
      },
    };
  },
  collection(path) {
    const table = path === "players" ? "players" : path === "questions" ? "questions" : null;
    if (!table) throw Object.assign(new Error("Collection non prise en charge : " + path), { code: "unavailable" });
    const key = table === "players" ? "user_id" : "id";
    return {
      onSnapshot(cb, onErr) {
        return listen(table, () => fetchAll(table, key).then(
          (rows) => cb({ docs: rows.map((row) => snap(row[key], row.data)) }),
          (e) => onErr && onErr(e)));
      },
    };
  },
};

const names = {};
const user = {
  async id() { return me.id; },
  async me() { return { id: me.id, name: me.name }; },
  async isOwner() { return me.role === "owner"; },
  async canEdit() { return me.role !== "user"; },
  async can(n) { return n === "data.write" ? true : null; },
  async profiles(ids) {
    const want = [...new Set(ids)].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    if (want.length) {
      const { data } = await sb.rpc("get_profiles", { ids: want });
      for (const row of data || []) names[row.user_id] = { name: row.name || "", role: row.role };
    }
    const out = {};
    for (const id of ids) out[id] = { id, name: names[id]?.name || "" };
    return out;
  },
};

const downloads = {
  async save({ filename, data }) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: filename || "fichier" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};

window.claude = { use: async (n) => (n === "db" ? db : n === "user" ? user : n === "downloads" ? downloads : null) };

/* ---------------------------------------------------------------------------
   Compte et équipe dans le profil (fonctions appelées par l'application)
--------------------------------------------------------------------------- */
const team = { list: null, loading: false, confirm: null, err: null };
async function loadTeam() {
  if (me.role !== "owner" || team.loading) return;
  team.loading = true;
  const { data, error } = await sb.from("members").select("email,role,display_name,user_id,added_at").order("added_at");
  team.loading = false;
  team.err = error ? "Impossible de charger la liste de l'équipe." : null;
  team.list = data || [];
  rerenderProfile();
}
function rerenderProfile() {
  try { if (typeof S !== "undefined" && S.tab === "profile" && $("#session").hidden) globalThis.render(); } catch (e) { /* app pas encore prête */ }
}
function note(text) { try { globalThis.toast(text); } catch (e) { /* ignore */ } }

window.WEE = {
  profileHtml() {
    if (!me) return "";
    const acc = `<div class="sec-title">Mon compte</div>
  <div class="card"><div class="acct"><div><b class="astrong">${esc(me.name || me.email)}</b><span class="note">${esc(me.email)} · ${ROLE_LABEL[me.role] || "Utilisateur"}</span></div><button class="btn ghost small" data-act="wee-logout">Se déconnecter</button></div>
  <p class="note" style="margin:0">${me.role === "user" ? "Tu suis les cours et les questions, ta progression est partagée avec l'équipe." : "Tu suis les cours et tu peux importer ou remplacer les questions de l'équipe."}</p>
  <label class="afield" for="weeName"><span>Prénom affiché dans le classement</span><span class="arow"><input id="weeName" class="txtin" maxlength="40" value="${esc(me.name)}"><button class="btn small" data-act="wee-name">Enregistrer</button></span></label></div>`;
    if (me.role !== "owner") return acc;
    if (!team.list && !team.loading) loadTeam();
    const rows = (team.list || []).map((m) => {
      const owner = m.role === "owner";
      const label = m.display_name || (m.user_id ? m.email.split("@")[0] : "");
      const status = m.user_id ? esc(label) : "En attente d'inscription";
      const conf = team.confirm === m.email;
      return `<div class="trow"><div class="tinfo"><b>${esc(m.email)}</b><span class="note">${status}</span></div>${owner ? `<span class="chip">Propriétaire</span>` : conf
        ? `<span class="tact"><button class="btn red small" data-act="wee-del-yes" data-email="${esc(m.email)}">Retirer</button><button class="btn ghost small" data-act="wee-del-no">Annuler</button></span>`
        : `<span class="tact"><button class="btn small ${m.role === "admin" ? "" : "ghost"}" data-act="wee-role" data-email="${esc(m.email)}" aria-pressed="${m.role === "admin"}">${m.role === "admin" ? "Administrateur" : "Utilisateur"}</button><button class="iconbtn" data-act="wee-del" data-email="${esc(m.email)}" aria-label="Retirer ${esc(m.email)}" title="Retirer l'accès"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></span>`}</div>`;
    }).join("");
    return `${acc}<div class="sec-title">Équipe et accès</div>
  <div class="card"><p class="note" style="margin:0">Seules les adresses de cette liste peuvent créer un compte. Les administrateurs peuvent importer et remplacer les questions. Retirer une adresse coupe son accès et la retire du classement.</p>
  <label class="afield" for="weeAdd"><span>Ajouter une adresse</span><span class="arow"><input id="weeAdd" class="txtin" type="email" placeholder="prenom.nom@entreprise.fr" autocomplete="off"><button class="btn small" data-act="wee-add">Ajouter</button></span></label>
  ${team.err ? `<p class="amsg err">${esc(team.err)}</p>` : ""}
  ${team.list ? `<div class="tlist">${rows}</div>` : `<p class="note">Chargement de la liste…</p>`}</div>`;
  },
};

document.addEventListener("click", async (e) => {
  const b = e.target.closest('[data-act^="wee-"]');
  if (!b || !me) return;
  const a = b.dataset.act;
  const email = b.dataset.email;
  if (a === "wee-logout") { await sb.auth.signOut(); location.replace(HOME); return; }
  if (a === "wee-name") {
    const v = ($("#weeName")?.value || "").trim().slice(0, 40);
    if (!v) return note("Saisis un prénom");
    const { error } = await sb.rpc("set_my_name", { new_name: v });
    if (error) return note("Enregistrement impossible");
    me.name = v; names[me.id] = { name: v, role: me.role };
    try { S.names[me.id] = v; } catch (err) { /* ignore */ }
    note("Prénom enregistré"); rerenderProfile(); return;
  }
  if (me.role !== "owner") return;
  if (a === "wee-add") {
    const v = ($("#weeAdd")?.value || "").trim().toLowerCase();
    if (!EMAIL_RE.test(v)) return note("Adresse e-mail invalide");
    const { error } = await sb.from("members").insert({ email: v, role: "user" });
    if (error) return note(/23505|duplicate/i.test(`${error.code} ${error.message}`) ? "Cette adresse est déjà dans la liste" : "Ajout impossible");
    note("Adresse ajoutée : la personne peut créer son compte"); team.list = null; loadTeam(); return;
  }
  if (a === "wee-role") {
    const m = (team.list || []).find((x) => x.email === email); if (!m) return;
    const role = m.role === "admin" ? "user" : "admin";
    const { error } = await sb.from("members").update({ role }).eq("email", email);
    if (error) return note("Modification impossible");
    m.role = role; bump("roles", 50); note(role === "admin" ? "Rôle administrateur attribué" : "Rôle utilisateur attribué"); rerenderProfile(); return;
  }
  if (a === "wee-del") { team.confirm = email; rerenderProfile(); return; }
  if (a === "wee-del-no") { team.confirm = null; rerenderProfile(); return; }
  if (a === "wee-del-yes") {
    const { error } = await sb.from("members").delete().eq("email", email);
    team.confirm = null;
    if (error) { note("Suppression impossible"); rerenderProfile(); return; }
    note("Accès retiré"); team.list = null; bump("players", 50); bump("roles", 50); loadTeam(); return;
  }
});

/* ---------------------------------------------------------------------------
   Démarrage
--------------------------------------------------------------------------- */
function startRealtime() {
  sb.channel("weecert")
    .on("postgres_changes", { event: "*", schema: "public", table: "players" }, () => bump("players"))
    .on("postgres_changes", { event: "*", schema: "public", table: "questions" }, () => bump("questions", 1500))
    .subscribe();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { bump("players", 100); bump("roles", 100); }
  });
}

function runApp() {
  // Le cache local de l'app est propre à chaque compte (navigateur partagé)
  try {
    if (localStorage.getItem("briko:uid") !== me.id) {
      Object.keys(localStorage).filter((k) => k.startsWith("briko:")).forEach((k) => localStorage.removeItem(k));
      localStorage.setItem("briko:uid", me.id);
    }
  } catch (e) { /* stockage indisponible : l'app fonctionne sans cache */ }
  for (const s of document.querySelectorAll('script[type="text/weecert"]')) {
    const n = document.createElement("script");
    n.textContent = s.textContent;
    document.body.appendChild(n);
  }
}

async function enter(session) {
  if (!session) return showAuth("login");
  if (started) return;
  showAuth("loading");
  const uid = session.user.id;
  const { data, error } = await sb.rpc("get_profiles", { ids: [uid] });
  if (error) return showAuth("login", { kind: "err", text: authError(error) });
  const row = (data || [])[0];
  if (!row) return showAuth("denied");
  me = { id: uid, email: session.user.email, name: row.name || "", role: row.role };
  names[uid] = { name: me.name, role: me.role };
  started = true;
  authEl.hidden = true;
  document.body.classList.remove("locked");
  startRealtime();
  runApp();
}

(async function boot() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return showAuth("config");
  showAuth("loading");
  const recovering = /type=recovery/.test(location.hash);
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
  });
  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") showAuth("recover");
    if (event === "SIGNED_OUT" && started) location.replace(HOME);
  });
  const { data } = await sb.auth.getSession();
  if (recovering) return showAuth("recover");
  if (/error_description=/.test(location.hash)) {
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", HOME);
    return showAuth("login", { kind: "err", text: /expired/i.test(p.get("error_description") || "") ? "Ce lien a expiré. Demande-en un nouveau." : "Ce lien n'est plus valable." });
  }
  if (data.session) {
    if (location.hash) history.replaceState(null, "", HOME);
    return enter(data.session);
  }
  showAuth("login");
})();
