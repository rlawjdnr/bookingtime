const DEFAULT_SUPABASE_URL = "https://ohwvtwywwjbwlkknwjxe.supabase.co";

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false });
    return;
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    sendJson(response, 500, { ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY" });
    return;
  }

  const body = await readBody(request);
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";

  if (!endpoint || !deviceId) {
    sendJson(response, 400, { ok: false });
    return;
  }

  try {
    const query = new URLSearchParams({
      endpoint: `eq.${endpoint}`,
      device_id: `eq.${deviceId}`,
    });
    await supabaseRest(`/reservation_push_subscriptions?${query.toString()}`, serviceRoleKey, {
      method: "PATCH",
      body: JSON.stringify({
        is_active: false,
        updated_at: new Date().toISOString(),
      }),
    });

    sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Failed to disable push subscription", error);
    sendJson(response, 500, { ok: false });
  }
};

async function supabaseRest(path, serviceRoleKey, options = {}) {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
  const response = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase REST failed: ${response.status} ${await response.text()}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function readBody(request) {
  if (request.body && typeof request.body === "object") {
    return Promise.resolve(request.body);
  }

  if (typeof request.body === "string") {
    return Promise.resolve(parseJson(request.body));
  }

  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      resolve(parseJson(raw));
    });
    request.on("error", () => {
      resolve({});
    });
  });
}

function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}
