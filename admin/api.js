(() => {
  const endpoint = "https://mfgqbljtswvuqwluayfj.supabase.co/functions/v1/zafire-admin";
  const key = "sb_publishable_P6p_BOD8gG1oKN2ggOAKpQ_gy5-Aqqr";
  const tokenKey = "zafire_admin_session";
  let token = sessionStorage.getItem(tokenKey) || "";
  async function call(payload, auth = true) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": key, ...(auth && token ? { "Authorization": "Bearer " + token } : {}) },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({ error: { message: "Respuesta inválida del servidor." } }));
    if ((!response.ok || result.error) && response.status === 401 && auth) { token = ""; sessionStorage.removeItem(tokenKey); }
    if (!response.ok && !result.error) result.error = { message: "No se pudo completar la operación." };
    return result;
  }
  const login = async password => {
    const result = await call({ action: "login", password }, false);
    if (result.error) throw new Error(result.error.message || "Contraseña incorrecta.");
    token = result.data.token;
    sessionStorage.setItem(tokenKey, token);
    return result.data;
  };
  const logout = async () => { try { if (token) await call({ action: "logout" }); } finally { token = ""; sessionStorage.removeItem(tokenKey); } };
  class Query {
    constructor(table) { this.table = table; this.method = "select"; this.columns = "*"; this.values = null; this.filters = []; this.orders = []; this.max = null; this.single = false; this.conflict = null; }
    select(columns = "*") { this.columns = columns; return this; }
    insert(values) { this.method = "insert"; this.values = values; return this; }
    update(values) { this.method = "update"; this.values = values; return this; }
    upsert(values, options = {}) { this.method = "upsert"; this.values = values; this.conflict = options.onConflict || null; return this; }
    delete() { this.method = "delete"; return this; }
    eq(column, value) { this.filters.push({ op: "eq", column, value }); return this; }
    order(column, options = {}) { this.orders.push({ column, ascending: options.ascending !== false }); return this; }
    limit(value) { this.max = value; return this; }
    maybeSingle() { this.single = true; return this; }
    then(resolve, reject) {
      return call({ action: "query", table: this.table, method: this.method, columns: this.columns, values: this.values, filters: this.filters, orders: this.orders, limit: this.max, single: this.single, onConflict: this.conflict }).then(data => resolve ? resolve(data) : data, reject);
    }
  }
  const storage = {
    from(bucket) {
      const publicRoot = "https://mfgqbljtswvuqwluayfj.supabase.co/storage/v1/object/public/" + encodeURIComponent(bucket) + "/";
      return {
        getPublicUrl(path) { return { data: { publicUrl: publicRoot + path.split("/").map(encodeURIComponent).join("/") } }; },
        async upload(path, file, options = {}) {
          let source = file;
          let contentType = options.contentType || file.type || "application/octet-stream";
          if (file.type?.startsWith("image/") && !["image/svg+xml","image/gif"].includes(file.type) && typeof createImageBitmap === "function") {
            try {
              const bitmap = await createImageBitmap(file);
              const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
              const canvas = document.createElement("canvas");
              canvas.width = Math.max(1, Math.round(bitmap.width * scale));
              canvas.height = Math.max(1, Math.round(bitmap.height * scale));
              canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
              bitmap.close();
              const compressed = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.82));
              if (compressed && compressed.size < file.size) { source = compressed; contentType = "image/webp"; }
            } catch (_) {}
          }
          if (source.size > 4 * 1024 * 1024) return { data: null, error: { message: "El archivo supera 4 MB después de optimizarlo. Reduce su tamaño e inténtalo de nuevo." } };
          const bytes = new Uint8Array(await source.arrayBuffer());
          let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return call({ action: "storage", method: "upload", bucket, path, contentType, file: btoa(binary) });
        },
        remove(paths) { return call({ action: "storage", method: "remove", bucket, paths }); },
        createSignedUrl(path) { return call({ action: "storage", method: "signedUrl", bucket, path }); }
      };
    }
  };
  window.zafireAdminAuth = { login, logout, hasSession: () => Boolean(token) };
  window.zafireAdminClient = { from: table => new Query(table), storage };
})();