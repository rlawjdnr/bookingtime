const defaultSheetsWebhookUrl =
  "https://script.google.com/macros/s/AKfycbzYxuzYHligmTmo-cjjsYAi80jMuQVf1GQZ9LZJXjUUf2d9Nql0kkOYQi9DrZ39n7g/exec";

const sheetsWebhookUrl = import.meta.env.VITE_SHEETS_WEBHOOK_URL || defaultSheetsWebhookUrl;

type SheetsReservationAction = "create" | "cancel";

export function syncReservationToGoogleSheet(action: SheetsReservationAction, payload: unknown) {
  if (!sheetsWebhookUrl) return;

  const body = JSON.stringify({
    action,
    payload,
    source: "bookingtime-web",
    syncedAt: new Date().toISOString(),
  });

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    if (navigator.sendBeacon(sheetsWebhookUrl, blob)) return;
  }

  void fetch(sheetsWebhookUrl, {
    method: "POST",
    mode: "no-cors",
    keepalive: true,
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body,
  }).catch((error) => {
    console.warn("Google Sheets sync failed", error);
  });
}
