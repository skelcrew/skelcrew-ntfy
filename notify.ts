// A Skelcrew hook that sends a push notification through ntfy
// (https://ntfy.sh) when something happens to a task, such as an agent
// asking you a question. Skelcrew runs it once per event, with the event as
// one line of JSON on its input. Its settings are in `.env` in the folder
// SKELCREW_PLUGIN_CONFIG names; the README lists them.
//
// It has no dependencies, so installing it builds nothing.

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

const EVENTS = ["task.added", "task.asked", "task.approval", "task.held", "task.delivered", "task.ended"];
// Sent when NTFY_EVENTS isn't set: every event but an added task, since you
// mostly added it yourself.
const DEFAULT_EVENTS = EVENTS.filter((name) => name !== "task.added");
const KEYS = ["NTFY_TOPIC", "NTFY_SERVER", "NTFY_TOKEN", "NTFY_EVENTS"];
// ntfy refuses a message over 4,096 bytes, so the text is cut to a little under.
const MESSAGE_BYTES = 4000;
// Skelcrew kills a hook after 30 seconds. Giving up at 20 leaves time to say why.
const TIMEOUT_MS = 20_000;

type Settings = { topic: string; server: string; token: string | null; events: string[] };

// The parts of a task's view this hook uses. The view has more fields, and a
// later Skelcrew may add some, which this hook ignores.
type Task = {
  id: number;
  title: string;
  question: { text: string; options: string[] } | null;
  waitingOnYou: string | null;
  hold: string | null;
  ended: string | null;
  result: string | null;
  approval: { flagged: boolean; criticalFiles: string[] } | null;
  paused: boolean;
};

type HookEvent = { event: string; repo: string; sample: boolean; task: Task };

// What ntfy is sent: https://docs.ntfy.sh/publish/#publish-as-json
type Push = { title: string; message: string; priority: number; tags: string[] };

class Refused extends Error {}

async function main(): Promise<void> {
  const event = readEvent(readFileSync(0, "utf8"));
  const settings = readSettings(process.env.SKELCREW_PLUGIN_CONFIG ?? "");
  if (!settings.events.includes(event.event)) {
    console.log(`Not sent: NTFY_EVENTS leaves out ${event.event}.`);
    return;
  }
  await send(settings, pushFor(event));
}

// The push for an event: what happened in the title, and in the message the
// detail and what you can do about it.
function pushFor({ event, repo, sample, task }: HookEvent): Push {
  const lines = (...parts: (string | null)[]) => parts.filter((part) => part !== null).join("\n");
  const titled = (what: string) => `${sample ? "[sample] " : ""}${basename(repo)} #${task.id} ${what}`;
  switch (event) {
    case "task.asked": {
      const question = task.question;
      const options = question !== null && question.options.length > 0 ? `Options: ${question.options.join(", ")}` : null;
      return {
        title: titled("asks"),
        message: lines(question?.text ?? null, options, "", task.title, task.waitingOnYou),
        priority: 4,
        tags: ["question"],
      };
    }
    case "task.approval": {
      const files = task.approval?.criticalFiles ?? [];
      return {
        title: titled("waits for your sign-off"),
        message: lines(
          task.title,
          task.approval?.flagged === true ? "Flagged for your sign-off." : null,
          files.length > 0 ? `Critical files: ${files.join(", ")}` : null,
          task.waitingOnYou,
        ),
        priority: 4,
        tags: ["raised_hand"],
      };
    }
    case "task.held":
      // A pause is something you did, so it needs no alarm.
      if (task.paused) {
        return { title: titled("is paused"), message: lines(task.title, task.waitingOnYou), priority: 2, tags: ["pause_button"] };
      }
      return {
        title: titled("is held"),
        message: lines(task.hold, "", task.title, task.waitingOnYou),
        priority: 4,
        tags: ["warning"],
      };
    case "task.delivered":
      return { title: titled("is delivered"), message: lines(task.title, task.result), priority: 3, tags: ["white_check_mark"] };
    case "task.ended":
      return { title: titled(`ended: ${task.ended ?? "unknown"}`), message: task.title, priority: 2, tags: ["x"] };
    default:
      return { title: titled("added"), message: task.title, priority: 1, tags: ["new"] };
  }
}

