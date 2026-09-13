import type { Namespace, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@saas-skeleton/contracts';

/**
 * Перевірена identity сокета. Кладеться middleware-ом у `socket.data`, а не в
 * замикання handler-а: `socket.data` переживає reconnect у межах recovery-сесії
 * і видно в усіх handler-ах без передавання аргументом.
 *
 * Джерело — ТІЛЬКИ verified JWT payload. Клієнт не надсилає ні tenantId, ні room.
 */
export interface RealtimeSocketData {
  userId: string;
  tenantId: string;
  role: string;
  /**
   * AUTH-1: сесія-пристрій, чиїм токеном відкрито зʼєднання. Сокет сидить у room-і
   * цього `sid`, тому «завершити сесію» рве саме його, не чіпаючи інші пристрої.
   * Змінюється на `auth.update.v1`, якщо клієнт приніс токен іншої сесії.
   */
  sid: string;
  /** exp токена в мс — на ньому стоять таймери auth.expiring.v1 і примусового закриття */
  expiresAtMs: number;
}

/** Події server→client, які інші сервіси мають право розсилати самі */
type InterServerEvents = Record<string, never>;

export type TenantNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  RealtimeSocketData
>;

export type TenantSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  RealtimeSocketData
>;
