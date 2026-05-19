/**
 * Web Extension — web_search + web_fetch for pi
 *
 * web_search: DuckDuckGo lite scraping, returns up to 10 results.
 * web_fetch:  Fetch a URL, extract main content via Readability, return as raw text.
 *             Also supports markdown, plain text, JSON, and XML content types.
 *
 * Zero API costs. Uses DuckDuckGo's free HTML interface.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { isIP } from "node:net";

// ── Types ───────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ── HTML helpers ─────────────────────────────────

/**
 * Convert <a href="...">text</a> to "text [url]" and <img> to "[Image: ...]"
 * before HTML tags are stripped, so link destinations survive.
 */
function preserveLinksAndImages(html: string): string {
  // <a href="url">...</a> → "... [url]"
  html = html.replace(
    /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (_: string, href: string, inner: string) => {
      if (href.startsWith("#") || href.startsWith("javascript:")) {
        return stripHtml(inner);
      }
      const text = stripHtml(inner).trim();
      if (!text) return "";
      return `${text} [${href}]`;
    },
  );

  // <img alt="..." src="..."> → "[Image: alt (src)]"
  html = html.replace(
    /<img\b[^>]*\balt="([^"]*)"[^>]*\bsrc="([^"]*)"[^>]*\/?>/gi,
    (_: string, alt: string, src: string) => `[Image: ${alt || src}]`,
  );
  // <img src="..."> (no alt) → "[Image: src]"
  html = html.replace(
    /<img\b[^>]*\bsrc="([^"]*)"[^>]*\/?>/gi,
    (_: string, src: string) => `[Image: ${src}]`,
  );

  return html;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, "")
    // Common entities
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&mdash;/gi, "\u2014")
    .replace(/&ndash;/gi, "\u2013")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&ldquo;/gi, '"')
    .replace(/&rdquo;/gi, '"')
    .replace(/&hellip;/gi, "\u2026")
    .replace(/&#x2F;/gi, "/")
    // Catch remaining entities
    .replace(/&[a-z]+;/gi, "")
    .replace(/&#\d+;/g, "")
    // Normalize whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/^\s+|\s+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Non-HTML content handlers ───────────────────

/** Try to extract a title from the first markdown heading. */
function titleFromMarkdown(text: string): string {
  const match = text.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || "";
}

/** Pretty-print JSON as markdown headings + key-value pairs. */
function jsonToMarkdown(text: string): string {
  try {
    const value = JSON.parse(text);
    return renderJsonValue(value, 0);
  } catch {
    return text;
  }
}

function renderJsonValue(value: unknown, depth: number): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return String(value);

  const lines: string[] = [];

  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      if (typeof item === "object" && item !== null) {
        const title = (item as Record<string, unknown>).title
          ?? (item as Record<string, unknown>).name
          ?? (item as Record<string, unknown>).id
          ?? `Item ${i + 1}`;
        lines.push(`${"#".repeat(Math.min(depth + 2, 6))} ${title}`);
        lines.push(renderJsonValue(item, depth + 1));
      } else {
        lines.push(`- ${renderJsonValue(item, depth + 1)}`);
      }
    }
  } else {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (typeof val === "object" && val !== null) {
        lines.push(`${"#".repeat(Math.min(depth + 2, 6))} ${humanizeKey(key)}`);
        lines.push(renderJsonValue(val, depth + 1));
      } else {
        lines.push(`- **${humanizeKey(key)}:** ${val === null ? "null" : String(val)}`);
      }
    }
  }

  return lines.join("\n");
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/** Strip XML tags, preserve text structure. */
function xmlToMarkdown(xml: string): string {
  let title = "";
  const titleMatch = xml.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();

  let text = xml.replace(/<\?xml[^>]*\?>\s*/gi, "");
  text = text.replace(/<!DOCTYPE[^>]*>\s*/gi, "");
  text = text.replace(/<\/(p|div|section|article|li|h\d|tr|blockquote|pre)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  let prev = "";
  while (prev !== text) {
    prev = text;
    text = text.replace(/<[a-zA-Z\/!?][^>]*>/g, "");
  }
  text = text.replace(/</g, "");

  text = text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, (m) => String.fromCodePoint(Number.parseInt(m.slice(2, -1))))
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) return xml;

  const lines: string[] = [];
  if (title) lines.push(`# ${title}\n`);
  lines.push(text);
  return lines.join("\n\n");
}

// ── DuckDuckGo parsing ──────────────────────────