async function send(settings: Settings, push: Push): Promise<void> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (settings.token !== null) headers.authorization = `Bearer ${settings.token}`;
  let response: Response;
  try {
    response = await fetch(`${settings.server}/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ topic: settings.topic, ...push, message: cut(push.message) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Refused(`${settings.server} didn't answer in ${TIMEOUT_MS / 1000} seconds.`);
    }
    throw new Refused(`Couldn't reach ${settings.server}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const answer = (await response.text()).trim().slice(0, 500);
    throw new Refused(`${settings.server} refused it with ${response.status}: ${answer}`);
  }
  console.log("Sent.");
}

// The text cut to fit ntfy's limit, with "…" to show it was.
function cut(text: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= MESSAGE_BYTES) return text;
  let kept = text.slice(0, MESSAGE_BYTES);
  while (encoder.encode(`${kept}…`).length > MESSAGE_BYTES) kept = kept.slice(0, -1);
  return `${kept}…`;
}

// The event from the hook's input. Only version 1 is read: a later version
// may have changed a field this hook relies on.
function readEvent(input: string): HookEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch (error) {
    throw new Refused(`The input isn't a hook event: ${error instanceof Error ? error.message : String(error)}`);
  }
  const event = record(raw);
  if (event === null) throw new Refused("The input isn't a hook event: it isn't a JSON object.");
  if (event.v !== 1) {
    throw new Refused(
      `This plugin reads hook events of version 1, and was given version ${String(event.v)}. Run skel plugin update skelcrew.ntfy.`,
    );
  }
  const task = record(event.task);
  const name = event.event;
  if (task === null || typeof name !== "string" || typeof event.repo !== "string") {
    throw new Refused("The input isn't a hook event: it has no event, repo or task.");
  }
  const question = record(task.question);
  const approval = record(task.approval);
  return {
    event: name,
    repo: event.repo,
    sample: event.sample === true,
    task: {
      id: typeof task.id === "number" ? task.id : 0,
      title: text(task.title) ?? "",
      question:
        question === null ? null : { text: text(question.text) ?? "", options: texts(question.options) },
      waitingOnYou: text(task.waitingOnYou),
      hold: text(task.hold),
      ended: text(task.ended),
      result: text(task.result),
      approval:
        approval === null ? null : { flagged: approval.flagged === true, criticalFiles: texts(approval.criticalFiles) },
      paused: task.paused === true,
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

// The settings from `.env`: one KEY=value a line, with # for a comment, and
// the value in quotes if you like. An unknown key is refused, so a typo such
// as NTFY_TOKN never leaves the token out without a word.
function readSettings(folder: string): Settings {
  const path = join(folder, ".env");
  let content = "";
  try {
    content = readFileSync(path, "utf8");
  } catch {
    // No file is the same as no topic, refused below.
  }
  const values = new Map<string, string>();
  content.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const equals = trimmed.indexOf("=");
    const key = (equals === -1 ? trimmed : trimmed.slice(0, equals)).trim();
    if (!KEYS.includes(key)) {
      throw new Refused(`${path} line ${index + 1}: unknown key ${key}. Known keys: ${KEYS.join(", ")}.`);
    }
    values.set(key, unquote(equals === -1 ? "" : trimmed.slice(equals + 1).trim()));
  });
  const topic = values.get("NTFY_TOPIC") ?? "";
  if (topic === "") throw new Refused(`No ntfy topic. Write NTFY_TOPIC=<your topic> to ${path}.`);
  const events = (values.get("NTFY_EVENTS") ?? DEFAULT_EVENTS.join(","))
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  for (const name of events) {
    if (!EVENTS.includes(name)) {
      throw new Refused(`NTFY_EVENTS names ${name}, which isn't an event. There are: ${EVENTS.join(", ")}.`);
    }
  }
  return {
    topic,
    server: (values.get("NTFY_SERVER") || "https://ntfy.sh").replace(/\/+$/, ""),
    token: values.get("NTFY_TOKEN") || null,
    events,
  };
}

function unquote(value: string): string {
  const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
  return quoted ? value.slice(1, -1) : value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Refused ? error.message : String(error));
  process.exit(1);
});
