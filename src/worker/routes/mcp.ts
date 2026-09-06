// MCP (Streamable HTTP)。@hono/mcp の StreamableHTTPTransport + @modelcontextprotocol/sdk の
// McpServer を使用したステートレスMCPサーバー。Authorization: Bearer <MCP_TOKEN> で保護する。
import type { Context } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPTransport } from '@hono/mcp';
import type { Env } from '../env';
import type { ApiError } from '../../shared/types';
import { registerTools } from '../mcp/tools';
import { timingSafeEqual } from '../logic/security';

export async function handleMcp(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = c.req.header('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (!token || !timingSafeEqual(token, c.env.MCP_TOKEN)) {
    return c.json<ApiError>({ error: 'unauthorized' }, 401);
  }

  const server = new McpServer({ name: 'formnow', version: '1.0.0' });
  registerTools(server, c.env);

  // ステートレスモード: リクエストごとに新規サーバー/トランスポートを生成する
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const response = await transport.handleRequest(c);
  return response ?? c.body(null, 202);
}
