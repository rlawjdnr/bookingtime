const defaultSheetsWebhookUrl =
  "https://script.google.com/macros/s/AKfycbwHm1S3_8QkoLGaNXcfp_KbRzWquSoQtFRAaRFNkHZfQvlAizHpEvNjYBIu5zJDy1A/exec";

const sheetsWebhookUrl = import.meta.env.VITE_SHEETS_WEBHOOK_URL || defaultSheetsWebhookUrl;

type SheetsReservationAction = "create" | "cancel";

export async function syncReservationToGoogleSheet(action: SheetsReservationAction, payload: unknown) {
  if (!sheetsWebhookUrl) return;

  await fetch(sheetsWebhookUrl, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      action,
      payload,
      source: "bookingtime-web",
      syncedAt: new Date().toISOString(),
    }),
  });
}