function cleanDdgUrl(url: string): string {
  // DDG wraps results in redirect URLs. Extract the real target.
  if (url.startsWith("//duckduckgo.com/l/?uddg=")) {
    try {
      const qs = url.split("?")[1];
      const params = new URLSearchParams(qs);
      const target = params.get("uddg");
      if (target) return decodeURIComponent(target);
    } catch {
      /* fall through */
    }
  }
  // Fix protocol-relative URLs
  if (url.startsWith("//")) url = "https:" + url;
  return url;
}

function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];

    const linkMatch = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(row);
    if (!linkMatch) continue;

    const title = stripHtml(linkMatch[2]).trim();
    if (!title) continue;

    const url = cleanDdgUrl(linkMatch[1]);

    let snippet = "";
    const snippetMatch = /<span[^>]*class="snippet"[^>]*>([\s\S]*?)<\/span>/i.exec(row);
    if (snippetMatch) {
      snippet = stripHtml(snippetMatch[1]).trim();
    }

    results.push({ title, url, snippet });

    if (results.length >= 10) break;
  }

  return results;
}

function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.";

  return results
    .map((r, i) => {
      let out = `${i + 1}. **${r.title}**\n   ${r.url}`;
      if (r.snippet) out += `\n   ${r.snippet}`;
      return out;
    })
    .join("\n\n");
}

// ── Fetch helpers ───────────────────────────────

function createTimeoutSignal(
  ms: number,
  parentSignal?: AbortSignal,
): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  return { controller, clear: () => clearTimeout(timeout) };
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1"].includes(lower)) return true;
  const type = isIP(hostname);
  if (!type) return false;
  if (type === 4) {
    const [a, b] = hostname.split(".").map((n) => Number.parseInt(n, 10));
    if (a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  if (type === 6) {
    const n = hostname.toLowerCase();
    if (n === "::1") return true;
    if (n.startsWith("fc") || n.startsWith("fd") || n.startsWith("fe80")) return true;
  }
  return false;
}

const MAX_FETCH_LENGTH = 30_000;
const MAX_BODY_BYTES = 2_000_000;

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      reader.cancel().catch(() => undefined);
      throw new Error(`Response too large (${bytes} bytes)`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function truncateText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_FETCH_LENGTH) return { text, truncated: false };
  return { text: text.slice(0, MAX_FETCH_LENGTH) + "\n\n[... truncated]", truncated: true };
}

// ── Extension ───────────────────────────────────

