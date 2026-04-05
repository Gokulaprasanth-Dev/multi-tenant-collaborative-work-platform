import { queryReplica, queryPrimary } from '../../shared/database/pool';
import { redisClient, redisPubSubClient } from '../../shared/redis/clients';
import { logger } from '../../shared/observability/logger';

const L1_TTL_MS = 5_000; // 5 seconds in-process cache TTL
const L2_REDIS_KEY = 'featureflags:cache';
const INVALIDATION_CHANNEL = 'featureflag:invalidate';
const SAFETY_NET_INTERVAL_MS = 60_000; // 1 minute

interface FeatureFlagRow extends Record<string, unknown> {
  id: string;
  key: string;
  description: string | null;
  is_globally_enabled: boolean;
  rollout_percentage: number;
  enabled_org_ids: string[];
  disabled_org_ids: string[];
  created_at: Date;
  updated_at: Date;
}

// L1 in-process cache
const l1Cache = new Map<string, { value: boolean; expiresAt: number }>();

let safetyNetInterval: ReturnType<typeof setInterval> | null = null;

async function loadFlagsFromDb(): Promise<Map<string, FeatureFlagRow>> {
  const result = await queryReplica<FeatureFlagRow>(
    `SELECT id, key, description, is_globally_enabled, rollout_percentage, enabled_org_ids, disabled_org_ids FROM feature_flags WHERE TRUE`,
    []
  );
  const map = new Map<string, FeatureFlagRow>();
  for (const row of result.rows) {
    map.set(row.key, row);
  }
  return map;
}

function resolveFlag(flag: { is_globally_enabled: boolean; enabled_org_ids: string[]; disabled_org_ids: string[] }, orgId: string): boolean {
  if (flag.disabled_org_ids?.includes(orgId)) return false;
  if (flag.enabled_org_ids?.includes(orgId)) return true;
  return flag.is_globally_enabled;
}

async function loadFlagsIntoRedis(): Promise<void> {
  const flags = await loadFlagsFromDb();
  if (flags.size === 0) return;

  const pipeline = redisClient.pipeline();
  for (const [key, flag] of flags.entries()) {
    pipeline.hset(L2_REDIS_KEY, key, JSON.stringify({
      is_globally_enabled: flag.is_globally_enabled,
      enabled_org_ids: flag.enabled_org_ids,
      disabled_org_ids: flag.disabled_org_ids,
    }));
  }
  await pipeline.exec();
  logger.debug({ count: flags.size }, 'featureFlag: loaded into Redis cache');
}

function l1CacheKey(orgId: string, flagKey: string): string {
  return `${orgId}:${flagKey}`;
}

/**
 * `isEnabled`: L1 in-process (5s TTL) → L2 Redis → DB
 * Fails closed (returns false) for unknown flags.
 */
export async function isEnabled(orgId: string, flagKey: string): Promise<boolean> {
  const cacheKey = l1CacheKey(orgId, flagKey);

  // L1 check
  const l1Entry = l1Cache.get(cacheKey);
  if (l1Entry && l1Entry.expiresAt > Date.now()) {
    return l1Entry.value;
  }

  // L2 Redis check
  try {
    const redisVal = await redisClient.hget(L2_REDIS_KEY, flagKey);
    if (redisVal) {
      const parsed = JSON.parse(redisVal) as { is_globally_enabled: boolean; enabled_org_ids: string[]; disabled_org_ids: string[] };
      const result = resolveFlag(parsed, orgId);
      l1Cache.set(cacheKey, { value: result, expiresAt: Date.now() + L1_TTL_MS });
      return result;
    }
  } catch (err) {
    logger.warn({ err, flagKey }, 'featureFlag: Redis read failed, falling through to DB');
  }

  // DB fallback
  try {
    const dbResult = await queryReplica<FeatureFlagRow>(
      `SELECT is_globally_enabled, enabled_org_ids, disabled_org_ids FROM feature_flags WHERE key = $1 LIMIT 1`,
      [flagKey]
    );

    if (dbResult.rows.length === 0) {
      // Unknown flag — fail closed
      l1Cache.set(cacheKey, { value: false, expiresAt: Date.now() + L1_TTL_MS });
      return false;
    }

    const flag = dbResult.rows[0]!;
    const result = resolveFlag(flag, orgId);

    // Populate L1 and L2
    l1Cache.set(cacheKey, { value: result, expiresAt: Date.now() + L1_TTL_MS });
    await redisClient.hset(L2_REDIS_KEY, flagKey, JSON.stringify({
      is_globally_enabled: flag.is_globally_enabled,
      enabled_org_ids: flag.enabled_org_ids,
      disabled_org_ids: flag.disabled_org_ids,
    }));

    return result;
  } catch (err) {
    logger.error({ err, flagKey }, 'featureFlag: DB read failed, failing closed');
    return false;
  }
}

