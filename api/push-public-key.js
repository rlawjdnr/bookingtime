module.exports = function handler(request, response) {
  if (!["GET", "HEAD"].includes(request.method)) {
    sendJson(response, 405, { ok: false });
    return;
  }

  const publicKey = (process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || "").trim();

  response.setHeader("Cache-Control", "no-store");
  if (!publicKey) {
    sendJson(response, 500, { ok: false, error: "Missing VAPID public key" });
    return;
  }

  sendJson(response, 200, { ok: true, publicKey });
};

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
