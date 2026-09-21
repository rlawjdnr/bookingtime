const webpush = require("web-push");

const DEFAULT_SUPABASE_URL = "https://ohwvtwywwjbwlkknwjxe.supabase.co";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

module.exports = async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    sendJson(response, 405, { ok: false });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  const isManualAuthorized = Boolean(cronSecret && request.headers.authorization === `Bearer ${cronSecret}`);
  if (cronSecret && request.headers.authorization && !isManualAuthorized) {
    sendJson(response, 401, { ok: false });
    return;
  }

  if (!isManualAuthorized && !isKstReminderTime()) {
    sendJson(response, 200, { ok: true, skipped: true, reason: "outside_reminder_time" });
    return;
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@bookingtime.local";

  if (!serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    sendJson(response, 500, { ok: false, error: "Missing push environment variables" });
    return;
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const targetDate = getKstDateKey(1);

  try {
    const reservations = await fetchTomorrowReservations(targetDate, serviceRoleKey);
    const reservationIds = reservations.map((reservation) => reservation.id);

    if (!reservationIds.length) {
      sendJson(response, 200, { ok: true, targetDate, sent: 0, skipped: 0 });
      return;
    }

    const reservationById = new Map(reservations.map((reservation) => [reservation.id, reservation]));
    const subscriptions = await fetchSubscriptions(reservationIds, serviceRoleKey);
    let sent = 0;
    let skipped = 0;

    for (const subscription of subscriptions) {
      if (subscription.last_reminded_for === targetDate) {
        skipped += 1;
        continue;
      }

      const reservation = reservationById.get(subscription.reservation_id);
      if (!reservation) {
        skipped += 1;
        continue;
      }

      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          JSON.stringify({
            title: "김한의원",
            body: `내일은 진료일입니다. ${formatKoreanDate(reservation.appointment_date)} ${reservation.appointment_time}`,
            url: "/?view=myBookings",
          }),
        );
        sent += 1;
        await markReminderSent(subscription.id, targetDate, serviceRoleKey);
      } catch (error) {
        if (error && [404, 410].includes(error.statusCode)) {
          await deactivateSubscription(subscription.id, serviceRoleKey);
          skipped += 1;
          continue;
        }

        throw error;
      }
    }

    sendJson(response, 200, { ok: true, targetDate, sent, skipped });
  } catch (error) {
    console.error("Failed to send push reminders", error);
    sendJson(response, 500, { ok: false });
  }
};

async function fetchTomorrowReservations(targetDate, serviceRoleKey) {
  const query = new URLSearchParams({
    appointment_date: `eq.${targetDate}`,
    status: "eq.confirmed",
    select: "id,appointment_date,appointment_time",
  });
  return supabaseRest(`/reservations?${query.toString()}`, serviceRoleKey);
}

async function fetchSubscriptions(reservationIds, serviceRoleKey) {
  const idFilter = `in.(${reservationIds.join(",")})`;
  const query = new URLSearchParams({
    reservation_id: idFilter,
    is_active: "eq.true",
    select: "id,reservation_id,endpoint,p256dh,auth,last_reminded_for",
  });
  return supabaseRest(`/reservation_push_subscriptions?${query.toString()}`, serviceRoleKey);
}

async function markReminderSent(subscriptionId, targetDate, serviceRoleKey) {
  await supabaseRest(`/reservation_push_subscriptions?id=eq.${subscriptionId}`, serviceRoleKey, {
    method: "PATCH",
    body: JSON.stringify({
      last_reminded_for: targetDate,
      last_reminded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
}

async function deactivateSubscription(subscriptionId, serviceRoleKey) {
  await supabaseRest(`/reservation_push_subscriptions?id=eq.${subscriptionId}`, serviceRoleKey, {
    method: "PATCH",
    body: JSON.stringify({
      is_active: false,
      updated_at: new Date().toISOString(),
    }),
  });
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

function getKstDateKey(daysFromToday) {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  kstNow.setUTCDate(kstNow.getUTCDate() + daysFromToday);
  const year = kstNow.getUTCFullYear();
  const month = String(kstNow.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kstNow.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isKstReminderTime() {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  return kstNow.getUTCHours() === 10 && kstNow.getUTCMinutes() === 30;
}

function formatKoreanDate(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${month}월 ${day}일(${weekdays[date.getDay()]})`;
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
