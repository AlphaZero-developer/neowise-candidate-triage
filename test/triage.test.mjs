import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server.mjs";

const server = createApp();
let url;

before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${server.address().port}/api/triage`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

async function request(body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { statusCode: response.status, body: await response.json() };
}

test("valid request returns topic and draft", async () => {
  const result = await request({ text: "Какая стоимость услуги?" });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, {
    status: "ready",
    topic: "pricing",
    draft: "Спасибо за обращение. Уточним детали заявки.",
  });
});

test("invalid input returns 400", async () => {
  for (const body of [
    { text: "" }, { text: "   \n" }, {}, { text: 42 },
    { text: null }, [], "{bad-json", "null", "123",
  ]) {
    const result = await request(body);
    assert.deepEqual(result, { statusCode: 400, body: { status: "invalid_input" } });
  }
});

test("provider errors, invalid JSON, unknown topic and blank draft require manual review", async () => {
  for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    const result = await request({ text: marker });
    assert.deepEqual(result, {
      statusCode: 200,
      body: { status: "manual_review", topic: null, draft: null },
    }, marker);
  }
});

test("provider timeout is capped at 300ms and returns manual review", async () => {
  const started = performance.now();
  const result = await request({ text: "[timeout]" });
  const elapsed = performance.now() - started;
  assert.deepEqual(result, {
    statusCode: 200,
    body: { status: "manual_review", topic: null, draft: null },
  });
  assert.ok(elapsed < 900, `Timeout took ${elapsed.toFixed(0)}ms`);
});
