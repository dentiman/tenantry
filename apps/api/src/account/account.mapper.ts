import type { AuthSession } from '@saas-skeleton/database';
import type { AuthSessionResponse } from '@saas-skeleton/contracts';

/**
 * Явний мапінг, без спреду. Саме тут проходить межа, за яку не мають права вийти
 * `tokenHash`/`prevTokenHash` (секрети) і `revokedAt`/`revokedReason` (список
 * показує лише живі сесії). Спред `...session` одного дня протягнув би все це
 * в JSON мовчки — тому його тут немає і не буде.
 */
export function toAuthSessionResponse(
  session: AuthSession,
  currentSid: string,
): AuthSessionResponse {
  return {
    id: session.id,
    deviceLabel: session.deviceLabel,
    userAgent: session.userAgent,
    ip: session.ip,
    isCurrent: session.id === currentSid,
    // Назовні момент логіну зветься createdAt: для читача списку це «коли я тут увійшов»
    createdAt: session.issuedAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
  };
}
