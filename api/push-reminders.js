const webpush = require("web-push");

const DEFAULT_SUPABASE_URL = "https://ohwvtwywwjbwlkknwjxe.supabase.co";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const REMINDER_LOOKAHEAD_MINUTES = 120;
const REMINDER_WINDOW_MINUTES = 10;
const REMINDER_BODY = "곧 약속된 진료 시간이에요. 조심히 내원해주세요.";

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

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@bookingtime.local";

  if (!serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    sendJson(response, 500, { ok: false, error: "Missing push environment variables" });
    return;
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const reminderWindow = getReminderWindow(request);

  try {
    const reservations = (await fetchDueReservations(reminderWindow.dateKeys, serviceRoleKey))
      .filter((reservation) => isReservationInReminderWindow(reservation, reminderWindow));
    const reservationIds = reservations.map((reservation) => reservation.id);

    if (!reservationIds.length) {
      sendJson(response, 200, {
        ok: true,
        targetSlot: reminderWindow.targetSlot,
        windowStart: formatKstDateTime(reminderWindow.start),
        windowEnd: formatKstDateTime(reminderWindow.end),
        sent: 0,
        skipped: 0,
      });
      return;
    }

    const reservationById = new Map(reservations.map((reservation) => [reservation.id, reservation]));
    const subscriptions = await fetchSubscriptions(reservationIds, serviceRoleKey);
    let sent = 0;
    let skipped = 0;

    for (const subscription of subscriptions) {
      const reservation = reservationById.get(subscription.reservation_id);
      if (!reservation) {
        skipped += 1;
        continue;
      }

      if (subscription.last_reminded_for === reservation.appointment_date) {
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
            title: formatReminderTitle(reservation.appointment_date, reservation.appointment_time),
            body: REMINDER_BODY,
            url: "/?view=myBookings",
          }),
        );
        sent += 1;
        await markReminderSent(subscription.id, reservation.appointment_date, serviceRoleKey);
      } catch (error) {
        if (error && [404, 410].includes(error.statusCode)) {
          await deactivateSubscription(subscription.id, serviceRoleKey);
          skipped += 1;
          continue;
        }

        throw error;
      }
    }

    sendJson(response, 200, {
      ok: true,
      targetSlot: reminderWindow.targetSlot,
      windowStart: formatKstDateTime(reminderWindow.start),
      windowEnd: formatKstDateTime(reminderWindow.end),
      sent,
      skipped,
    });
  } catch (error) {
    console.error("Failed to send push reminders", error);
    sendJson(response, 500, { ok: false });
  }
};

async function fetchDueReservations(targetDates, serviceRoleKey) {
  const query = new URLSearchParams({
    appointment_date: targetDates.length === 1 ? `eq.${targetDates[0]}` : `in.(${targetDates.join(",")})`,
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

function getReminderWindow(request) {
  const scheduledKstTime = parseScheduledKstTime(request);
  const start = new Date(scheduledKstTime.getTime() + REMINDER_LOOKAHEAD_MINUTES * 60 * 1000);
  const end = new Date(start.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000);
  const dateKeys = [...new Set([formatKstDateKey(start), formatKstDateKey(end)])];
  return {
    start,
    end,
    dateKeys,
    targetSlot: formatKstTime(scheduledKstTime),
  };
}

function parseScheduledKstTime(request) {
  const slot = parseReminderSlot(request);
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  kstNow.setUTCSeconds(0, 0);

  if (!slot) return kstNow;

  const hour = Number(slot.slice(0, 2));
  const minute = Number(slot.slice(2, 4));
  const scheduledKstTime = new Date(kstNow);
  scheduledKstTime.setUTCHours(hour, minute, 0, 0);
  return scheduledKstTime;
}

function parseReminderSlot(request) {
  const url = new URL(request.url || "", "https://local");
  const querySlot = url.searchParams.get("slot");
  const pathSlot = url.pathname.match(/\/api\/push-reminders\/(\d{4})$/)?.[1] ?? "";
  const slot = querySlot || pathSlot;
  if (!/^\d{4}$/.test(slot)) return "";

  const hour = Number(slot.slice(0, 2));
  const minute = Number(slot.slice(2, 4));
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return slot;
}

function formatKstDateKey(kstDate) {
  const year = kstDate.getUTCFullYear();
  const month = String(kstDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kstDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isReservationInReminderWindow(reservation, reminderWindow) {
  const appointment = parseAppointmentKstDate(reservation.appointment_date, reservation.appointment_time);
  if (!appointment) return false;
  return appointment.getTime() >= reminderWindow.start.getTime() && appointment.getTime() < reminderWindow.end.getTime();
}

function parseAppointmentKstDate(dateValue, timeValue) {
  const [year, month, day] = String(dateValue || "").split("-").map(Number);
  const match = String(timeValue || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!year || !month || !day || !match) return null;
  return new Date(Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2])));
}

function formatKstDateTime(kstDate) {
  return `${formatKstDateKey(kstDate)} ${String(kstDate.getUTCHours()).padStart(2, "0")}:${String(kstDate.getUTCMinutes()).padStart(2, "0")}`;
}

function formatKstTime(kstDate) {
  return `${String(kstDate.getUTCHours()).padStart(2, "0")}:${String(kstDate.getUTCMinutes()).padStart(2, "0")}`;
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
