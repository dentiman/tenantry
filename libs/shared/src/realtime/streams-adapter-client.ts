import type { Redis, RedisOptions } from 'ioredis';

/**
 * Клієнт для `createAdapter` з `@socket.io/redis-streams-adapter`: той самий інстанс, але
 * `duplicate()` віддає клієнти, команди яких ЧЕКАЮТЬ на брокер (`maxRetriesPerRequest: null`).
 *
 * Адаптер дублює переданий клієнт сам — для блокуючого XREAD і для pub/sub-підписки — і кличе
 * `subClient.subscribe(channels)`, не обробивши promise. Дублікат успадковує наш
 * `maxRetriesPerRequest: 3`, тож якщо Valkey недоступний на старті (рестарт брокера в тому ж
 * `stack deploy`, DNS ще не знає `valkey`), SUBSCRIBE відмовляє, а unhandled rejection валить
 * процес — swarm відкочує api/worker. Навіть із `.catch` вузол лишився б без підписки назавжди:
 * ioredis перепідписує після реконекту лише канали, на які встигла пройти підписка.
 *
 * Сам переданий клієнт не змінюється: presence і XADD/PUBLISH адаптера лишаються fast-fail.
 */
export function streamsAdapterClient(client: Redis): Redis {
  const duplicate = (override?: Partial<RedisOptions>): Redis =>
    client.duplicate({ ...override, maxRetriesPerRequest: null });

  return new Proxy(client, {
    get(target, property, receiver): unknown {
      if (property === 'duplicate') {
        return duplicate;
      }
      const value: unknown = Reflect.get(target, property, receiver);
      // Методи ioredis пишуть стан у `this` — він мусить бути справжнім клієнтом, не проксі
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
