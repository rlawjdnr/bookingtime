import { mkdir, writeFile } from "node:fs/promises";

const entry = `export default {
  async fetch(request, env) {
    if (!env.ASSETS) {
      return new Response("Static asset binding is not configured.", { status: 500 });
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) {
      return response;
    }

    const url = new URL(request.url);
    url.pathname = "/";
    url.search = "";
    return env.ASSETS.fetch(new Request(url, request));
  },
};
`;

await mkdir("dist/server", { recursive: true });
await writeFile("dist/server/index.js", entry);
