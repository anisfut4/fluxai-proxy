// FluxAI Railway Proxy — GPT Image 1.5 + Nano Banana Pro
// Node 18+ — callbacks classiques — listen 0.0.0.0

const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3001;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Gemini-Key',
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 30000 }, res => {
      if (res.statusCode !== 200) { console.error('Gemini error body:', raw.substring(0, 800)); reject(new Error('Fetch failed: HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject).on('timeout', () => reject(new Error('Fetch timeout')));
  });
}

// ─── GPT IMAGE (OpenAI) ──────────────────────────────────────────────────────
function buildMultipart(fields, imageBuffer) {
  const boundary = 'FluxAIBoundary' + Date.now();
  const CRLF = '\r\n';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from('--' + boundary + CRLF +
      'Content-Disposition: form-data; name="' + k + '"' + CRLF + CRLF + v + CRLF));
  }
  parts.push(
    Buffer.from('--' + boundary + CRLF +
      'Content-Disposition: form-data; name="image"; filename="product.png"' + CRLF +
      'Content-Type: image/png' + CRLF + CRLF),
    imageBuffer,
    Buffer.from(CRLF + '--' + boundary + '--' + CRLF)
  );
  return { body: Buffer.concat(parts), contentType: 'multipart/form-data; boundary=' + boundary };
}

function callGPTImageEdit(auth, prompt, imageBuffer, size, quality) {
  const { body, contentType } = buildMultipart(
    { model: 'gpt-image-1', prompt, n: '1', size: size || '1024x1024', quality: quality || 'high' },
    imageBuffer
  );
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com', path: '/v1/images/edits', method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': contentType, 'Content-Length': body.length },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.setTimeout(280000, () => { req.destroy(); reject(new Error('GPT Image timeout 180s')); });
    req.write(body); req.end();
  });
}

// ─── NANO BANANA PRO (Gemini) ────────────────────────────────────────────────
function callNanoBanana(geminiKey, prompt, imageBase64, imageMime) {
  // Gemini API: JSON body avec inlineData base64
  const contents = [];

  if (imageBase64) {
    // Image + texte pour l'édition
    contents.push({
      role: 'user',
      parts: [
        { inlineData: { mimeType: imageMime || 'image/png', data: imageBase64 } },
        { text: prompt }
      ]
    });
  } else {
    // Texte seulement pour génération pure
    contents.push({ role: 'user', parts: [{ text: prompt }] });
  }

  const reqBody = JSON.stringify({
    contents,
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    }
  });

  const model = 'gemini-2.5-flash-image';
  const path = `/v1beta/models/${model}:generateContent?key=${geminiKey}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reqBody) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) { console.error('Gemini error body:', raw.substring(0, 800));
          resolve({ status: res.statusCode, body: raw }); return;
        }
        // Extraire l'image base64 de la réponse Gemini
        try {
          const parsed = JSON.parse(raw);
          const parts = parsed.candidates?.[0]?.content?.parts || [];
          const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
          if (imgPart) {
            const b64 = imgPart.inlineData.data;
            // Retourner format compatible OpenAI pour l'app
            const fakeOpenAI = JSON.stringify({ data: [{ b64_json: b64 }] });
            resolve({ status: 200, body: fakeOpenAI });
          } else {
            console.error('Gemini: pas d\'image dans la réponse', raw.substring(0, 500));
            resolve({ status: 500, body: JSON.stringify({ error: { message: 'Gemini: aucune image retournée' } }) });
          }
        } catch (e) {
          resolve({ status: 500, body: JSON.stringify({ error: { message: 'Parse error: ' + e.message } }) });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(280000, () => { req.destroy(); reject(new Error('Nano Banana timeout 180s')); });
    req.write(reqBody); req.end();
  });
}

// ─── SERVER ──────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  console.log(new Date().toISOString().slice(11, 19), req.method, req.url);

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  if (req.method === 'GET') { sendJSON(res, 200, { status: 'ok', service: 'FluxAI Proxy v2', port: PORT }); return; }
  if (req.method !== 'POST' || req.url !== '/api/gpt-image') {
    sendJSON(res, 404, { error: 'POST /api/gpt-image only' }); return;
  }

  readBody(req).then(raw => {
    console.log('Body:', raw.length, 'chars');

    let payload;
    try { payload = JSON.parse(raw); }
    catch(e) { sendJSON(res, 400, { error: 'JSON invalide' }); return; }

    console.log('RAW PROVIDER:', payload.provider, '| KEYS:', Object.keys(payload).join(','));
    const { prompt, imageUrl, image, size, quality, provider } = payload;

    if (!prompt) { sendJSON(res, 400, { error: 'prompt manquant' }); return; }

    console.log('provider:', provider || 'gpt', '| prompt:', prompt.substring(0, 60) + '…');

    // ── NANO BANANA PRO ──
    if (provider === 'nanobananaPro') {
      const geminiKey = req.headers['x-gemini-key'] || payload.geminiKey;
      if (!geminiKey) { sendJSON(res, 401, { error: 'Clé Gemini manquante (X-Gemini-Key)' }); return; }

      const getImage = imageUrl
        ? fetchBuffer(imageUrl).then(buf => buf.toString('base64'))
        : image
          ? Promise.resolve(image.replace(/^data:image\/\w+;base64,/, ''))
          : Promise.resolve(null);

      getImage.then(b64 => {
        console.log('Nano Banana Pro — image:', b64 ? Math.round(b64.length * 0.75 / 1024) + 'KB' : 'none');
        const geminiPrompt = prompt.replace(/^PHOTO EDITING TASK — NOT IMAGE GENERATION.s*/i, '').replace(/The product in the input image MUST remain pixel-perfect identical..*?Do NOT recreate or redesign the product.s*/gs, ''); return callNanoBanana(geminiKey, geminiPrompt, b64, 'image/png');
      }).then(result => {
        console.log('Gemini status:', result.status);
        res.writeHead(result.status, { ...CORS, 'Content-Type': 'application/json' });
        res.end(result.body);
      }).catch(err => {
        console.error('Nano Banana error:', err.message);
        sendJSON(res, 502, { error: err.message });
      });
      return;
    }

    // ── GPT IMAGE 1.5 (défaut) ──
    const auth = req.headers['authorization'];
    if (!auth) { sendJSON(res, 401, { error: 'Authorization manquant' }); return; }

    const getImage = imageUrl
      ? fetchBuffer(imageUrl)
      : image
        ? Promise.resolve(Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64'))
        : Promise.resolve(null);

    getImage.then(imageBuffer => {
      if (imageBuffer) console.log('GPT Image — buffer:', imageBuffer.length, 'bytes');
      return callGPTImageEdit(auth, prompt, imageBuffer, size, quality);
    }).then(result => {
      console.log('GPT Image status:', result.status);
      res.writeHead(result.status, { ...CORS, 'Content-Type': 'application/json' });
      res.end(result.body);
    }).catch(err => {
      console.error('GPT Image error:', err.message);
      sendJSON(res, 502, { error: err.message });
    });

  }).catch(err => {
    console.error('Read body error:', err.message);
    sendJSON(res, 500, { error: err.message });
  });
});

server.timeout = 300000;
server.keepAliveTimeout = 120000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('✅ FluxAI Proxy v2 — port ' + PORT);
  console.log('   GPT Image 1.5 + Nano Banana Pro (Gemini)');
});
server.on('error', err => { console.error('Server error:', err.message); process.exit(1); });
