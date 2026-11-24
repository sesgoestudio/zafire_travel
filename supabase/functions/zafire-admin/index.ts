import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const TABLES = new Set(["reservation_requests","blocked_dates","customers","site_media","site_settings","team_members","reservation_events"]);
const BUCKETS = new Set(["zafire-media","zafire-proofs"]);
const ALLOWED_ORIGINS = new Set(["https://sesgoestudio.github.io"]);
const cors = (origin: string) => ({
  "Access-Control-Allow-Origin": origin || "https://sesgoestudio.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
});
const json = (data: unknown, status = 200, origin = "") =>
  new Response(JSON.stringify(data), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
const hex = (bytes: Uint8Array) => [...bytes].map(x => x.toString(16).padStart(2,"0")).join("");
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function applyFilters(q: any, filters: any[] = []) {
  for (const f of filters) {
    if (!["eq","neq","gt","gte","lt","lte","is","in"].includes(f.op)) throw new Error("Filtro no permitido.");
    q = q[f.op](f.column, f.value);
  }
  return q;
}
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: { message: "Origen no autorizado." } }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: { message: "Método no permitido." } }, 405, origin);
  try {
    const body = await req.json();
    if (body.action === "login") {
      const password = String(body.password || "");
      if (password.length < 8 || password.length > 256) return json({ error: { message: "Credenciales incorrectas." } }, 401, origin);
      const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
      const ipHash = await sha256(ip);
      const { data: allowed, error: rateError } = await db.rpc("zafire_admin_login_allowed", { p_ip_hash: ipHash });
      if (rateError) throw rateError;
      if (allowed !== true) return json({ error: { message: "Demasiados intentos. Espera 15 minutos antes de volver a intentar." } }, 429, origin);
      const { data: valid, error } = await db.rpc("zafire_verify_admin_password", { p_password: password });
      if (error) throw error;
      if (valid !== true) return json({ error: { message: "Contraseña incorrecta." } }, 401, origin);
      await db.from("zafire_admin_login_limits").delete().eq("ip_hash", ipHash);
      const token = hex(crypto.getRandomValues(new Uint8Array(32)));
      const tokenHash = await sha256(token);
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      const { error: insertError } = await db.from("zafire_admin_sessions").insert({ token_hash: tokenHash, expires_at: expiresAt });
      if (insertError) throw insertError;
      return json({ data: { token, expires_at: expiresAt } }, 200, origin);
    }

    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || token.length !== 64) return json({ error: { message: "Sesión no válida." } }, 401, origin);
    const tokenHash = await sha256(token);
    const { data: session, error: sessionError } = await db.from("zafire_admin_sessions").select("token_hash,expires_at").eq("token_hash", tokenHash).maybeSingle();
    if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) {
      if (session) await db.from("zafire_admin_sessions").delete().eq("token_hash", tokenHash);
      return json({ error: { message: "La sesión expiró. Ingresa nuevamente." } }, 401, origin);
    }

    if (body.action === "logout") {
      const { error } = await db.from("zafire_admin_sessions").delete().eq("token_hash", tokenHash);
      if (error) throw error;
      return json({ data: { ok: true } }, 200, origin);
    }

    if (body.action === "query") {
      const table = String(body.table || "");
      if (!TABLES.has(table)) return json({ error: { message: "Recurso no permitido." } }, 403, origin);
      let q: any = db.from(table);
      if (body.method === "select") q = q.select(body.columns || "*");
      else if (body.method === "insert") q = q.insert(body.values);
      else if (body.method === "update") q = q.update(body.values);
      else if (body.method === "upsert") q = q.upsert(body.values, body.onConflict ? { onConflict: body.onConflict } : undefined);
      else if (body.method === "delete") q = q.delete();
      else return json({ error: { message: "Operación no permitida." } }, 400, origin);
      q = applyFilters(q, body.filters);
      for (const order of body.orders || []) q = q.order(order.column, { ascending: order.ascending !== false });
      if (Number.isInteger(body.limit) && body.limit > 0 && body.limit <= 1000) q = q.limit(body.limit);
      if (body.single) q = q.maybeSingle();
      const { data, error } = await q;
      if (error) return json({ error: { message: error.message, code: error.code, details: error.details } }, 400, origin);
      return json({ data, error: null }, 200, origin);
    }

    if (body.action === "storage") {
      const bucket = String(body.bucket || "");
      if (!BUCKETS.has(bucket)) return json({ error: { message: "Almacenamiento no permitido." } }, 403, origin);
      const path = String(body.path || "");
      if (!path || path.includes("..") || path.startsWith("/")) return json({ error: { message: "Ruta inválida." } }, 400, origin);
      if (body.method === "upload") {
        const binary = Uint8Array.from(atob(String(body.file || "")), c => c.charCodeAt(0));
        const { data, error } = await db.storage.from(bucket).upload(path, binary, { contentType: body.contentType || "application/octet-stream", upsert: false });
        if (error) throw error;
        return json({ data, error: null }, 200, origin);
      }
      if (body.method === "remove") {
        const paths = Array.isArray(body.paths) ? body.paths.filter((x: unknown) => typeof x === "string" && !x.includes("..")) : [path];
        const { data, error } = await db.storage.from(bucket).remove(paths);
        if (error) throw error;
        return json({ data, error: null }, 200, origin);
      }
      if (body.method === "signedUrl") {
        const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 300);
        if (error) throw error;
        return json({ data, error: null }, 200, origin);
      }
      if (body.method === "publicUrl") {
        const { data } = db.storage.from(bucket).getPublicUrl(path);
        return json({ data, error: null }, 200, origin);
      }
      return json({ error: { message: "Operación de almacenamiento no permitida." } }, 400, origin);
    }
    return json({ error: { message: "Acción no reconocida." } }, 400, origin);
  } catch (error) {
    return json({ error: { message: error instanceof Error ? error.message : "Error interno." } }, 500, origin);
  }
});