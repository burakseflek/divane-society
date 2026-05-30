const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 4000);
const PUBLIC_API_ORIGIN = (process.env.DIVANE_PUBLIC_API_ORIGIN || process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
const DB_DIR = path.resolve(process.env.DIVANE_DB_DIR || path.join(__dirname, 'server'));
const DB_FILE = path.join(DB_DIR, 'db.json');
const UPLOAD_DIR = path.join(DB_DIR, 'uploads');
const BODY_LIMIT = 512 * 1024 * 1024;

const seed = {
  customers: [
    {
      firstName: 'Ada',
      lastName: 'Demir',
      phone: '5551112233',
      password: '1234',
      email: 'ada@divanesociety.app',
      photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&auto=format&fit=crop',
      tier: 'Gold Member'
    }
  ],
  staffAccounts: [
    { id: 'SA-001', password: '1234', role: 'Super Admin', venue: 'Tüm Mekanlar', name: 'Deniz Arslan' },
    { id: 'ADM-101', password: '1234', role: 'Mekan Admini', venue: 'Divane Lounge', name: 'Ece Yaman' },
    { id: 'PRS-210', password: '1234', role: 'Personel', venue: 'Barney Pub', name: 'Mert Kaya' }
  ],
  appPosts: [],
  appStories: [],
  appRewards: ['+1 Kokteyl', 'Shot İkramı', '%20 İndirim', 'VIP Rezervasyon', 'Ücretsiz Giriş', 'Masa İkramı'],
  appCampaigns: ['5 Katılım 1 Çark', 'Gold Member VIP Fast Entry', 'Barney Pub Çift Puan'],
  reservations: [
    { id: 'RZ-4821', venue: 'Divane Lounge', date: '24 Mayıs', time: '22.30', area: 'VIP', people: 4, status: 'Onaylandı', customer: 'Ada Demir', phone: '5551112233' },
    { id: 'RZ-4808', venue: 'Divane Mey', date: '18 Mayıs', time: '20.00', area: 'Bahçe', people: 6, status: 'Geldi', customer: 'Ada Demir', phone: '5551112233' },
    { id: 'RZ-4772', venue: 'Barney Pub', date: '12 Mayıs', time: '21.15', area: 'Bar Önü', people: 3, status: 'İptal', customer: 'Ada Demir', phone: '5551112233' },
    { id: 'RZ-4866', venue: 'Divane Lounge', date: '26 Mayıs', time: '23.00', area: 'Ana Salon', people: 2, status: 'Beklemede', customer: 'Ada Demir', phone: '5551112233' }
  ],
  requests: [
    { id: 'SI-901', category: 'Doğum Günü Talebi', venue: 'Divane Mey', title: 'Tatlı servisi', status: 'Yeni', text: 'Masa için mumlu tatlı ve kısa anons istendi.', customer: 'Ada Demir', phone: '5551112233' },
    { id: 'SI-902', category: 'VIP Talebi', venue: 'Divane Lounge', title: 'Booth upgrade', status: 'Yanıtlandı', text: 'Cumartesi için VIP booth uygunluğu iletildi.', customer: 'Ada Demir', phone: '5551112233' },
    { id: 'SI-903', category: 'Öneri', venue: 'Barney Pub', title: 'Craft tadım', status: 'İnceleniyor', text: 'Haftalık craft tasting önerisi alındı.', customer: 'Ada Demir', phone: '5551112233' }
  ],
  notifications: [
    { id: 'NT-100', type: 'system', title: 'Bildirim Merkezi Hazır', text: 'Story, gönderi, rezervasyon ve istek hareketleri burada toplanır.', target: 'admin', createdAt: 'Bugün' }
  ],
  customerMessages: [],
  pushTokens: {},
  pushQueue: [],
  memberStats: {
    '5551112233': { checkIns: 4, checkInProgress: 4, spinCredits: 0, spinRewards: [], rewardUses: [], checkInLog: [], checkInCodes: [] }
  },
  media: {}
};

function ensureDb() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(next) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(next, null, 2));
}

function send(res, status, payload) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
    'Content-Type': 'application/json'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve(raw ? JSON.parse(raw) : {});
    });
    req.on('error', reject);
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readMultipart(req) {
  const contentType = req.headers['content-type'] || '';
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) throw new Error('Missing multipart boundary');
  const raw = await readRawBody(req);
  const sections = raw.toString('latin1').split(`--${boundary}`);
  const fields = {};
  let file = null;
  sections.forEach((section) => {
    if (!section || section === '--\r\n' || section === '--') return;
    const [headerBlock, ...bodyParts] = section.split('\r\n\r\n');
    if (!bodyParts.length) return;
    const headers = headerBlock.trim();
    const rawBody = bodyParts.join('\r\n\r\n').replace(/\r\n--$/, '').replace(/\r\n$/, '');
    const name = headers.match(/name="([^"]+)"/)?.[1];
    const filename = headers.match(/filename="([^"]*)"/)?.[1];
    const mimeType = headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1];
    if (!name) return;
    if (filename !== undefined) {
      file = { fieldName: name, fileName: filename || 'media', mimeType: mimeType || 'application/octet-stream', buffer: Buffer.from(rawBody, 'latin1') };
    } else {
      fields[name] = rawBody;
    }
  });
  return { fields, file };
}

function publicState(db) {
  const { media, pushTokens, pushQueue, ...state } = db;
  return state;
}

function pushAudienceMatches(registration, audience, phone) {
  if (audience === 'all') return true;
  if (audience === 'phone') return registration.phone && registration.phone === phone;
  if (audience === 'customers') return registration.audience === 'customers';
  if (audience === 'admins') return registration.audience === 'admins';
  if (audience === 'staff') return registration.audience === 'staff';
  return false;
}

