import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, relative, basename, dirname } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const WIKI_DIR = join(homedir(), ".pi", "wiki");

// ── Templates ────────────────────────────────────────────────────────────────

const META_TEMPLATE = (tool: string, sourceUrls: string[], topics: string[]) =>
  JSON.stringify(
    { tool, sourceUrls, lastScraped: new Date().toISOString(), topics },
    null, 2,
  );

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function ensureWikiDir() {
  await mkdir(WIKI_DIR, { recursive: true });
}

async function httpGet(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "pi-wiki/1.0", Accept: "text/plain,text/markdown,*/*" },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("text/html")) return null;
    const text = await resp.text();
    const trimmed = text.trimStart().slice(0, 200).toLowerCase();
    if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) return null;
    return text;
  } catch {
    return null;
  }
}

// ── llms.txt discovery ───────────────────────────────────────────────────────

interface LlmsTxtResult {
  url: string;
  content: string;
  source: "llms.txt" | "llms-full.txt";
}

async function discoverLlmsTxt(origin: string, pathSegments: string[]): Promise<LlmsTxtResult | null> {
  const candidates: string[] = [];
  for (let i = pathSegments.length; i >= 0; i--) {
    const prefix = pathSegments.slice(0, i).join("/");
    if (prefix) {
      candidates.push(`${origin}/${prefix}/llms.txt`);
      candidates.push(`${origin}/${prefix}/llms-full.txt`);
    }
  }
  candidates.push(`${origin}/llms.txt`);
  candidates.push(`${origin}/llms-full.txt`);

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const content = await httpGet(candidate);
    if (content) {
      const source = candidate.endsWith("llms-full.txt") ? "llms-full.txt" : "llms.txt";
      return { url: candidate, content, source };
    }
  }
  return null;
}

// ── Shared widget helper ─────────────────────────────────────────────────────

const WIDGET_LINES = 10;
const WIDGET_ID = "pi-wiki";
const LINE_W = 88;

interface Widget {
  setStatus(ctx: any, msg: string): void;
  setWidget(ctx: any, lines: string[]): void;
  clear(ctx: any): void;
}

function makeWidget(): Widget {
  return {
    setStatus(ctx, msg) { ctx.ui.setStatus(WIDGET_ID, msg); },
    setWidget(ctx, lines) {
      ctx.ui.setWidget(WIDGET_ID, lines.map((l) =>
        l.length > LINE_W ? l.substring(0, LINE_W - 1) + "…" : l
      ));
    },
    clear(ctx) {
      ctx.ui.setStatus(WIDGET_ID, undefined);
      ctx.ui.setWidget(WIDGET_ID, undefined);
    },
  };
}

// ── Subprocess ───────────────────────────────────────────────────────────────

