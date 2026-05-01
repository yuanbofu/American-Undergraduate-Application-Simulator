import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 5173);
const DEFAULT_MIMO_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1";
const MAX_BODY_SIZE = 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function normalizeBaseUrl(input) {
  const raw = String(input || "").trim();
  const fallback = String(process.env.MIMO_BASE_URL || DEFAULT_MIMO_BASE_URL).trim();
  const base = raw || fallback;
  return base.replace(/\/+$/, "");
}

function getChatCompletionsUrl(baseUrlInput) {
  const base = normalizeBaseUrl(baseUrlInput);
  return `${base}/chat/completions`;
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", (error) => reject(error));
  });
}

function resolveStaticPath(urlPathname) {
  const pathname = urlPathname === "/" ? "/index.html" : urlPathname;
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const resolved = path.resolve(ROOT_DIR, `.${safePath}`);
  if (!resolved.startsWith(ROOT_DIR)) return null;
  return resolved;
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const filePath = resolveStaticPath(url.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, "index.html");
      const data = await fs.readFile(indexPath);
      res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
      res.end(data);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  } catch (error) {
    res.writeHead(404);
    res.end("Not Found");
  }
}

async function handleMimoChat(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Invalid request body" });
    return;
  }

  const model = String(payload.model || "").trim();
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const temperature = Number.isFinite(Number(payload.temperature)) ? Number(payload.temperature) : 0.7;
  const maxTokens = Number.isFinite(Number(payload.max_tokens)) && Number(payload.max_tokens) > 0
    ? Number(payload.max_tokens)
    : null;
  const apiKey = String(payload.apiKey || process.env.MIMO_API_KEY || "").trim();
  const baseUrl = payload.baseUrl || process.env.MIMO_BASE_URL || DEFAULT_MIMO_BASE_URL;

  if (!apiKey) {
    sendJson(res, 400, { error: "服务端未配置 MIMO_API_KEY。" });
    return;
  }
  if (!model) {
    sendJson(res, 400, { error: "缺少 model 参数。" });
    return;
  }
  if (!messages.length) {
    sendJson(res, 400, { error: "缺少 messages 参数。" });
    return;
  }

  try {
    const upstreamBody = {
      model,
      temperature,
      messages,
    };
    if (maxTokens) {
      upstreamBody.max_tokens = maxTokens;
    }
    const upstream = await fetch(getChatCompletionsUrl(baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
    });

    const rawText = await upstream.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (error) {
      data = null;
    }

    if (!upstream.ok) {
      const message = data?.error?.message || data?.message || `上游请求失败 (${upstream.status})`;
      sendJson(res, upstream.status, { error: message });
      return;
    }

    const message = data?.choices?.[0]?.message;
    const content = message?.content;
    let reply = "";
    if (typeof content === "string") {
      reply = content.trim();
    } else if (Array.isArray(content)) {
      reply = content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && typeof part.text === "string") return part.text;
          return "";
        })
        .join("")
        .trim();
    }
    if (!reply) {
      sendJson(res, 200, {
        reply: "",
        choices: Array.isArray(data?.choices) ? data.choices : [],
        model: data?.model || model,
      });
      return;
    }

    sendJson(res, 200, {
      reply,
      choices: Array.isArray(data?.choices) ? data.choices : [],
      model: data?.model || model,
    });
  } catch (error) {
    sendJson(res, 500, { error: `调用 MiMo 失败：${error.message || "unknown error"}` });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/api/mimo/chat") {
    await handleMimoChat(req, res);
    return;
  }
  await serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Server ready: http://localhost:${PORT}`);
});
