// Persistence adapter.
// - If UPSTASH_REDIS_REST_URL/TOKEN are set: Upstash Redis via its REST API (no SDK needed).
// - Otherwise: a JSON file (.data/db.json locally, /tmp on serverless) plus an in-memory cache.
// Writes are serialised through a promise chain so concurrent tool calls don't clobber each other.

import { promises as fs } from "node:fs";
import path from "node:path";
import seedJson from "@/data/seed.json";
import type { DB } from "./types";

const KEY = "kam:db";
const seed = seedJson as unknown as DB;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// Upstash's own names, or the KV_* names the Vercel Marketplace integration sets.
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const useUpstash = Boolean(upstashUrl && upstashToken);

const filePath = process.env.VERCEL
  ? path.join("/tmp", "kam-db.json")
  : path.join(process.cwd(), ".data", "db.json");

let cache: DB | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function redis(command: unknown[]): Promise<unknown> {
  const res = await fetch(upstashUrl!, {
    method: "POST",
    headers: { Authorization: `Bearer ${upstashToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { result: unknown }).result;
}

async function load(): Promise<DB> {
  if (useUpstash) {
    const raw = (await redis(["GET", KEY])) as string | null;
    if (raw) return JSON.parse(raw) as DB;
    const fresh = clone(seed);
    await redis(["SET", KEY, JSON.stringify(fresh)]);
    return fresh;
  }
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(filePath, "utf8")) as DB;
  } catch {
    cache = clone(seed);
  }
  return cache;
}

async function persist(db: DB): Promise<void> {
  if (useUpstash) {
    await redis(["SET", KEY, JSON.stringify(db)]);
    return;
  }
  cache = db;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // Write-then-rename so a reader never sees a half-written file.
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db));
    await fs.rename(tmp, filePath);
  } catch {
    // Read-only filesystem: keep the in-memory copy.
  }
}

/** Read the current state (a deep copy, safe to mutate). */
export async function getDB(): Promise<DB> {
  await chain;
  return clone(await load());
}

/** Atomically read → modify → write. The updater may mutate the db or return a new one. */
export function updateDB<T>(fn: (db: DB) => T | { db: DB; result: T }): Promise<T> {
  const run = chain.then(async () => {
    const db = clone(await load());
    const out = fn(db);
    if (out && typeof out === "object" && "db" in (out as object) && "result" in (out as object)) {
      const { db: next, result } = out as { db: DB; result: T };
      await persist(next);
      return result;
    }
    await persist(db);
    return out as T;
  });
  chain = run.catch(() => undefined);
  return run;
}

export async function resetDB(): Promise<void> {
  const run = chain.then(() => persist(clone(seed)));
  chain = run.catch(() => undefined);
  await run;
}

export const storeMode = useUpstash ? "upstash" : process.env.VERCEL ? "memory" : "file";
