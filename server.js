// FluxAI — Railway proxy server
// Node 18+ — timeout illimité — GPT Image 1.5 edits

const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 8080;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Endpoint',
  'Access-Control-Max-Age': '86400',
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(body);
}

function buildMultipart(fields, files) {
  const boundary = '----FluxAIBoundary' + Date.now().toString(36);
  const CRLF = '\r\n';
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`
    ));
  }

  for (const { name, filename, type, data } of files) {
    parts.push(
      Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"; filename="${filename}"${CRLF}Content-Type: ${type}${CRLF}${CRLF}`),
      data,
      Buffer.from(CRLF)
    );
  }

  parts.push(Buffer.from(`--${boundary}--${CRLF}`));
  const body = Buffer.concat(parts);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function callGPTImage(authHeader, prompt, imageBase64, size, quality) {
  const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const imageBuffer = Buffer.from(base64, 'base64');

  const { body, contentType } = buildMultipart(
    {
      model:   'gpt-image-1',
      prompt,
      n:       '1',
      size:    size    || '1024x1024',
      quality: quality || 'high',
    },
    [{ name: 'image', filename: 'product.png', type: 'image/png', data: imageBuffer }]
  );

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path:     '/v1/images/edits',
      method:   'POST',
      headers: {
        'Authorization':  authHeader,
        'Content-Type':   contentType,
        'Content-Length': body.length,
      },
      timeout: 120000, // 2 min max
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI request timeout')); });
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {

  console.log(`${req.method} ${req.url}`);

  // CORS preflight — toujours 204
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'FluxAI Railway Proxy', port: PORT }));
    return;
  }

  // POST /api/gpt-image uniquement
  if (req.method !== 'POST' || req.url !== '/api/gpt-image') {
    sendJSON(res, 404, { error: 'Not found — use POST /api/gpt-image' });
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendJSON(res, 401, { error: 'Authorization Bearer manquant' });
    return;
  }

  // Lire body
  const rawBody = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { sendJSON(res, 400, { error: 'JSON invalide' }); return; }

  const { prompt, image, size, quality } = payload;
  if (!prompt) { sendJSON(res, 400, { error: 'prompt manquant' }); return; }
  if (!image)  { sendJSON(res, 400, { error: 'image manquante' }); return; }

  console.log(`GPT Image edits — prompt: ${prompt.substring(0, 80)}…`);

  try {
    const result = await callGPTImage(authHeader, prompt, image, size, quality);
    console.log(`OpenAI → ${result.status}`);
    res.writeHead(result.status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(result.body);
  } catch (err) {
    console.error('Error:', err.message);
    sendJSON(res, 502, { error: err.message });
  }
});

server.timeout = 180000; // 3 min server timeout

server.listen(PORT, () => {
  console.log(`\n✅ FluxAI Railway Proxy — port ${PORT}`);
  console.log(`   POST /api/gpt-image — GPT Image 1.5 edits\n`);
});
