// Tests for the hook, run as Skelcrew runs it: `bun notify.ts` in this
// folder, with the event as one line of JSON on its input and the
// SKELCREW_PLUGIN_* variables set. A stand-in ntfy server on this machine
// takes the place of ntfy.sh, so no test reaches the internet.

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// What the stand-in server was sent: one entry per request.
type Sent = { path: string; auth: string | null; body: unknown };
let sent: Sent[] = [];
// How the stand-in answers: a status, or "hang" to never answer.
let answer: number | "hang" = 200;

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    sent.push({
      path: new URL(request.url).pathname,
      auth: request.headers.get("authorization"),
      body: await request.json(),
    });
    if (answer === "hang") return new Promise<Response>(() => {});
    return new Response(answer === 200 ? '{"id":"x"}' : '{"error":"unauthorized"}', {
      status: answer,
    });
  },
});
const SERVER = `http://127.0.0.1:${server.port}`;

const folders: string[] = [];
let config = "";
afterEach(() => {
  sent = [];
  answer = 200;
});
afterAll(() => {
  server.stop(true);
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

// A plugin-config folder holding `.env` with these lines, or none at all.
function configWith(lines: string[] | null): string {
  const folder = mkdtempSync(join(tmpdir(), "ntfy-config-"));
  folders.push(folder);
  if (lines !== null) writeFileSync(join(folder, ".env"), `${lines.join("\n")}\n`);
  return folder;
}

const VIEW = {
  v: 2,
  id: 142,
  title: "Empty export crashes",
  parent: null,
  phase: "build",
  step: "queued",
  intent: "ship",
  rigor: "light",
  approve: false,
  running: false,
  waitingOnYou: null,
  question: null,
  notTyped: [],
  hold: null,
  ended: null,
  result: null,
  proposals: null,
  approval: null,
  since: "2026-10-19T10:04:31.000Z",
  round: null,
  paused: false,
};

function event(name: string, task: Record<string, unknown>, sample = false): string {
  return `${JSON.stringify({
    v: 1,
    event: name,
    at: "2026-10-19T10:04:31.000Z",
    repo: "/home/simon/shop",
    sample,
    task: { ...VIEW, ...task },
  })}\n`;
}

type Ran = { code: number; out: string; err: string };

async function run(input: string, configFolder = config): Promise<Ran> {
  const child = Bun.spawn(["bun", "notify.ts"], {
    cwd: import.meta.dir,
    stdin: new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      SKELCREW_PLUGIN_ID: "skelcrew.ntfy",
      SKELCREW_PLUGIN_ROOT: import.meta.dir,
      SKELCREW_PLUGIN_CONFIG: configFolder,
      SKELCREW_PLUGIN_STATE: configFolder,
      SKELCREW_EVENT: "task.held",
    },
  });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, out, err };
}

beforeAll(() => {
  config = configWith([`NTFY_SERVER=${SERVER}`, "NTFY_TOPIC=skel-test-topic"]);
});

test("a question goes to the topic, with its options and how to answer", async () => {
  const ran = await run(
    event("task.asked", {
      step: "running",
      running: true,
      question: { text: "Should an empty list throw?", options: ["throw", "return []"], answered: false },
      waitingOnYou: "skel reply 142 <answer>",
    }),
  );
  expect(ran).toEqual({ code: 0, out: "Sent.\n", err: "" });
  expect(sent).toEqual([
    {
      path: "/",
      auth: null,
      body: {
        topic: "skel-test-topic",
        title: "shop #142 asks",
        message:
          "Should an empty list throw?\nOptions: throw, return []\n\nEmpty export crashes\nskel reply 142 <answer>",
        priority: 4,
        tags: ["question"],
      },
    },
  ]);
});

test("a sign-off says why it is asked", async () => {
  await run(
    event("task.approval", {
      phase: "deliver",
      step: "awaiting approval",
      approval: { flagged: false, criticalFiles: ["src/auth/login.ts"] },
      waitingOnYou: "skel approve 142",
    }),
  );
  expect(sent[0]?.body).toMatchObject({
    title: "shop #142 waits for your sign-off",
    message: "Empty export crashes\nCritical files: src/auth/login.ts\nskel approve 142",
    priority: 4,
    tags: ["raised_hand"],
  });
});

test("a held task says why, and what to do", async () => {
  await run(
    event("task.held", {
      hold: "the agent gave up: the test needs a database",
      waitingOnYou: "skel retry 142 once it is fixed",
    }),
  );
  expect(sent[0]?.body).toMatchObject({
    title: "shop #142 is held",
    message:
      "the agent gave up: the test needs a database\n\nEmpty export crashes\nskel retry 142 once it is fixed",
    priority: 4,
    tags: ["warning"],
  });
});

test("a task you paused yourself is told quietly", async () => {
  await run(event("task.held", { hold: "paused by you", paused: true, waitingOnYou: "skel resume 142" }));
  expect(sent[0]?.body).toMatchObject({ title: "shop #142 is paused", priority: 2, tags: ["pause_button"] });
});

test("a delivered task says where its result is", async () => {
  await run(
    event("task.delivered", { phase: "ended", step: "ended", ended: "done", result: "branch skel/142-empty-export" }),
  );
  expect(sent[0]?.body).toMatchObject({
    title: "shop #142 is delivered",
    message: "Empty export crashes\nbranch skel/142-empty-export",
    priority: 3,
    tags: ["white_check_mark"],
  });
});

test("an ended task says how it ended", async () => {
  await run(event("task.ended", { phase: "ended", step: "ended", ended: "killed" }));
  expect(sent[0]?.body).toMatchObject({
    title: "shop #142 ended: killed",
    message: "Empty export crashes",
    priority: 2,
    tags: ["x"],
  });
});