/**
 * Invalidate L1 and L2 caches for a given flag key.
 * Called by platform admin API after any flag mutation.
 */
export async function invalidateFlag(flagKey: string): Promise<void> {
  // Clear L1 entries for this flag (all org combinations)
  for (const key of l1Cache.keys()) {
    if (key.endsWith(`:${flagKey}`)) {
      l1Cache.delete(key);
    }
  }

  // Clear L2 Redis entry
  await redisClient.hdel(L2_REDIS_KEY, flagKey);

  // Publish invalidation event to all instances
  await redisClient.publish(INVALIDATION_CHANNEL, JSON.stringify({ flagKey }));
}

/**
 * Subscribe to invalidation events from other instances.
 */
export function startInvalidationListener(): void {
  redisPubSubClient.subscribe(INVALIDATION_CHANNEL, (err) => {
    if (err) logger.error({ err }, 'featureFlag: failed to subscribe to invalidation channel');
    else logger.info('featureFlag: subscribed to featureflag:invalidate');
  });

  redisPubSubClient.on('message', (_channel: string, message: string) => {
    try {
      const { flagKey } = JSON.parse(message) as { flagKey: string };
      for (const key of l1Cache.keys()) {
        if (key.endsWith(`:${flagKey}`)) {
          l1Cache.delete(key);
        }
      }
    } catch {
      // ignore malformed messages
    }
  });

  // Safety net: reload all flags every 60s
  if (!safetyNetInterval) {
    safetyNetInterval = setInterval(() => {
      loadFlagsIntoRedis().catch(err => {
        logger.warn({ err }, 'featureFlag: safety net reload failed');
      });
    }, SAFETY_NET_INTERVAL_MS);
  }
}

// ── Admin CRUD (used by platform admin routes) ────────────────────────────

export async function createFlag(data: {
  key: string;
  is_globally_enabled?: boolean;
  description?: string;
  enabled_org_ids?: string[];
  disabled_org_ids?: string[];
}): Promise<FeatureFlagRow> {
  const result = await queryPrimary<FeatureFlagRow>(
    `INSERT INTO feature_flags (key, description, is_globally_enabled, enabled_org_ids, disabled_org_ids)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      data.key,
      data.description ?? null,
      data.is_globally_enabled ?? false,
      data.enabled_org_ids ?? [],
      data.disabled_org_ids ?? [],
    ]
  );
  await invalidateFlag(data.key);
  return result.rows[0]!;
}

export async function updateFlag(
  id: string,
  data: Partial<{ is_globally_enabled: boolean; enabled_org_ids: string[]; disabled_org_ids: string[]; description: string }>
): Promise<FeatureFlagRow | null> {
  const result = await queryPrimary<FeatureFlagRow>(
    `UPDATE feature_flags
     SET is_globally_enabled = COALESCE($2, is_globally_enabled),
         enabled_org_ids = COALESCE($3, enabled_org_ids),
         disabled_org_ids = COALESCE($4, disabled_org_ids),
         description = COALESCE($5, description),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, data.is_globally_enabled ?? null, data.enabled_org_ids ?? null, data.disabled_org_ids ?? null, data.description ?? null]
  );
  const flag = result.rows[0] ?? null;
  if (flag) await invalidateFlag(flag.key as string);
  return flag;
}

export async function deleteFlag(id: string): Promise<void> {
  const result = await queryPrimary<FeatureFlagRow>(
    `DELETE FROM feature_flags WHERE id = $1 RETURNING key`,
    [id]
  );
  const key = result.rows[0]?.key as string | undefined;
  if (key) await invalidateFlag(key);
}

export async function listFlags(): Promise<FeatureFlagRow[]> {
  const result = await queryReplica<FeatureFlagRow>(
    `SELECT * FROM feature_flags WHERE TRUE ORDER BY key`,
    []
  );
  return result.rows;
}
