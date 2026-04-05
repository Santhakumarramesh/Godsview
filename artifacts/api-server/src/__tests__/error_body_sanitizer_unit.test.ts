import { describe, expect, it } from "vitest";
import { sanitizeUpstreamErrorBody } from "../lib/error_body_sanitizer";

describe("sanitizeUpstreamErrorBody", () => {
  it("strips html tags and keeps core text", () => {
    const snippet = sanitizeUpstreamErrorBody("<html><body><h1>401 Authorization Required</h1></body></html>");
    expect(snippet).toContain("401 Authorization Required");
    expect(snippet).not.toContain("<html>");
    expect(snippet).not.toContain("</h1>");
  });

  it("drops script/style content and decodes entities", () => {
    const snippet = sanitizeUpstreamErrorBody(
      "<style>.hidden{display:none}</style><script>alert('x')</script><h1>Auth&nbsp;Failed &amp; Retrying</h1>",
    );
    expect(snippet).toBe("Auth Failed & Retrying");
  });

  it("collapses repeated html error headings", () => {
    const snippet = sanitizeUpstreamErrorBody(
      "<html><h1>401 Authorization Required</h1><p>401 Authorization Required</p><hr><center>nginx</center></html>",
    );
    expect(snippet).toBe("401 Authorization Required nginx");
  });

  it("extracts concise messages from json bodies", () => {
    expect(sanitizeUpstreamErrorBody("{\"message\":\"unauthorized.\"}")).toBe("unauthorized.");
    expect(sanitizeUpstreamErrorBody("{\"error\":{\"detail\":\"token expired\"}}")).toBe("token expired");
  });

  it("returns a stable fallback for empty and markup-only bodies", () => {
    expect(sanitizeUpstreamErrorBody("   ")).toBe("empty response");
    expect(sanitizeUpstreamErrorBody("<html><body></body></html>")).toBe("html response omitted");
  });
});
