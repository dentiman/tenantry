/**
 * Lua-скрипти presence-store. Вони тут не «щоб швидше», а щоб бути АТОМАРНИМИ:
 * перехід online↔offline і інкремент ревізії мусять статись однією операцією,
 * інакше дві ноди, що одночасно відпускають останні leases одного юзера, згенерують
 * два offline-делти з тією самою ревізією — і клієнт розсинхронізується.
 *
 * Усі ключі одного тенанта мають спільний hash tag `{tenantId}` → один slot →
 * скрипт коректний і в Redis Cluster. Ключі leases будуються з префікса ВСЕРЕДИНІ
 * скрипта (їхня кількість динамічна) — це той самий slot, але формально
 * недекларований ключ; у Cluster це працює саме завдяки hash tag-у.
 */

/**
 * KEYS: online, deadlines, revision, lease(userId)
 * ARGV: userId, nodeId, expiresAtMs, leaseKeyTtlMs
 * → { changed 0|1, revision }
 */
export const ACQUIRE_LEASE = `
local onlineKey, deadlinesKey, revisionKey, leaseKey = KEYS[1], KEYS[2], KEYS[3], KEYS[4]
local userId, nodeId, expiresAt, ttl = ARGV[1], ARGV[2], tonumber(ARGV[3]), tonumber(ARGV[4])

redis.call('ZADD', leaseKey, expiresAt, nodeId)
-- Страховка від витоку ключа, якщо і нода зникла, і sweeper не добіг
redis.call('PEXPIRE', leaseKey, ttl)

local top = redis.call('ZRANGE', leaseKey, 0, 0, 'REV', 'WITHSCORES')
redis.call('ZADD', deadlinesKey, tonumber(top[2]), userId)

local added = redis.call('SADD', onlineKey, userId)
local revision
if added == 1 then
  revision = redis.call('INCR', revisionKey)
else
  revision = tonumber(redis.call('GET', revisionKey) or '0')
end
return { added, revision }
`;

/**
 * KEYS: online, deadlines, revision, lease(userId)
 * ARGV: userId, nodeId
 * → { changed 0|1, revision }
 *
 * changed=1 ЛИШЕ коли зникла остання lease юзера в тенанті: інша нода (або інша
 * вкладка на цій самій) тримає його online — це і є «дві вкладки = один online user».
 */
export const RELEASE_LEASE = `
local onlineKey, deadlinesKey, revisionKey, leaseKey = KEYS[1], KEYS[2], KEYS[3], KEYS[4]
local userId, nodeId = ARGV[1], ARGV[2]

redis.call('ZREM', leaseKey, nodeId)
if redis.call('ZCARD', leaseKey) > 0 then
  local top = redis.call('ZRANGE', leaseKey, 0, 0, 'REV', 'WITHSCORES')
  redis.call('ZADD', deadlinesKey, tonumber(top[2]), userId)
  return { 0, tonumber(redis.call('GET', revisionKey) or '0') }
end

redis.call('DEL', leaseKey)
redis.call('ZREM', deadlinesKey, userId)
local removed = redis.call('SREM', onlineKey, userId)
local revision
if removed == 1 then
  revision = redis.call('INCR', revisionKey)
else
  revision = tonumber(redis.call('GET', revisionKey) or '0')
end
return { removed, revision }
`;

/**
 * KEYS: online, deadlines, revision
 * ARGV: nodeId, expiresAtMs, leaseKeyPrefix, leaseKeyTtlMs, userId...
 * → плоский { userId, revision, ... } для юзерів, які ПОВЕРНУЛИСЬ в online
 *
 * Нода продовжує leases усіх своїх локальних юзерів одним викликом — не по сокету
 * і не по юзеру: інакше тенант на 500 онлайн-юзерів давав би 500 round-trip-ів
 * кожні 20 секунд. Повернення в online — самолікування: якщо sweeper зняв юзера
 * через лаг, наступний heartbeat поверне його і згенерує коректну delta.
 */
export const RENEW_LEASES = `
local onlineKey, deadlinesKey, revisionKey = KEYS[1], KEYS[2], KEYS[3]
local nodeId, expiresAt = ARGV[1], tonumber(ARGV[2])
local leasePrefix, ttl = ARGV[3], tonumber(ARGV[4])
local restored = {}

for i = 5, #ARGV do
  local userId = ARGV[i]
  local leaseKey = leasePrefix .. userId
  redis.call('ZADD', leaseKey, expiresAt, nodeId)
  redis.call('PEXPIRE', leaseKey, ttl)
  local top = redis.call('ZRANGE', leaseKey, 0, 0, 'REV', 'WITHSCORES')
  redis.call('ZADD', deadlinesKey, tonumber(top[2]), userId)
  if redis.call('SADD', onlineKey, userId) == 1 then
    table.insert(restored, userId)
    table.insert(restored, redis.call('INCR', revisionKey))
  end
end
return restored
`;

/**
 * KEYS: online, deadlines, revision
 * ARGV: nowMs, leaseKeyPrefix, limit
 * → плоский { userId, revision, ... } для юзерів, що стали offline
 *
 * Ідемпотентний за побудовою: перехід дає `SREM`, який повертає 1 РІВНО один раз,
 * скільки б нод не мели одночасно. Саме тому лідер не потрібен.
 */
export const SWEEP_EXPIRED = `
local onlineKey, deadlinesKey, revisionKey = KEYS[1], KEYS[2], KEYS[3]
local now, leasePrefix, limit = tonumber(ARGV[1]), ARGV[2], tonumber(ARGV[3])
local expired = redis.call('ZRANGEBYSCORE', deadlinesKey, '-inf', now, 'LIMIT', 0, limit)
local offline = {}

for i, userId in ipairs(expired) do
  local leaseKey = leasePrefix .. userId
  redis.call('ZREMRANGEBYSCORE', leaseKey, '-inf', now)
  if redis.call('ZCARD', leaseKey) > 0 then
    local top = redis.call('ZRANGE', leaseKey, 0, 0, 'REV', 'WITHSCORES')
    redis.call('ZADD', deadlinesKey, tonumber(top[2]), userId)
  else
    redis.call('DEL', leaseKey)
    redis.call('ZREM', deadlinesKey, userId)
    if redis.call('SREM', onlineKey, userId) == 1 then
      table.insert(offline, userId)
      table.insert(offline, redis.call('INCR', revisionKey))
    end
  end
end
return offline
`;

/**
 * KEYS: online, revision → { userIds[], revision }
 * Одним скриптом, а не двома командами: набір і ревізія мусять бути з одного моменту,
 * інакше клієнт застосує delta, яка вже врахована в snapshot-і (або навпаки).
 */
export const READ_SNAPSHOT = `
return { redis.call('SMEMBERS', KEYS[1]), redis.call('GET', KEYS[2]) or '0' }
`;
