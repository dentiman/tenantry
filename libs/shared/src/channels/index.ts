export type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelCredentials,
  ParseResult,
  RawWebhookRequest,
} from './channel-adapter';
export {
  ChannelAdapterRegistry,
  createChannelAdapterRegistry,
  isChatDevToolsEnabled,
} from './channel-adapter-registry';
export {
  FAKE_SIGNATURE_HEADER,
  FakeChannelAdapter,
  buildFakeWebhookBody,
  signFakeBody,
} from './fake-channel.adapter';
export { normalizeE164, phoneDigits, phoneLookupValues } from './phone';
export { ChannelIngestService, DEFAULT_REOPEN_HOURS, type IngestOutcome } from './channel-ingest.service';
export { ChannelSendError, classifySendFailure, type ClassifiedSendFailure, type OutboundContext } from './channel-send';
export {
  ChannelDeliveryService,
  DELIVERY_MAX_ATTEMPTS,
  RetryableDeliveryError,
  SEND_TIMEOUT_MS,
  UNCONFIRMED_WAIT_MS,
  isFreeformAllowed,
  type DeliveryResult,
} from './channel-delivery.service';
export {
  ChannelStatusService,
  PENDING_STATUS_MAX_ATTEMPTS,
  type FoldResult,
  type MessageRef,
} from './channel-status.service';
export { ChannelPendingSweeper, type SweepResult } from './channel-pending-sweeper.service';
export { replyWindow, type ReplyWindow } from './reply-window';
