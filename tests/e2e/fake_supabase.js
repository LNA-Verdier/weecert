// Faux client Supabase en mémoire, pour tester le site sans serveur.
// Il reproduit le sous-ensemble de supabase-js utilisé par js/supa.js et les règles principales de schema.sql.
// Données initiales : window.__FAKE_SEED = { members:[{email,role,user_id,display_name,password}], questions:[{id,data}] }
export function createClient() {
  const seed = window.__FAKE_SEED || { members: [], questions: [] };
  const KEY = "fake-sb";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  const st = load() || {
    members: seed.members.map(({ password, ...m }) => ({ display_name: null, added_at: new Date().toISOString(), ...m })),
    passwords: Object.fromEntries(seed.members.filter((m) => m.password).map((m) => [m.email, m.password])),
    players: [], user_data: [], questions: seed.questions || [], session: null,
  };
  const save = () => localStorage.setItem(KEY, JSON.stringify(st));
  save();
  window.__fake = st;
  const listeners = [];
  const uid = () => st.session?.user.id || null;
  const meRow = () => st.members.find((m) => m.user_id && m.user_id === uid());
  const role = () => meRow()?.role || null;
  const denied = { message: "new row violates row-level security policy", code: "42501" };

  function query(table) {
    let filters = [], op = "select", payload = null, single = false, from = 0, to = 1e9;
    const rows = () => st[table].filter((r) => filters.every(([k, v]) => r[k] === v));
    const canRead = () => table === "members" ? true : table === "user_data" ? true : !!role();
    const canWrite = (row) => {
      if (table === "questions") return ["owner", "admin"].includes(role());
      if (table === "players" || table === "user_data") return row.user_id === uid() && !!role();
      if (table === "members") return role() === "owner";
      return false;
    };
    const run = async () => {
      if (op === "select") {
        if (!canRead()) return { data: [], error: null };
        let r = rows();
        if (table === "user_data") r = r.filter((x) => x.user_id === uid());
        if (table === "members" && role() !== "owner") r = r.filter((x) => x.user_id === uid());
        r = r.slice(from, to + 1).map((x) => JSON.parse(JSON.stringify(x)));
        return { data: single ? r[0] || null : r, error: null };
      }
      if (op === "upsert" || op === "insert") {
        const key = table === "players" ? ["user_id"] : table === "user_data" ? ["user_id", "key"] : table === "members" ? ["email"] : ["id"];
        if (!canWrite(payload)) return { data: null, error: denied };
        const i = st[table].findIndex((r) => key.every((k) => r[k] === payload[k]));
        if (i >= 0 && op === "insert") return { data: null, error: { code: "23505", message: "duplicate key" } };
        if (i >= 0) st[table][i] = { ...st[table][i], ...payload }; else st[table].push({ ...payload });
        save(); return { data: null, error: null };
      }
      if (op === "update") {
        for (const r of rows()) { if (canWrite(r) && !(table === "members" && r.role === "owner")) Object.assign(r, payload); }
        save(); return { data: null, error: null };
      }
      if (op === "delete") {
        const del = rows().filter((r) => canWrite(r) && !(table === "members" && r.role === "owner"));
        st[table] = st[table].filter((r) => !del.includes(r));
        if (table === "members") for (const m of del) st.players = st.players.filter((p) => p.user_id !== m.user_id);
        save(); return { data: null, error: null };
      }
    };
    const b = {
      select() { op = op === "select" ? "select" : op; return b; },
      eq(k, v) { filters.push([k, v]); return b; },
      order() { return b; },
      range(a, z) { from = a; to = z; return b; },
      maybeSingle() { single = true; return b; },
      upsert(p) { op = "upsert"; payload = p; return b; },
      insert(p) { op = "insert"; payload = p; return b; },
      update(p) { op = "update"; payload = p; return b; },
      delete() { op = "delete"; return b; },
      then(res, rej) { return run().then(res, rej); },
    };
    return b;
  }

  const auth = {
    async getSession() { return { data: { session: st.session }, error: null }; },
    onAuthStateChange(fn) { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword({ email, password }) {
      const m = st.members.find((x) => x.email === email);
      if (!m || !m.user_id || st.passwords[email] !== password) return { data: {}, error: { message: "Invalid login credentials" } };
      st.session = { user: { id: m.user_id, email } }; save();
      return { data: { session: st.session }, error: null };
    },
    async signUp({ email, password, options }) {
      const m = st.members.find((x) => x.email === email);
      if (!m) return { data: {}, error: { message: "Database error saving new user" } };
      if (m.user_id) return { data: {}, error: { message: "User already registered" } };
      m.user_id = crypto.randomUUID(); m.display_name = m.display_name || options?.data?.name || null;
      st.passwords[email] = password; save();
      return { data: { session: null, user: { id: m.user_id } }, error: null };
    },
    async signOut() { st.session = null; save(); listeners.forEach((fn) => fn("SIGNED_OUT", null)); return { error: null }; },
    async resetPasswordForEmail() { return { error: null }; },
    async updateUser() { return { data: {}, error: null }; },
  };

  async function rpc(name, args) {
    const r = role();
    if (name === "get_profiles") return { data: r ? st.members.filter((m) => m.user_id && args.ids.includes(m.user_id)).map((m) => ({ user_id: m.user_id, name: m.display_name || m.email.split("@")[0], role: m.role })) : [], error: null };
    if (name === "list_admins") return { data: r ? st.members.filter((m) => m.role === "admin" && m.user_id).map((m) => m.user_id) : [], error: null };
    if (name === "set_admins") { if (r !== "owner") return { data: null, error: denied }; st.members.forEach((m) => { if (m.role !== "owner" && m.user_id) m.role = args.ids.includes(m.user_id) ? "admin" : "user"; }); save(); return { data: null, error: null }; }
    if (name === "set_my_name") { const m = meRow(); if (m) m.display_name = args.new_name; save(); return { data: null, error: null }; }
    return { data: null, error: { message: "unknown rpc" } };
  }

  const channel = () => { const c = { on() { return c; }, subscribe() { return c; } }; return c; };
  return { auth, from: query, rpc, channel };
}
