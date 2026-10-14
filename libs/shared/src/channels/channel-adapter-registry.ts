import { MetaCloudAdapter } from './meta-cloud/meta-cloud.adapter';
import type { ChannelProvider } from '@saas-skeleton/contracts';
import type { ChannelAdapter } from './channel-adapter';
import { FakeChannelAdapter } from './fake-channel.adapter';

/**
 * Реєстр `provider → adapter` (як `PaymentProvider` у docs/event-driven-architecture.md §3.9).
 * Невідомий провайдер — `undefined`, а не виняток: публічний вебхук мусить відповісти так само
 * на неіснуючий провайдер, як і на неіснуючий ключ.
 */
export class ChannelAdapterRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();

  register(adapter: ChannelAdapter): this {
    this.adapters.set(adapter.provider, adapter);
    return this;
  }

  get(provider: string): ChannelAdapter | undefined {
    return this.adapters.get(provider);
  }

  has(provider: string): boolean {
    return this.adapters.has(provider);
  }

  providers(): ChannelProvider[] {
    return [...this.adapters.keys()] as ChannelProvider[];
  }
}

/** Інструменти розробки (fake-провайдер, симулятор) вмикає лише ця змінна */
export function isChatDevToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.CHAT_DEV_TOOLS?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * `fake` реєструється тільки з `CHAT_DEV_TOOLS`; `meta_cloud` — завжди: йому не потрібне ні середовище, ні
 * секрет (облікові дані — на рівні акаунта тенанта, CHAT-3a).
 */
export function createChannelAdapterRegistry(
  env: NodeJS.ProcessEnv = process.env,
): ChannelAdapterRegistry {
  const registry = new ChannelAdapterRegistry().register(new MetaCloudAdapter());
  if (isChatDevToolsEnabled(env)) registry.register(new FakeChannelAdapter());
  return registry;
}