const ADDED = { phase: "triage", step: "ready", intent: null, rigor: null, approve: null };

test("an added task isn't sent unless NTFY_EVENTS names it, since you mostly added it yourself", async () => {
  const ran = await run(event("task.added", ADDED));
  expect(ran).toEqual({ code: 0, out: "Not sent: NTFY_EVENTS leaves out task.added.\n", err: "" });
  expect(sent).toEqual([]);
});

test("an added task is told at the lowest priority, when NTFY_EVENTS names it", async () => {
  const withAdded = configWith([`NTFY_SERVER=${SERVER}`, "NTFY_TOPIC=t", "NTFY_EVENTS=task.added"]);
  await run(event("task.added", ADDED), withAdded);
  expect(sent[0]?.body).toMatchObject({
    title: "shop #142 added",
    message: "Empty export crashes",
    priority: 1,
    tags: ["new"],
  });
});

test("a sample event from skel plugin hook is marked as one", async () => {
  await run(event("task.ended", { phase: "ended", step: "ended", ended: "killed" }, true));
  expect(sent[0]?.body).toMatchObject({ title: "[sample] shop #142 ended: killed" });
});

test("a field a later Skelcrew adds to the view is ignored", async () => {
  const ran = await run(event("task.ended", { ended: "killed", cost: { usd: 1 } }));
  expect(ran.code).toBe(0);
  expect(sent).toHaveLength(1);
});

test("a long message is cut to fit ntfy's limit", async () => {
  await run(event("task.held", { hold: "x".repeat(10_000), waitingOnYou: null }));
  const body = sent[0]?.body;
  const message = typeof body === "object" && body !== null && "message" in body ? String(body.message) : "";
  expect(new TextEncoder().encode(message).length).toBeLessThanOrEqual(4000);
  expect(message.endsWith("…")).toBe(true);
});

test("a token in the config is sent as a bearer token", async () => {
  const withToken = configWith([`NTFY_SERVER=${SERVER}`, "NTFY_TOPIC=t", "NTFY_TOKEN=tk_secret"]);
  await run(event("task.ended", { ended: "killed" }), withToken);
  expect(sent[0]?.auth).toBe("Bearer tk_secret");
});

test("NTFY_EVENTS limits the events that are sent", async () => {
  const onlyAsked = configWith([`NTFY_SERVER=${SERVER}`, "NTFY_TOPIC=t", "NTFY_EVENTS=task.asked, task.approval"]);
  const ran = await run(event("task.ended", { ended: "killed" }), onlyAsked);
  expect(ran).toEqual({ code: 0, out: "Not sent: NTFY_EVENTS leaves out task.ended.\n", err: "" });
  expect(sent).toEqual([]);
});

test("comments, blank lines and quotes in .env are read as you'd expect", async () => {
  const quoted = configWith(["# my phone", "", `NTFY_SERVER="${SERVER}"`, "NTFY_TOPIC='quoted-topic'"]);
  await run(event("task.ended", { ended: "killed" }), quoted);
  expect(sent[0]?.body).toMatchObject({ topic: "quoted-topic" });
});

test("no .env says where to write the topic", async () => {
  const empty = configWith(null);
  const ran = await run(event("task.ended", { ended: "killed" }), empty);
  expect(ran.code).toBe(1);
  expect(ran.err).toBe(`No ntfy topic. Write NTFY_TOPIC=<your topic> to ${join(empty, ".env")}.\n`);
  expect(sent).toEqual([]);
});

test("an unknown key in .env is refused, so a typo isn't ignored", async () => {
  const typo = configWith(["NTFY_TOPIC=t", "NTFY_TOKN=tk_secret"]);
  const ran = await run(event("task.ended", { ended: "killed" }), typo);
  expect(ran.code).toBe(1);
  expect(ran.err).toBe(
    `${join(typo, ".env")} line 2: unknown key NTFY_TOKN. Known keys: NTFY_TOPIC, NTFY_SERVER, NTFY_TOKEN, NTFY_EVENTS.\n`,
  );
});

test("an unknown event name in NTFY_EVENTS is refused", async () => {
  const typo = configWith(["NTFY_TOPIC=t", "NTFY_EVENTS=task.askd"]);
  const ran = await run(event("task.ended", { ended: "killed" }), typo);
  expect(ran.code).toBe(1);
  expect(ran.err).toBe(
    "NTFY_EVENTS names task.askd, which isn't an event. There are: task.added, task.asked, task.approval, task.held, task.delivered, task.ended.\n",
  );
});

test("an event of a later version asks for an update", async () => {
  const ran = await run(`${JSON.stringify({ v: 2, event: "task.held" })}\n`);
  expect(ran.code).toBe(1);
  expect(ran.err).toBe(
    "This plugin reads hook events of version 1, and was given version 2. Run skel plugin update skelcrew.ntfy.\n",
  );
  expect(sent).toEqual([]);
});

test("input that isn't an event is refused, saying what was wrong", async () => {
  const ran = await run("not json\n");
  expect(ran.code).toBe(1);
  expect(ran.err).toStartWith("The input isn't a hook event: ");
});

test("a server that refuses says its status and answer", async () => {
  answer = 403;
  const ran = await run(event("task.ended", { ended: "killed" }));
  expect(ran.code).toBe(1);
  expect(ran.err).toBe(`${SERVER} refused it with 403: {"error":"unauthorized"}\n`);
});

test("a server that never answers is given up on after 20 seconds, within the hook's 30", async () => {
  answer = "hang";
  const started = Date.now();
  const ran = await run(event("task.ended", { ended: "killed" }));
  expect(ran.code).toBe(1);
  expect(ran.err).toBe(`${SERVER} didn't answer in 20 seconds.\n`);
  expect(Date.now() - started).toBeLessThan(25_000);
}, 30_000);
