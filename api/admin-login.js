const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "3359799@";

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false });
    return;
  }

  const body = await readBody(request);
  const password = typeof body.password === "string" ? body.password.trim() : "";
  sendJson(response, password === ADMIN_PASSWORD ? 200 : 401, {
    ok: password === ADMIN_PASSWORD,
  });
};

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
