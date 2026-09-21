import { Hono } from 'hono';
import type { Env } from './env';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';
import { handleMcp } from './routes/mcp';
import type { ApiError } from '../shared/types';

const app = new Hono<{ Bindings: Env }>();

app.route('/api/forms', publicRoutes);
app.route('/api/admin', adminRoutes);

// MCP (Streamable HTTP)。Bearer MCP_TOKEN で保護
app.all('/mcp', handleMcp);
app.all('/mcp/*', handleMcp);

app.notFound((c) => c.json<ApiError>({ error: 'not found' }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json<ApiError>({ error: 'internal server error' }, 500);
});

export default app;
