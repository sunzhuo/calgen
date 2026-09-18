import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { onRequestPost } from './functions/api/parse.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 8081;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.apk': 'application/vnd.android.package-archive'
};

// Mock Gemma 4 model on local dev server
const mockGemmaAi = {
  run: async (model, options) => {
    const userMessage = options.messages.find(m => m.role === 'user').content;
    
    // Intelligent simulation of Gemma 4 26B
    return {
      response: JSON.stringify({
        title: userMessage.includes('开会') ? '会议日程' : '重要日程',
        startTime: new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19),
        endTime: new Date(Date.now() + 25 * 3600 * 1000).toISOString().slice(0, 19),
        allDay: false,
        location: userMessage.includes('会议室') ? '公司会议室' : '',
        description: userMessage,
        url: userMessage.match(/https?:\/\/[^\s]+/)?.[0] || ''
      })
    };
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/parse' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', async () => {
      const mockReq = new Request(`http://${req.headers.host}${req.url}`, {
        method: 'POST',
        headers: req.headers,
        body: bodyStr
      });
      const response = await onRequestPost({
        request: mockReq,
        env: { AI: mockGemmaAi }
      });
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      const data = await response.text();
      res.end(data);
    });
    return;
  }

  let filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Dev server with Gemma 4 API running at http://localhost:${PORT}`);
});
