import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { proxySplitwise } from './shared/splitwiseProxy.js';
import { proxyGroq } from './shared/groqProxy.js';

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

// `vite dev` only serves the SPA — it doesn't run the Netlify/Vercel
// serverless functions, so /.netlify/functions/* 404s (falls through to
// index.html) locally even though it works once deployed. This middleware
// runs the same shared proxy logic those functions call in production, so
// Splitwise/Groq work locally without needing `vercel dev` or `netlify dev`.
function localFunctionsProxy() {
  return {
    name: 'local-functions-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');

        if (url.pathname === '/.netlify/functions/splitwise') {
          const body = req.method === 'POST' ? await readBody(req) : undefined;
          const { status, bodyText } = await proxySplitwise({
            swKey:       req.headers['x-splitwise-key'],
            method:      req.method,
            path:        url.searchParams.get('path'),
            contentType: req.headers['content-type'],
            body,
          });
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(bodyText);
          return;
        }

        if (url.pathname === '/.netlify/functions/groq') {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }
          const authHeader = req.headers['authorization'];
          const idToken    = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
          try {
            const { status, bodyText, provider } = await proxyGroq({ idToken, body: await readBody(req) });
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json');
            if (provider) res.setHeader('X-Ai-Provider', provider);
            res.end(bodyText);
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message || 'Unexpected proxy error' }));
          }
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // proxySplitwise/proxyGroq read process.env directly (same as the deployed
  // functions) — loadEnv with an empty prefix pulls in the non-VITE_ vars
  // (GROQ_API_KEY, NVIDIA_API_KEY) that Vite otherwise wouldn't expose.
  const env = loadEnv(mode, process.cwd(), '');
  process.env.GROQ_API_KEY   ??= env.GROQ_API_KEY;
  process.env.NVIDIA_API_KEY ??= env.NVIDIA_API_KEY;

  return {
    plugins: [react(), localFunctionsProxy()],
    build: { outDir: 'dist' },
  };
});
