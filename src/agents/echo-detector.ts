/**
 * Echo Detector
 * Prevents agent from responding to its own messages echoed back
 * Uses content hashing + timestamp + source matching
 */

import crypto from "node:crypto";

export interface EchoMessage {
  hash: string;
  timestamp: number;
  destination?: string;
  content: string;
}

export interface EchoDetectionResult {
  isEcho: boolean;
  reason?: string;
  originalTimestamp?: number;
  timeSinceOriginal?: number;
}

export class EchoDetector {
  private sentMessages: Map<string, EchoMessage> = new Map();
  private hashWindow: number;
  private maxMessages: number;

  constructor(options?: { hashWindowMs?: number; maxMessages?: number }) {
    // 5 minute window by default
    this.hashWindow = options?.hashWindowMs ?? 5 * 60 * 1000;
    this.maxMessages = options?.maxMessages ?? 1000;
  }

  /**
   * Record an outgoing message (after we send it)
   */
  recordOutgoing(content: string, destination?: string, metadata?: Record<string, unknown>) {
    const hash = this.hashContent(content);
    const message: EchoMessage = {
      hash,
      timestamp: Date.now(),
      destination,
      content,
    };

    this.sentMessages.set(hash, message);

    if (this.sentMessages.size > this.maxMessages) {
      this.cleanup();
    }
  }

  /**
   * Check if incoming message is an echo of something we sent
   */
  detectEcho(content: string, source?: string): EchoDetectionResult {
    const hash = this.hashContent(content);
    const sent = this.sentMessages.get(hash);

    if (!sent) {
      return { isEcho: false };
    }

    const age = Date.now() - sent.timestamp;

    // Outside time window = not an echo
    if (age > this.hashWindow) {
      return { isEcho: false };
    }

    // If source matches destination, it's an echo
    if (source && sent.destination && source === sent.destination) {
      return {
        isEcho: true,
        reason: "Content hash matches recent outgoing message from same channel",
        originalTimestamp: sent.timestamp,
        timeSinceOriginal: age,
      };
    }

    // If no source/destination mismatch but hash matches, still likely an echo
    if (!source && !sent.destination) {
      return {
        isEcho: true,
        reason: "Content hash matches recent outgoing message",
        originalTimestamp: sent.timestamp,
        timeSinceOriginal: age,
      };
    }

    return { isEcho: false };
  }

  /**
   * Clear an echo from the cache (after handling it)
   */
  clearEcho(content: string) {
    const hash = this.hashContent(content);
    this.sentMessages.delete(hash);
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      cachedMessages: this.sentMessages.size,
      hashWindowMs: this.hashWindow,
    };
  }

  /**
   * Cleanup old entries
   */
  private cleanup() {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [hash, data] of this.sentMessages) {
      if (now - data.timestamp > this.hashWindow) {
        toDelete.push(hash);
      }
    }

    toDelete.forEach((h) => this.sentMessages.delete(h));
  }

  /**
   * Hash content using SHA256
   */
  private hashContent(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }
}

/**
 * Global singleton
 */
let globalDetector: EchoDetector | null = null;

export function getEchoDetector(): EchoDetector {
  if (!globalDetector) {
    globalDetector = new EchoDetector();
  }
  return globalDetector;
}

export function createEchoDetector(options?: {
  hashWindowMs?: number;
  maxMessages?: number;
}): EchoDetector {
  return new EchoDetector(options);
}
