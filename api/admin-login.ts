declare const process: {
  env: Record<string, string | undefined>;
};

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "3359799@";

type ApiRequest = {
  method?: string;
  body?: string | {
    password?: unknown;
  };
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => {
    json: (body: unknown) => void;
  };
};

export default function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false });
    return;
  }

  const body = typeof request.body === "string" ? safeParseJson(request.body) : request.body;
  const password = typeof body?.password === "string" ? body.password : "";
  response.status(password === ADMIN_PASSWORD ? 200 : 401).json({ ok: password === ADMIN_PASSWORD });
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as { password?: unknown };
  } catch {
    return {};
  }
}
