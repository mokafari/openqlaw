import type { ReplyPayload } from "../../auto-reply/types.js";
import type { RuntimeEnv } from "../../runtime.js";
import type { createIMessageRpcClient } from "../client.js";
import { getEchoDetector } from "../../agents/echo-detector.js";
import { chunkTextWithMode, resolveChunkMode } from "../../auto-reply/chunk.js";
import { loadConfig } from "../../config/config.js";
import { resolveMarkdownTableMode } from "../../config/markdown-tables.js";
import { convertMarkdownTables } from "../../markdown/tables.js";
import { sendMessageIMessage } from "../send.js";

type SentMessageCache = {
  remember: (scope: string, text: string) => void;
};

export async function deliverReplies(params: {
  replies: ReplyPayload[];
  target: string;
  client: Awaited<ReturnType<typeof createIMessageRpcClient>>;
  accountId?: string;
  runtime: RuntimeEnv;
  maxBytes: number;
  textLimit: number;
  sentMessageCache?: SentMessageCache;
}) {
  const { replies, target, client, runtime, maxBytes, textLimit, accountId, sentMessageCache } =
    params;
  const scope = `${accountId ?? ""}:${target}`;
  const cfg = loadConfig();
  const tableMode = resolveMarkdownTableMode({
    cfg,
    channel: "imessage",
    accountId,
  });
  const chunkMode = resolveChunkMode(cfg, "imessage", accountId);
  for (const payload of replies) {
    const mediaList = payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
    const rawText = payload.text ?? "";
    const text = convertMarkdownTables(rawText, tableMode);
    if (!text && mediaList.length === 0) {
      continue;
    }
    const echoDetector = getEchoDetector();
    if (mediaList.length === 0) {
      sentMessageCache?.remember(scope, text);
      for (const chunk of chunkTextWithMode(text, textLimit, chunkMode)) {
        await sendMessageIMessage(target, chunk, {
          maxBytes,
          client,
          accountId,
        });
        sentMessageCache?.remember(scope, chunk);
        // Record for global echo detection (catches Messages.app duplicates)
        echoDetector.recordOutgoing(chunk, target);
      }
    } else {
      let first = true;
      for (const url of mediaList) {
        const caption = first ? text : "";
        first = false;
        await sendMessageIMessage(target, caption, {
          mediaUrl: url,
          maxBytes,
          client,
          accountId,
        });
        if (caption) {
          sentMessageCache?.remember(scope, caption);
          echoDetector.recordOutgoing(caption, target);
        }
        // Record media placeholder for audio/image echoes
        const ext = url.split(".").pop()?.toLowerCase() ?? "";
        const isAudio = ["mp3", "m4a", "wav", "ogg", "aac", "caf"].includes(ext);
        const isImage = ["jpg", "jpeg", "png", "gif", "webp", "heic"].includes(ext);
        const isVideo = ["mp4", "mov", "avi", "mkv"].includes(ext);
        const kind = isAudio ? "audio" : isImage ? "image" : isVideo ? "video" : "attachment";
        echoDetector.recordOutgoing(`<media:${kind}>`, target);
      }
    }
    runtime.log?.(`imessage: delivered reply to ${target}`);
  }
}