function runPiSubprocess(
  prompt: string,
  onOutput: (chunk: string) => void,
  extraArgs: string[] = [],
  timeoutMs = 300000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const errChunks: string[] = [];
    let settled = false;

    const args = ["-p", "--no-session", ...extraArgs, prompt];
    const proc = spawn("pi", args, {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      settled = true;
      proc.kill("SIGTERM");
      reject(new Error(`Subprocess timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      chunks.push(text);
      onOutput(text);
    });

    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        errChunks.push(text);
        onOutput(text + "\n");
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      const output = chunks.join("");
      const errOutput = errChunks.join("\n");
      if (code !== 0 && !output.trim()) {
        const detail = errOutput ? `: ${errOutput.slice(0, 500)}` : "";
        reject(new Error(`Subprocess exited with code ${code}${detail}`));
      } else {
        resolve(output.trim());
      }
    });

    proc.on("error", (err: any) => {
      clearTimeout(timer);
      if (settled) return;
      if (err.code === "ENOENT") {
        reject(new Error("pi binary not found on PATH."));
      } else {
        reject(err);
      }
    });
  });
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) return fence[1];
  const match = text.match(/[\{[][\s\S]*[\}\]]/);
  return match ? match[0] : text;
}

// ── Prompts ──────────────────────────────────────────────────────────────────

function ANALYZE_LLMS_PROMPT(content: string, sourceUrl: string): string {
  const safe = content.replace(/`/g, "\\`");
  return `You are analyzing a documentation site. Decide what to build wiki entries for.

SOURCE URL: ${sourceUrl}

DOCUMENTATION CONTENT (llms.txt):
\`\`\`
${safe}
\`\`\`

Guidelines:
- Identify the main tool/project name (usually from the H1 heading)
- Find ALL documentation URLs in the content. Each unique doc URL is a potential topic.
- If the document links to other pages (API docs, guides, reference), those get their own topics.
- If this is a self-contained doc with NO links, treat it as ONE topic.
- DO NOT create topics from section headings (## or ###) — those are internal sections.
- Skip non-documentation URLs (images, CSS, CDN, analytics, etc.)

Output ONLY a JSON object:
{
  "tool": "project name",
  "toolSlug": "kebab-case",
  "topics": [
    { "title": "brief description", "slug": "slug-name", "url": "https://full-url" }
  ]
}

IMPORTANT: Output ONLY valid JSON. No markdown fences, no other text.`;
}

function ANALYZE_PAGE_PROMPT(baseUrl: string): string {
  return `You are analyzing a documentation site. Decide what to build wiki entries for.

1. Visit this URL using web_fetch: ${baseUrl}
2. Analyze the page structure, navigation, and all links
3. Decide which documentation pages need wiki entries

Guidelines:
- Identify the main tool/project
- Find ALL unique documentation URLs — links to docs, API refs, guides
- Each distinct doc page is a topic
- DO NOT create topics from section headings — those are internal sections
- Skip non-documentation URLs

Output ONLY a JSON object:
{
  "tool": "project name",
  "toolSlug": "kebab-case",
  "topics": [
    { "title": "brief description", "slug": "slug-name", "url": "https://full-url" }
  ]
}

IMPORTANT: Output ONLY valid JSON. No markdown fences, no other text.`;
}

function SCRAPE_PROMPT(url: string, tool: string, topic: string, wikiPath: string, metaPath: string): string {
  return `Visit this URL using web_fetch: ${url}

Then create an AI-optimized wiki entry using the write tool. Save to: ${wikiPath}

TEMPLATE (fill in all sections):

# ${tool} — ${topic}

## Overview
[2–3 sentences about this topic]

## Key Concepts
- [concept]: [explanation]
- [concept]: [explanation]

## API Reference
[Key APIs with signatures. Skip if not applicable.]

## Usage Patterns
[Common patterns and best practices]

## Gotchas
[Common pitfalls and warnings]

## Examples
\`\`\`[language]
[code example]
\`\`\`

## Cross-References
- [[tool/related]] — how it relates

## Search Tags
\`tag1\`, \`tag2\`, \`tag3\`, \`tag4\`, \`tag5\`

RULES:
- Search Tags: at least 5 domain-specific terms (NOT the tool or topic name)
- Cross-References: use [[tool/topic]] wikilink format
- Keep content concise, AI-optimized
- Update _meta.json at ${metaPath} if it exists, otherwise create it

After saving, output ONLY this: SAVED: ${slugify(tool)}/${slugify(topic)}.md`;
}

// ── wiki_search tool ─────────────────────────────────────────────────────────

async function findMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fp = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...await findMdFiles(fp));
    else if (entry.isFile() && entry.name.endsWith(".md")) results.push(fp);
  }
  return results;
}

