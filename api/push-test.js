const crypto = require("crypto");
const webpush = require("web-push");

const DEFAULT_SUPABASE_URL = "https://ohwvtwywwjbwlkknwjxe.supabase.co";
const REMINDER_BODY = "약속된 일정이 다가와 안내드립니다. 편안한 마음으로 내원해주세요.";

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false });
    return;
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@bookingtime.local";

  if (!serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    sendJson(response, 500, { ok: false });
    return;
  }

  const body = await readBody(request);
  const subscription = normalizeSubscription(body.subscription);
  const reservations = Array.isArray(body.reservations) ? body.reservations : [];

  if (!subscription || !reservations.length) {
    sendJson(response, 400, { ok: false });
    return;
  }

  try {
    const reservation = await findOwnedActivePushReservation(reservations, subscription.endpoint, serviceRoleKey);
    if (!reservation) {
      sendJson(response, 403, { ok: false });
      return;
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify({
        title: formatReminderTitle(reservation.appointment_date, reservation.appointment_time),
        body: REMINDER_BODY,
        url: "/?view=myBookings",
      }),
    );

    sendJson(response, 200, { ok: true, sent: 1 });
  } catch (error) {
    console.error("Failed to send test push", error);
    sendJson(response, 500, { ok: false });
  }
};

async function findOwnedActivePushReservation(reservations, endpoint, serviceRoleKey) {
  for (const item of reservations) {
    const reservationId = typeof item.id === "string" ? item.id : "";
    const ownerToken = typeof item.ownerToken === "string" ? item.ownerToken : "";
    if (!reservationId || !ownerToken) continue;

    const ownerTokenHash = hashOwnerToken(ownerToken);
    const reservation = await fetchOwnedReservation(reservationId, ownerTokenHash, serviceRoleKey);
    if (!reservation) continue;

    const hasActiveSubscription = await verifyActiveSubscription(reservationId, endpoint, serviceRoleKey);
    if (hasActiveSubscription) return reservation;
  }

  return null;
}

async function fetchOwnedReservation(reservationId, ownerTokenHash, serviceRoleKey) {
  const query = new URLSearchParams({
    id: `eq.${reservationId}`,
    owner_token_hash: `eq.${ownerTokenHash}`,
    status: "eq.confirmed",
    select: "id,appointment_date,appointment_time",
    limit: "1",
  });
  const rows = await supabaseRest(`/reservations?${query.toString()}`, serviceRoleKey);
  return Array.isArray(rows) ? rows[0] : null;
}

async function verifyActiveSubscription(reservationId, endpoint, serviceRoleKey) {
  const query = new URLSearchParams({
    reservation_id: `eq.${reservationId}`,
    endpoint: `eq.${endpoint}`,
    is_active: "eq.true",
    select: "id",
    limit: "1",
  });
  const rows = await supabaseRest(`/reservation_push_subscriptions?${query.toString()}`, serviceRoleKey);
  return Array.isArray(rows) && rows.length > 0;
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
    keys: { p256dh, auth },
  };
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
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

function hashOwnerToken(token) {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function formatReminderTitle(dateValue, timeValue) {
  return `${formatKoreanDate(dateValue)} ${timeValue} 진료`;
}

function formatKoreanDate(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${month}월 ${day}일 (${weekdays[date.getDay()]})`;
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
