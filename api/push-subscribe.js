const crypto = require("crypto");

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
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  const subscription = normalizeSubscription(body.subscription);
  const reservations = Array.isArray(body.reservations) ? body.reservations : [];

  if (!deviceId || !subscription || !reservations.length) {
    sendJson(response, 400, { ok: false });
    return;
  }

  try {
    const rows = [];

    for (const reservation of reservations) {
      const reservationId = typeof reservation.id === "string" ? reservation.id : "";
      const ownerToken = typeof reservation.ownerToken === "string" ? reservation.ownerToken : "";
      if (!reservationId || !ownerToken) continue;

      const ownerTokenHash = hashOwnerToken(ownerToken);
      const isOwner = await verifyReservationOwner(reservationId, ownerTokenHash, serviceRoleKey);
      if (!isOwner) continue;

      rows.push({
        reservation_id: reservationId,
        device_id: deviceId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        expiration_time: subscription.expirationTime ? new Date(subscription.expirationTime).toISOString() : null,
        user_agent: request.headers["user-agent"] || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      });
    }

    if (rows.length) {
      await supabaseRest("/reservation_push_subscriptions?on_conflict=reservation_id,endpoint", serviceRoleKey, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(rows),
      });
    }

    sendJson(response, 200, { ok: true, registered: rows.length });
  } catch (error) {
    console.error("Failed to save push subscription", error);
    sendJson(response, 500, { ok: false });
  }
};

async function verifyReservationOwner(reservationId, ownerTokenHash, serviceRoleKey) {
  const query = new URLSearchParams({
    id: `eq.${reservationId}`,
    owner_token_hash: `eq.${ownerTokenHash}`,
    status: "eq.confirmed",
    select: "id",
  });
  const rows = await supabaseRest(`/reservations?${query.toString()}`, serviceRoleKey);
  return Array.isArray(rows) && rows.length === 1;
}

function normalizeSubscription(subscription) {
  if (!subscription || typeof subscription !== "object") return null;
  const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint : "";
  const keys = subscription.keys && typeof subscription.keys === "object" ? subscription.keys : {};
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";

  if (!endpoint || !p256dh || !auth) return null;
  return {
    endpoint,
    expirationTime: typeof subscription.expirationTime === "number" ? subscription.expirationTime : null,
    keys: { p256dh, auth },
  };
}

function hashOwnerToken(token) {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

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
  return response.json();
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
