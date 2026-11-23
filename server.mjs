import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));
const allowedTopics = new Set(["delivery", "pricing", "other"]);
const modelTimeoutMs = 300;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readInput(request) {
  const chunks = [];
  try {
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    if (typeof body.text !== "string" || !body.text.trim()) return null;
    return body.text.trim();
  } catch {
    return null;
  }
}

function parseModelResult(raw) {
  if (typeof raw !== "string") return null;

  try {
    const result = JSON.parse(raw);
    if (!result || typeof result !== "object" || Array.isArray(result)) return null;
    if (!allowedTopics.has(result.topic)) return null;
    if (typeof result.draft !== "string" || !result.draft.trim()) return null;
    return { status: "ready", topic: result.topic, draft: result.draft.trim() };
  } catch {
    return null;
  }
}

async function triage(text) {
  const controller = new AbortController();
  let timeout;
  try {
    // The race also limits providers that ignore AbortSignal.
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("AI timeout"));
      }, modelTimeoutMs);
    });
    const raw = await Promise.race([classify(text, { signal: controller.signal }), deadline]);
    return parseModelResult(raw) ?? { status: "manual_review", topic: null, draft: null };
  } catch {
    return { status: "manual_review", topic: null, draft: null };
  } finally {
    clearTimeout(timeout);
  }
}

export function createApp() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      json(response, 404, { status: "not_found" });
      return;
    }

    const text = await readInput(request);
    if (text === null) {
      json(response, 400, { status: "invalid_input" });
      return;
    }
    json(response, 200, await triage(text));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, "127.0.0.1", () => {
    console.log(`Triage available at http://127.0.0.1:${port}`);
  });
}