async function sendExpoPushMessages(messages) {
  if (!messages.length || typeof fetch !== 'function') return { status: 'queued', details: [] };
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(messages)
  });
  return response.json();
}

function mediaUrl(req, id) {
  const origin = PUBLIC_API_ORIGIN || `http://${req.headers.host}`;
  return `${origin}/api/media/${id}`;
}

function sendMedia(req, res, media) {
  if (media.filePath && fs.existsSync(media.filePath)) {
    const stat = fs.statSync(media.filePath);
    const contentType = media.mimeType || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : stat.size - 1;
      const safeEnd = Math.min(end, stat.size - 1);
      const chunkSize = safeEnd - start + 1;
      res.writeHead(206, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${safeEnd}/${stat.size}`,
        'Content-Length': chunkSize
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(media.filePath, { start, end: safeEnd }).pipe(res);
      return;
    }
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': stat.size
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(media.filePath).pipe(res);
    return;
  }
  const dataUri = media.dataUri || media.remoteUri || media.uri || '';
  if (!dataUri.startsWith('data:')) {
    res.writeHead(302, { Location: dataUri });
    res.end();
    return;
  }
  const [header, payload] = dataUri.split(',');
  const contentType = header.match(/^data:([^;]+)/)?.[1] || 'application/octet-stream';
  const body = Buffer.from(payload || '', 'base64');
  const range = req.headers.range;
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : body.length - 1;
    const safeEnd = Math.min(end, body.length - 1);
    const chunk = body.subarray(start, safeEnd + 1);
    res.writeHead(206, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${safeEnd}/${body.length}`,
      'Content-Length': chunk.length
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(chunk);
    return;
  }
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Content-Length': body.length
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 200, { ok: true });
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      send(res, 200, { ok: true, app: 'Divane Society API', storage: DB_DIR });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/state') {
      send(res, 200, publicState(readDb()));
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && req.url.startsWith('/api/media/')) {
      const id = decodeURIComponent(req.url.replace('/api/media/', ''));
      const db = readDb();
      const media = db.media?.[id];
      if (!media) {
        send(res, 404, { error: 'Media not found' });
        return;
      }
      sendMedia(req, res, media);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/state') {
      const patch = await readBody(req);
      const db = readDb();
      const next = {
        ...db,
        ...patch,
        media: db.media || {}
      };
      writeDb(next);
      send(res, 200, publicState(next));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/push-token') {
      const registration = await readBody(req);
      if (!registration.token) {
        send(res, 400, { error: 'Push token is required' });
        return;
      }
      const db = readDb();
      db.pushTokens = {
        ...(db.pushTokens || {}),
        [registration.token]: {
          ...registration,
          updatedAt: new Date().toISOString()
        }
      };
      writeDb(db);
      send(res, 200, { ok: true, registered: true });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/push/send') {
      const payload = await readBody(req);
      const db = readDb();
      const registrations = Object.values(db.pushTokens || {}).filter((registration) => (
        pushAudienceMatches(registration, payload.audience || 'all', payload.phone)
      ));
      const messages = registrations.map((registration) => ({
        to: registration.token,
        sound: 'default',
        channelId: 'divane-society',
        title: payload.title || 'Divane Society',
        body: payload.body || 'Yeni bildirimin var.',
        data: payload.data || {}
      }));
      const queueItem = {
        id: `push-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        audience: payload.audience || 'all',
        phone: payload.phone,
        title: payload.title || 'Divane Society',
        body: payload.body || 'Yeni bildirimin var.',
        tokenCount: messages.length,
        createdAt: new Date().toISOString(),
        status: 'queued'
      };
      try {
        queueItem.result = await sendExpoPushMessages(messages);
        queueItem.status = 'sent';
      } catch (error) {
        queueItem.status = 'queued-offline';
        queueItem.error = error.message;
      }
      db.pushQueue = [queueItem, ...(db.pushQueue || [])].slice(0, 100);
      writeDb(db);
      send(res, 200, { ok: true, ...queueItem });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/upload') {
      const db = readDb();
      const id = `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('multipart/form-data')) {
        const { fields, file } = await readMultipart(req);
        if (!file) throw new Error('No upload file provided');
        const extension = path.extname(file.fileName) || (file.mimeType.includes('video') ? '.mp4' : '.jpg');
        const storedName = `${id}${extension}`;
        const filePath = path.join(UPLOAD_DIR, storedName);
        fs.writeFileSync(filePath, file.buffer);
        const uploaded = {
          id,
          remote: true,
          type: fields.mediaType || (file.mimeType.includes('video') ? 'video' : 'image'),
          fileName: file.fileName,
          mimeType: file.mimeType,
          uri: mediaUrl(req, id),
          remoteUri: mediaUrl(req, id),
          uploadedAt: new Date().toISOString()
        };
        db.media = {
          ...(db.media || {}),
          [id]: {
            ...uploaded,
            filePath
          }
        };
        writeDb(db);
        send(res, 200, uploaded);
        return;
      }

      const media = await readBody(req);
      const uploaded = {
        ...media,
        id,
        remote: true,
        uri: mediaUrl(req, id),
        remoteUri: mediaUrl(req, id),
        uploadedAt: new Date().toISOString()
      };
      db.media = {
        ...(db.media || {}),
        [id]: {
          ...uploaded,
          dataUri: media.uri
        }
      };
      writeDb(db);
      send(res, 200, uploaded);
      return;
    }

    send(res, 404, { error: 'Not found' });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.requestTimeout = 10 * 60 * 1000;
server.headersTimeout = 10 * 60 * 1000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Divane Society demo API running on http://0.0.0.0:${PORT}`);
});