export default function webExtension(pi: ExtensionAPI) {
  // ── web_search ────────────────────────────────

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using DuckDuckGo. Returns up to 10 results with title, URL, and snippet. Free, no API key needed.",
    promptSnippet: "Search the web via DuckDuckGo and return up to 10 results",
    promptGuidelines: [
      "Use web_search to look up current information, documentation, or anything not in the local codebase.",
      "Use web_fetch after web_search to read the full content of a specific result page.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, _ctx): Promise<any> {
      const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(params.query)}`;
      const { controller, clear } = createTimeoutSignal(10_000, signal);

      try {
        const response = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; PiAgent/1.0)" },
          signal: controller.signal,
        });

        if (!response.ok) {
          return {
            content: [{ type: "text", text: `Search failed: HTTP ${response.status}` }],
            details: { error: `HTTP ${response.status}`, query: params.query },
            isError: true,
          };
        }

        const html = await response.text();
        const results = parseSearchResults(html);

        return {
          content: [{ type: "text", text: formatSearchResults(results) }],
          details: { query: params.query, resultCount: results.length, results },
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const name = (err instanceof Error ? err.name : "") || "";
        const isTimeout = name === "AbortError" || message.includes("abort");

        if (isTimeout) {
          return {
            content: [{ type: "text", text: "Search timed out after 10 seconds." }],
            details: { error: "timeout", query: params.query },
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: `Search error: ${message}` }],
          details: { error: message, query: params.query },
          isError: true,
        };
      } finally {
        clear();
      }
    },
  });

  // ── web_fetch ─────────────────────────────────

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a web page, extract the main content (strips navigation, sidebars, ads), and return as clean text. Also supports raw markdown, JSON, XML, and plain text URLs. Use after web_search to read a specific result.",
    promptSnippet: "Fetch a URL and extract its main text content",
    promptGuidelines: [
      "Use web_fetch to read the full content of a specific URL. Use web_search first to find relevant URLs.",
      "web_fetch extracts only the main content area (article body) — navigation, sidebars, and ads are removed.",
      "web_fetch also works with raw markdown, JSON, and XML URLs (e.g. GitHub raw files, API endpoints).",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch (http or https)" }),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, _ctx): Promise<any> {
      const url = params.url.trim();

      if (!isHttpUrl(url)) {
        return {
          content: [
            { type: "text", text: `Invalid URL: only http:// and https:// are allowed. Got: ${url}` },
          ],
          details: { error: "invalid_protocol", url },
          isError: true,
        };
      }

      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return {
          content: [{ type: "text", text: `Invalid URL: ${url}` }],
          details: { error: "invalid_url", url },
          isError: true,
        };
      }
      if (isPrivateHostname(parsed.hostname)) {
        return {
          content: [{ type: "text", text: `Blocked private/local host: ${parsed.hostname}` }],
          details: { error: "blocked_host", url },
          isError: true,
        };
      }

      const { controller, clear } = createTimeoutSignal(15_000, signal);

      try {
        const response = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; PiAgent/1.0)" },
          signal: controller.signal,
          redirect: "follow",
        });

        if (!response.ok) {
          return {
            content: [{ type: "text", text: `Failed to fetch: HTTP ${response.status} ${response.statusText}` }],
            details: { error: `HTTP ${response.status}`, url },
            isError: true,
          };
        }

        const contentType = response.headers.get("content-type") || "";
        const contentLength = Number.parseInt(response.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_BODY_BYTES) {
          return {
            content: [{ type: "text", text: `Response too large (${contentLength} bytes).` }],
            details: { error: "response_too_large", url, contentLength },
            isError: true,
          };
        }

        // ── Markdown / plain text: return as-is ──
        if (
          contentType.includes("text/markdown") ||
          contentType.includes("text/plain") ||
          contentType.includes("text/x-markdown")
        ) {
          const raw = await readBodyWithLimit(response, MAX_BODY_BYTES);
          const { text, truncated } = truncateText(raw);
          return {
            content: [{ type: "text", text }],
            details: {
              url,
              title: titleFromMarkdown(raw) || "",
              contentType,
              contentLength: raw.length,
              truncated,
            },
          };
        }

        // ── JSON: pretty-print as markdown ──
        if (contentType.includes("application/json") || contentType.includes("text/json")) {
          const raw = await readBodyWithLimit(response, MAX_BODY_BYTES);
          const rendered = jsonToMarkdown(raw);
          const { text, truncated } = truncateText(rendered);
          return {
            content: [{ type: "text", text }],
            details: {
              url,
              title: "JSON",
              contentType,
              contentLength: rendered.length,
              truncated,
            },
          };
        }

        // ── XML: strip tags, preserve text ──
        if (
          contentType.includes("text/xml") ||
          contentType.includes("application/xml") ||
          contentType.includes("application/rss") ||
          contentType.includes("application/atom")
        ) {
          const raw = await readBodyWithLimit(response, MAX_BODY_BYTES);
          const rendered = xmlToMarkdown(raw);
          const { text, truncated } = truncateText(rendered);
          return {
            content: [{ type: "text", text }],
            details: {
              url,
              title: "",
              contentType,
              contentLength: rendered.length,
              truncated,
            },
          };
        }

        // ── HTML: extract with Readability ──
        if (contentType.includes("text/html")) {
          const html = await readBodyWithLimit(response, MAX_BODY_BYTES);

          const doc = new JSDOM(html, { url });
          const reader = new Readability(doc.window.document);
          const article = reader.parse();

          if (!article || !article.content) {
            return {
              content: [
                {
                  type: "text",
                  text: "Could not extract readable content from this page. It may be a single-page app, landing page, or require JavaScript.",
                },
              ],
              details: { error: "no_content", url, title: article?.title || undefined },
              isError: true,
            };
          }

          const withLinks = preserveLinksAndImages(article.content);
          const rawText = stripHtml(withLinks);
          const { text, truncated } = truncateText(rawText);

          return {
            content: [{ type: "text", text }],
            details: {
              url,
              title: article.title || "",
              contentLength: rawText.length,
              truncated,
            },
          };
        }

        // ── Unsupported content type ──
        return {
          content: [
            {
              type: "text",
              text: `Unsupported content type: ${contentType}. Supported: HTML, Markdown, plain text, JSON, XML.`,
            },
          ],
          details: { error: "unsupported_content_type", contentType, url },
          isError: true,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const name = (err instanceof Error ? err.name : "") || "";
        const isTimeout = name === "AbortError" || message.includes("abort");

        if (isTimeout) {
          return {
            content: [{ type: "text", text: "Request timed out after 15 seconds." }],
            details: { error: "timeout", url },
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: `Fetch error: ${message}` }],
          details: { error: message, url },
          isError: true,
        };
      } finally {
        clear();
      }
    },
  });
}