function scoreMatch(query: string, filePath: string, content: string): number {
  const words = query.toLowerCase().split(/\s+/);
  const fn = basename(filePath, ".md").toLowerCase();
  const dn = basename(dirname(filePath)).toLowerCase();
  const cl = content.toLowerCase();
  let score = 0;
  for (const w of words) {
    if (fn === w || fn.includes(w)) score += 30;
    if (dn === w || dn.includes(w)) score += 30;
    const tm = content.match(/^#\s+(.+)$/m);
    if (tm && tm[1].toLowerCase().includes(w)) score += 25;
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const m = cl.match(re);
    if (m) score += m.length;
    const ts = content.match(/## Search Tags\n([\s\S]*?)(?=\n##|$)/);
    if (ts && ts[1].toLowerCase().includes(w)) score += 15;
    const xr = content.match(/## Cross-References\n([\s\S]*?)(?=\n##|$)/);
    if (xr && xr[1].toLowerCase().includes(w)) score += 10;
  }
  return score;
}

function getSnippet(content: string, query: string): string {
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    const first = content.split("\n").find((l) => l.trim() && !l.startsWith("#"));
    return first?.trim().substring(0, 120) || "(empty)";
  }
  const s = Math.max(0, idx - 60);
  const e = Math.min(content.length, idx + query.length + 80);
  let sn = content.substring(s, e).replace(/\n/g, " ");
  if (s > 0) sn = "…" + sn;
  if (e < content.length) sn = sn + "…";
  return sn.trim();
}

// ── Extension ────────────────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
  await ensureWikiDir();

  pi.registerCommand("wiki", {
    description: "Scrape tool documentation into the local AI wiki. Usage: /wiki <url>",
    handler: async (args, ctx) => {
      const w = makeWidget();
      const raw = args?.trim() ?? "";
      if (!raw) { ctx.ui.notify("Usage: /wiki <url> [--model <id>] [--thinking <level>]", "warning"); return; }

      // Parse flags: /wiki <url> [--model <model>] [--thinking <level>]
      let url = raw;
      const subArgs: string[] = [];
      const modelMatch = raw.match(/--model\s+(\S+)/);
      if (modelMatch) {
        subArgs.push("--model", modelMatch[1]);
        url = url.replace(modelMatch[0], "").trim();
      }
      const thinkMatch = raw.match(/--thinking(?:-level)?\s+(\S+)/);
      if (thinkMatch) {
        subArgs.push("--thinking", thinkMatch[1]);
        url = url.replace(thinkMatch[0], "").trim();
      }

      let parsedUrl: URL;
      try { parsedUrl = new URL(url); }
      catch { ctx.ui.notify("Invalid URL. Provide a full URL starting with http:// or https://", "error"); return; }

      const origin = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
      const pathSegments = parsedUrl.pathname.replace(/\/$/, "").split("/").filter(Boolean);

      // ══════ Phase 1: Discover llms.txt ═══════════════════════════════════

      const llms = await discoverLlmsTxt(origin, pathSegments);

      let tool = "", toolSlug = "";
      let sourceUrl = origin;
      let sourceLabel = "";
      let topics: { title: string; slug: string; url: string }[] = [];
      let analysis: any;

      if (llms) {
        sourceLabel = `${llms.source} at ${llms.url}`;
        ctx.ui.notify(`✅ Found ${llms.source}: ${llms.url}`, "info");

        let analysisBuffer = "";
        let analyzeOutput = "";
        const startTime = Date.now();
        const timer = setInterval(() => {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const lines = analysisBuffer.split("\n").slice(-(WIDGET_LINES - 2));
          w.setWidget(ctx, [
            `⏳ Analyzing... ${elapsed}s`,
            ...lines,
          ]);
        }, 500);

        try {
          analyzeOutput = await runPiSubprocess(
            ANALYZE_LLMS_PROMPT(llms.content, llms.url),
            (chunk) => { analysisBuffer += chunk; },
            subArgs,
            120000,
          );
        } catch (err: any) {
          clearInterval(timer);
          ctx.ui.notify(`❌ Analysis failed: ${err.message}`, "error");
          w.clear(ctx);
          return;
        }
        clearInterval(timer);

        try {
          analysis = JSON.parse(extractJson(analyzeOutput));
        } catch (err: any) {
          ctx.ui.notify(`❌ Failed to parse analysis: ${err.message}`, "error");
          w.clear(ctx);
          return;
        }
        if (analysis.error) {
          ctx.ui.notify(`❌ ${analysis.error}`, "error");
          w.clear(ctx);
          return;
        }

        tool = analysis.tool || parsedUrl.hostname;
        toolSlug = analysis.toolSlug || slugify(tool);
        topics = analysis.topics || [];
        sourceUrl = llms.url;

      } else {
        ctx.ui.notify(`⚠️ No llms.txt found. Analyzing page via web_fetch...`, "info");

        let pageBuffer = "";
        let analyzeOutput = "";
        const startTime = Date.now();
        const timer = setInterval(() => {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const lines = pageBuffer.split("\n").slice(-(WIDGET_LINES - 2));
          w.setWidget(ctx, [
            `⏳ Analyzing page... ${elapsed}s`,
            ...lines,
          ]);
        }, 500);

        const baseUrl = `${origin}/${pathSegments.join("/")}`;
        sourceLabel = `direct page analysis (${baseUrl})`;

        try {
          analyzeOutput = await runPiSubprocess(
            ANALYZE_PAGE_PROMPT(baseUrl),
            (chunk) => { pageBuffer += chunk; },
            subArgs,
            180000,
          );
        } catch (err: any) {
          clearInterval(timer);
          ctx.ui.notify(`❌ Page analysis failed: ${err.message}`, "error");
          w.clear(ctx);
          return;
        }
        clearInterval(timer);

        try {
          analysis = JSON.parse(extractJson(analyzeOutput));
        } catch (err: any) {
          ctx.ui.notify(`❌ Failed to parse page analysis: ${err.message}`, "error");
          w.clear(ctx);
          return;
        }
        if (analysis.error) {
          ctx.ui.notify(`❌ ${analysis.error}`, "error");
          w.clear(ctx);
          return;
        }

        tool = analysis.tool || parsedUrl.hostname;
        toolSlug = analysis.toolSlug || slugify(tool);
        topics = analysis.topics || [];
        sourceUrl = baseUrl;
      }

      if (topics.length === 0) {
        ctx.ui.notify(`⚠️ No topics found at ${url}.`, "warning");
        w.clear(ctx);
        return;
      }

      w.setWidget(ctx, [
        `✅ Found ${topics.length} topic(s) in ${tool}`,
        `Source: ${sourceLabel}`,
        "",
        ...topics.slice(0, 4).map((t: any) => `• ${t.title}`),
        ...(topics.length > 4 ? [`… and ${topics.length - 4} more`] : []),
      ]);
      ctx.ui.notify(`📋 Found ${topics.length} topic(s) in ${tool}`, "info");

      // ══════ Phase 2: Filter (if too many) + user picks ══════════════════

      if (topics.length > 30) {
        ctx.ui.notify(`⚠️ ${topics.length} topics is a lot. Let's narrow it down.`, "info");

        // Loop: user enters keywords until list is manageable or they give up
        while (topics.length > 30) {
          const filter = await ctx.ui.input(
            `${topics.length} topics. Enter a keyword to filter (or "all" for everything):`,
            ""
          );
          if (!filter || filter.toLowerCase() === "all") {
            break;
          }
          const filtered = topics.filter((t: any) =>
            t.title.toLowerCase().includes(filter.toLowerCase()) ||
            t.slug.toLowerCase().includes(filter.toLowerCase())
          );
          if (filtered.length === 0) {
            ctx.ui.notify(`❌ No topics match "${filter}". Try another.`, "info");
          } else {
            topics = filtered;
            ctx.ui.notify(`📋 Narrowed to ${topics.length} topic(s)`, "info");
            w.setWidget(ctx, [
              `📋 ${topics.length} topic(s) after filter`,
              "",
              ...topics.slice(0, 6).map((t: any) => `• ${t.title}`),
              ...(topics.length > 6 ? [`… and ${topics.length - 6} more`] : []),
            ]);
          }
        }
      }

      if (topics.length > 1) {
        const scrapeAll = await ctx.ui.confirm(
          `${topics.length} topics`,
          `Scrape ALL ${topics.length} topics from ${tool}?\n\nSelect "No" to pick a specific topic.`,
        );
        if (scrapeAll === undefined) {
          ctx.ui.notify("⏹️ Aborted.", "info");
          w.clear(ctx);
          return;
        }
        if (!scrapeAll) {
          const selected = await ctx.ui.select(
            `Pick a topic to scrape from ${tool}:`,
            topics.map((t: any) => t.title),
          );
          if (!selected) {
            ctx.ui.notify("⏹️ No topic selected. Aborted.", "info");
            w.clear(ctx);
            return;
          }
          const idx = topics.findIndex((t: any) => t.title === selected);
          if (idx !== -1) topics = [topics[idx]];
        }
      }

      // ══════ Phase 3: Scrape ═════════════════════════════════════════════

      ctx.ui.notify(`⏳ Scraping ${topics.length} topic(s) for ${tool}...`, "info");

      const toolDir = join(WIKI_DIR, toolSlug);
      await mkdir(toolDir, { recursive: true });

      const metaPath = join(toolDir, "_meta.json");
      const slugs = topics.map((t: any) => t.slug);
      const urls = topics.map((t: any) => t.url);
      await writeFile(metaPath, META_TEMPLATE(tool, urls, slugs), "utf-8");

      let created = 0, failed = 0;
      const results: string[] = [];

      for (let i = 0; i < topics.length; i++) {
        const t = topics[i];
        const wikiPath = join(toolDir, `${t.slug}.md`);
        const prompt = SCRAPE_PROMPT(t.url, tool, t.title, wikiPath, metaPath);
        const label = `${toolSlug}/${t.slug}`;

        w.setWidget(ctx, [
          `⏳ Scraping ${label} (${i + 1}/${topics.length})...`,
        ]);

        try {
          let subBuffer = "";
          const result = await runPiSubprocess(
            prompt,
            (chunk) => {
              subBuffer += chunk;
              // Show last few lines of sub-agent output
              const tail = subBuffer.split("\n").slice(-(WIDGET_LINES - 2));
              w.setWidget(ctx, [
                `⏳ ${label} (${i + 1}/${topics.length})`,
                ...tail,
              ]);
            },
            subArgs,
          );

          if (result.includes("SAVED:")) {
            created++;
            results.push(`✅ ${label}`);
            // Show a preview of what was generated
            try {
              const preview = (await readFile(wikiPath, "utf-8"))
                .split("\n")
                .filter((l) => l.trim())
                .slice(0, WIDGET_LINES - 1);
              w.setWidget(ctx, [
                `✅ ${label} — saved`,
                ...preview.map((l) => l.substring(0, LINE_W)),
              ]);
            } catch {
              w.setWidget(ctx, [`✅ ${label}`]);
            }
          } else {
            failed++;
            results.push(`⚠️ ${label} — unexpected output`);
            w.setWidget(ctx, [`⚠️ ${label} — unexpected output, check logs`]);
          }
        } catch (err: any) {
          failed++;
          results.push(`❌ ${label} — ${err.message}`);
          w.setWidget(ctx, [`❌ ${label} — ${err.message}`]);
        }
      }

      w.clear(ctx);

      const summary = [
        `📚 **Wiki scrape complete for ${tool}**`,
        `Source: ${sourceLabel}`,
        `**${created}** created, **${failed}** failed`,
        `Entries saved to \`~/.pi/wiki/${toolSlug}/\``,
        "",
        ...results,
      ].join("\n");

      pi.sendUserMessage(summary);
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // wiki_search <query>
  // ═══════════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: "wiki_search",
    label: "Wiki Search",
    description:
      "Search the local AI wiki (~/.pi/wiki/) for documentation on tools, libraries, and technologies. Use this BEFORE working with any unfamiliar tool or library to check if documentation exists.",
    promptSnippet: "Search the local wiki for tool documentation (smart grep with relevance ranking)",
    promptGuidelines: [
      "Use wiki_search before using any tool, library, framework, or CLI you are not already deeply familiar with. The wiki may contain AI-optimized documentation that helps you use the tool correctly and avoid common pitfalls.",
      "If wiki_search returns relevant entries, use the read tool to fetch the full wiki entry before proceeding with the task.",
      "When you learn something new about a tool or technology that is not yet in the wiki, tell the user and ask: 'I learned [X] about [Y]. Should I create or update a wiki entry for this?'",
    ],
    parameters: Type.Object({
      query: Type.String({
        description: "Search query. Use keywords related to the tool, technology, library, or concept.",
      }),
      tool: Type.Optional(Type.String({
        description: "Optional: limit search to a specific tool folder (e.g., 'react', 'docker').",
      })),
    }),
    async execute(_id, params) {
      const { query, tool } = params;
      let dir = WIKI_DIR;
      if (tool) {
        dir = join(WIKI_DIR, tool);
        if (!existsSync(dir)) return { content: [{ type: "text", text: `No wiki entries found for "${tool}".` }], details: {} };
      }
      const files = await findMdFiles(dir);
      if (files.length === 0) {
        return { content: [{ type: "text", text: tool ? `No wiki entries for "${tool}".` : `Wiki is empty. Use /wiki <url> to add documentation.` }], details: {} };
      }
      const ranked = files.map((f) => {
        const c = readFileSync(f, "utf-8");
        return { file: f, score: scoreMatch(query, f, c), snippet: getSnippet(c, query) };
      }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 10);

      if (ranked.length === 0) return { content: [{ type: "text", text: `No matches for "${query}" in ${files.length} files.` }], details: {} };

      const out = ranked.map((r, i) => {
        const rp = relative(WIKI_DIR, r.file).replace(/\.md$/, "");
        return `${i + 1}. **${rp}** (score: ${r.score})\n   ${r.snippet}`;
      }).join("\n\n");

      return {
        content: [{ type: "text", text: `Found ${ranked.length} entries for "${query}":\n\n${out}` }],
        details: { matches: ranked.map((r) => ({ path: relative(WIKI_DIR, r.file), score: r.score })) },
      };
    },
  });
}
