// LLMTELEMET-282 (T-3): live-feed core — the process-wide feed for
// /api/events/stream, created on first use (port of serve.py `hive_feed()`).
import { readLiveArtifact, reportsDir } from "./artifacts";
import { StreamCap } from "./cap";
import { LiveFeed } from "./feed";
import {
  DEFAULT_CONFIG,
  handleEventsRequest,
  type LiveFeedConfig,
} from "./http";

export * from "./artifacts";
export * from "./cap";
export * from "./delta";
export * from "./feed";
export * from "./http";
export * from "./sse";
export * from "./types";

interface Registry {
  feed: LiveFeed | null;
  cap: StreamCap | null;
}

const registry: Registry = { feed: null, cap: null };

/** The process-wide feed, created and started on first use. */
export function getEventsFeed(): LiveFeed {
  if (registry.feed === null) {
    registry.feed = new LiveFeed(() => readLiveArtifact(reportsDir()));
    registry.feed.start();
  }
  return registry.feed;
}

/** Swap the feed (tests inject fixtures); -> the previous one. */
export function setEventsFeed(feed: LiveFeed | null): LiveFeed | null {
  const old = registry.feed;
  registry.feed = feed;
  return old;
}

export function getStreamCap(cfg: LiveFeedConfig = DEFAULT_CONFIG): StreamCap {
  if (registry.cap === null) registry.cap = new StreamCap(cfg.maxStreams);
  return registry.cap;
}

/** Swap the stream cap (tests); -> the previous one. */
export function setStreamCap(cap: StreamCap | null): StreamCap | null {
  const old = registry.cap;
  registry.cap = cap;
  return old;
}

/** What app/api/events/stream calls. */
export function eventsRequest(
  request: Request,
  cfg: LiveFeedConfig = DEFAULT_CONFIG,
): Promise<Response> {
  return handleEventsRequest(request, getEventsFeed(), getStreamCap(cfg), cfg);
}
