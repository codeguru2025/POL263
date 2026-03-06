/**
 * Optional Redis-backed store for express-rate-limit.
 * When REDIS_URL is set, rate limits are shared across app instances (e.g. multi-instance on DigitalOcean).
 * When REDIS_URL is not set, the app uses the default in-memory store (no Redis required).
 *
 * Returns a factory so each limiter gets its own store instance (and thus its own windowMs from init()).
 */

import type { Options, Store, IncrementResponse } from "express-rate-limit";
import { structuredLog } from "./logger";

const REDIS_URL = process.env.REDIS_URL?.trim();
const PREFIX = "rl:";

export type RedisStoreOptions = { prefix?: string };

export type RedisStoreFactory = (limiterPrefix: string) => Store;

/**
 * Create a Redis-backed rate limit store factory, or undefined if REDIS_URL is not set.
 * Use getStore("api"), getStore("auth"), etc. so each limiter has its own prefix and window.
 */
export async function createRedisStore(
  options: RedisStoreOptions = {}
): Promise<RedisStoreFactory | undefined> {
  if (!REDIS_URL) return undefined;

  try {
    const { createClient } = await import("redis");
    const client = createClient({ url: REDIS_URL });
    client.on("error", (err) => structuredLog("warn", "Redis rate-limit store error", { error: (err as Error).message }));
    await client.connect();

    const basePrefix = (options.prefix ?? PREFIX).replace(/:$/, "");

    const getStore = (limiterPrefix: string): Store => {
      const prefix = `${basePrefix}:${limiterPrefix}:`;
      const store: Store = {
        init(opts: Options): void {
          (store as any)._windowMs = opts.windowMs;
        },
        async increment(key: string): Promise<IncrementResponse> {
          const k = prefix + key;
          const windowMs = (store as any)._windowMs ?? 60_000;
          const multi = client.multi();
          multi.incr(k);
          multi.pTTL(k);
          const results = await multi.exec();
          if (!results || results.length < 2) {
            return { totalHits: 1, resetTime: new Date(Date.now() + windowMs) };
          }
          const totalHits = Number(results[0]);
          let ttlMs = Number(results[1]);
          if (ttlMs === -1 || ttlMs === -2) {
            await client.pExpire(k, windowMs);
            ttlMs = windowMs;
          }
          const resetTime = new Date(Date.now() + ttlMs);
          return { totalHits, resetTime };
        },
        async decrement(key: string): Promise<void> {
          const k = prefix + key;
          const v = await client.decr(k);
          if (v !== undefined && v <= 0) await client.del(k);
        },
        async resetKey(key: string): Promise<void> {
          await client.del(prefix + key);
        },
      };
      (store as any)._windowMs = 60_000;
      return store;
    };

    structuredLog("info", "Rate limit store using Redis", { redisUrl: REDIS_URL.replace(/:[^:@]+@/, ":****@") });
    return getStore;
  } catch (err) {
    structuredLog("warn", "Redis rate-limit store unavailable, using in-memory", { error: (err as Error).message });
    return undefined;
  }
}

/** Whether Redis is configured (REDIS_URL set). Used to avoid importing Redis when not needed. */
export function isRedisConfigured(): boolean {
  return !!REDIS_URL;
}
