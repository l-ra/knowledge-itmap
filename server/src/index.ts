import { randomUUID } from "node:crypto";
import express from "express";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type McpServerConfig } from "./config.js";
import { AppContext } from "./context.js";
import { createMcpServer } from "./createMcpServer.js";
import {
  buildProtectedResourceMetadata,
  requireBearerOnMcp,
  wwwAuthenticateHeader,
} from "./oauth.js";
import { McpSessionState } from "./session.js";

async function main(): Promise<void> {
  const config = loadConfig();
  console.error(
    `itmap-mcp starting transport=${config.transport} writePackages=[${config.writePackages.join(",")}] defaultPackage=${config.defaultPackage ?? "null"} oauth=${config.oauthEnabled} pid=${process.pid}`,
  );

  if (config.transport === "stdio") {
    const ctx = AppContext.create(config);
    const server = createMcpServer(ctx);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  await startHttp(config);
}

async function startHttp(config: McpServerConfig): Promise<void> {
  const app = express();
  app.use(express.json({ limit: Math.max(config.oeMaxBytes + 1_000_000, 6_000_000) }));

  type HttpSession = {
    ctx: AppContext;
    transport: StreamableHTTPServerTransport;
  };
  const sessions = new Map<string, HttpSession>();

  const extractBearer = (req: express.Request): string | null => {
    const h = req.header("authorization") || req.header("Authorization");
    if (!h) return null;
    const m = /^Bearer\s+(.+)$/i.exec(h.trim());
    return m?.[1]?.trim() || null;
  };

  const sendUnauthorized = (res: express.Response) => {
    if (config.oauthEnabled) {
      res.setHeader("WWW-Authenticate", wwwAuthenticateHeader(config));
    }
    res.status(401).json({ error: "Authorization Bearer token required" });
  };

  const prm = buildProtectedResourceMetadata(config);
  if (prm) {
    const sendPrm = (_req: express.Request, res: express.Response) => {
      res.json(prm);
    };
    app.get("/.well-known/oauth-protected-resource", sendPrm);
    app.get("/.well-known/oauth-protected-resource/mcp", sendPrm);
  }

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      transport: "http",
      writePackages: config.writePackages,
      defaultPackage: config.defaultPackage,
      oauthEnabled: config.oauthEnabled,
      pid: process.pid,
    });
  });

  app.all("/mcp", async (req, res) => {
    try {
      const token = extractBearer(req);
      if (requireBearerOnMcp(config) && !token) {
        sendUnauthorized(res);
        return;
      }

      const sessionId = req.header("mcp-session-id") || undefined;
      let entry = sessionId ? sessions.get(sessionId) : undefined;

      if (entry) {
        if (config.authMode === "forward" && token) {
          entry.ctx.session.setForwardedToken(token);
          entry.ctx.syncAuth();
        }
        await entry.transport.handleRequest(req, res, req.body);
        return;
      }

      // New session — typically initialize (POST without session id)
      if (sessionId) {
        res.status(404).json({ error: "Unknown MCP session" });
        return;
      }

      const session = new McpSessionState({
        writePackagesAllowlist: config.writePackages,
        defaultPackage: config.defaultPackage,
        lang: config.lang,
        writeMode: config.writeMode,
        authMode: config.authMode,
        forwardedToken: token,
      });
      const ctx = AppContext.create(config, session);
      const server = createMcpServer(ctx);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { ctx, transport });
        },
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) sessions.delete(id);
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("MCP HTTP error:", e);
      if (!res.headersSent) {
        res.status(500).json({
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });

  app.listen(config.httpPort, () => {
    console.error(
      `itmap-mcp HTTP listening on :${config.httpPort}/mcp writePackages=[${config.writePackages.join(",")}] defaultPackage=${config.defaultPackage ?? "null"}`,
    );
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
