const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const HTML_TAG_RE = /<[^>]*>/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const SCRIPT_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const DOCTYPE_RE = /<!doctype[^>]*>/gi;

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|nbsp);|&#39;/gi, (entity) => ENTITY_MAP[entity.toLowerCase()] ?? entity)
    .replace(/&#(\d+);/g, (_match, codePointRaw) => {
      const codePoint = Number.parseInt(codePointRaw, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
    });
}

function stripHtmlMarkup(html: string): string {
  return html
    .replace(SCRIPT_STYLE_RE, " ")
    .replace(HTML_COMMENT_RE, " ")
    .replace(DOCTYPE_RE, " ")
    .replace(HTML_TAG_RE, " ");
}

function collapseRepeatedPrefix(text: string): string {
  const tokens = text.split(" ").filter(Boolean);
  const maxPrefixLen = Math.floor(tokens.length / 2);
  for (let prefixLen = maxPrefixLen; prefixLen >= 2; prefixLen -= 1) {
    const a = tokens.slice(0, prefixLen).join(" ");
    const b = tokens.slice(prefixLen, prefixLen * 2).join(" ");
    if (a && a === b) {
      return [...tokens.slice(0, prefixLen), ...tokens.slice(prefixLen * 2)].join(" ").trim();
    }
  }
  return text;
}

const JSON_MESSAGE_KEYS = [
  "message",
  "detail",
  "error_description",
  "errorDescription",
  "description",
  "reason",
  "msg",
  "title",
] as const;

function extractJsonMessage(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const seen = new Set<unknown>();
  const queue: unknown[] = [parsed];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node == null) continue;
    if (typeof node === "string") {
      const text = node.trim();
      if (text) return text;
      continue;
    }
    if (typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const child of node) queue.push(child);
      continue;
    }

    const obj = node as Record<string, unknown>;
    for (const key of JSON_MESSAGE_KEYS) {
      if (key in obj) {
        const val = obj[key];
        if (typeof val === "string" && val.trim()) {
          return val.trim();
        }
        if (val && typeof val === "object") {
          queue.push(val);
        }
      }
    }
    // Walk into `error`-like containers even if they don't hit known keys directly.
    for (const containerKey of ["error", "errors", "data"]) {
      if (containerKey in obj) {
        queue.push(obj[containerKey]);
      }
    }
  }
  return null;
}

export function sanitizeUpstreamErrorBody(
  body: unknown,
  options?: { maxLen?: number; maxInputLen?: number },
): string {
  const maxLen = options?.maxLen ?? 220;
  const maxInputLen = options?.maxInputLen ?? 8000;
  const raw = String(body ?? "").replace(CONTROL_CHARS_RE, " ").trim();
  if (!raw) return "empty response";

  const bounded = raw.length > maxInputLen ? raw.slice(0, maxInputLen) : raw;

  const jsonMessage = extractJsonMessage(bounded);
  if (jsonMessage) {
    const normalizedJson = jsonMessage.replace(/\s+/g, " ").trim();
    if (normalizedJson.length > maxLen) {
      return `${normalizedJson.slice(0, maxLen)}...`;
    }
    return normalizedJson;
  }

  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(bounded) || /<!doctype/i.test(bounded);
  const stripped = looksHtml ? stripHtmlMarkup(bounded) : bounded;
  const normalized = collapseRepeatedPrefix(
    decodeHtmlEntities(stripped).replace(/\s+/g, " ").trim(),
  );

  if (!normalized) {
    return looksHtml ? "html response omitted" : "empty response";
  }
  if (normalized.length > maxLen) {
    return `${normalized.slice(0, maxLen)}...`;
  }
  return normalized;
}
