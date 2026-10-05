import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { User } from "@fitcoach/domain";
import { buildExampleUser, createServer, createUserSummary } from "../server";

async function withServer(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("GET /healthz returns ok", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string };
    assert.equal(body.status, "ok");
  });
});

test("GET /v0/example-profile returns a domain-shaped user", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v0/example-profile`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      user: User;
      summary: string;
    };
    assert.equal(body.user.id, "usr_example");
    assert.equal(body.user.profile.heightCm, 180);
    assert.match(body.summary, /height=180cm/);
  });
});

test("unknown routes return 404", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/nope`);
    assert.equal(response.status, 404);
  });
});

test("createUserSummary formats profile facts deterministically", () => {
  const summary = createUserSummary(buildExampleUser());
  assert.match(summary, /experience=intermediate/);
  assert.match(summary, /trainingDays\/week=4/);
});
