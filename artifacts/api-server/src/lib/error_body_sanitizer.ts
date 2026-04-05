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
const JSON_MESSAGE_KEYS = ["message", "error", "detail", "description", "reason", "msg"] as const;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|nbsp);|&#39;/gi, (entity) => ENTITY_MAP[entity.toLowerCase()] ?? entity)
    .replace(/&#(\d+);/g, (_match, codePointRaw) => {
      const codePoint = Number.parseInt(codePointRaw, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
    });
}

function extractMessageCandidate(value: unknown, depth = 0): string | null {
  if (depth > 3 || value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractMessageCandidate(item, depth + 1);
      if (extracted) return extracted;
    }
    return null;
  }
  if (typeof value === "object") {
    const asRecord = value as Record<string, unknown>;
    for (const key of JSON_MESSAGE_KEYS) {
      if (key in asRecord) {
        const extracted = extractMessageCandidate(asRecord[key], depth + 1);
        if (extracted) return extracted;
      }
    }
    for (const child of Object.values(asRecord)) {
      const extracted = extractMessageCandidate(child, depth + 1);
      if (extracted) return extracted;
    }
  }
  return null;
}

function extractJsonMessage(raw: string): string | null {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return extractMessageCandidate(parsed);
  } catch {
    return null;
  }
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
  const source = jsonMessage ?? bounded;
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(source) || /<!doctype/i.test(source);
  const stripped = looksHtml ? stripHtmlMarkup(source) : source;
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
