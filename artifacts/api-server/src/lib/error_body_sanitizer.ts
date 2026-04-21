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

export function sanitizeUpstreamErrorBody(
  body: unknown,
  options?: { maxLen?: number; maxInputLen?: number },
): string {
  const maxLen = options?.maxLen ?? 220;
  const maxInputLen = options?.maxInputLen ?? 8000;
  const raw = String(body ?? "").replace(CONTROL_CHARS_RE, " ").trim();
  if (!raw) return "empty response";

  const bounded = raw.length > maxInputLen ? raw.slice(0, maxInputLen) : raw;

  // Attempt JSON extraction: pull message/detail/error string from JSON bodies
  if (bounded.startsWith("{")) {
    try {
      const parsed = JSON.parse(bounded);
      const msg =
        (typeof parsed === "object" && parsed !== null)
          ? (typeof parsed.message === "string" ? parsed.message :
             typeof parsed.detail === "string" ? parsed.detail :
             typeof parsed.error === "string" ? parsed.error :
             typeof parsed.error?.detail === "string" ? parsed.error.detail :
             typeof parsed.error?.message === "string" ? parsed.error.message :
             null)
          : null;
      if (msg) {
        return msg.length > maxLen ? `${msg.slice(0, maxLen)}...` : msg;
      }
    } catch {
      // Not valid JSON — fall through to HTML/text handling
    }
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
