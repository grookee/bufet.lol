import Fastify from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { config } from 'dotenv';

config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const TOKEN = process.env.BUFET_TOKEN || 'bufet';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const PUBLIC_DIR = join(ROOT, 'public');
const DIST_DIR = join(ROOT, 'dist');
const PHOTOS_DIR = join(PUBLIC_DIR, 'photos');
const CONFIG_DIR = join(ROOT, 'config');

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(PHOTOS_DIR, { recursive: true });

function seedDataFile(name: string) {
  const dest = join(DATA_DIR, name);
  if (!existsSync(dest)) {
    const src = join(CONFIG_DIR, name);
    if (existsSync(src)) writeFileSync(dest, readFileSync(src));
    else writeFileSync(dest, name.endsWith('json') ? '[]' : '');
  }
}

seedDataFile('photos.json');
seedDataFile('thoughts.json');

function auth(req: { headers: { authorization?: string } }, reply: { status: (code: number) => { send: (body: unknown) => void } }): boolean {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    reply.status(401).send({ error: 'nope' });
    return false;
  }
  return true;
}

function readJSON(p: string) {
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function writeJSON(p: string, data: unknown) {
  writeFileSync(p, JSON.stringify(data, null, 2));
}

const app = Fastify({ logger: true });

app.get('/api/config', async () => {
  const photosRaw = readJSON(join(DATA_DIR, 'photos.json'));
  const photos = Array.isArray(photosRaw) ? photosRaw : (photosRaw.photos ?? []);
  const thoughtsRaw = readJSON(join(DATA_DIR, 'thoughts.json'));
  const thoughts = Array.isArray(thoughtsRaw) ? thoughtsRaw : (thoughtsRaw.thoughts ?? []);
  return { photos, thoughts };
});

app.post<{ Body: { photos: unknown } }>('/api/save-photos', async (req, reply) => {
  if (!auth(req, reply)) return;
  const { photos } = req.body;
  if (!Array.isArray(photos)) return reply.status(400).send({ error: 'photos must be an array' });
  writeJSON(join(DATA_DIR, 'photos.json'), { photos });
  try { writeJSON(join(CONFIG_DIR, 'photos.json'), { photos }); } catch {}
  return { ok: true };
});

app.post<{ Body: { thoughts: unknown } }>('/api/save-thoughts', async (req, reply) => {
  if (!auth(req, reply)) return;
  const { thoughts } = req.body;
  if (!Array.isArray(thoughts)) return reply.status(400).send({ error: 'thoughts must be an array' });
  writeJSON(join(DATA_DIR, 'thoughts.json'), thoughts);
  try { writeJSON(join(CONFIG_DIR, 'thoughts.json'), thoughts); } catch {}
  return { ok: true };
});

async function start() {
  await app.register(fastifyMultipart);

  app.post('/api/upload', async (req, reply) => {
    if (!auth(req, reply)) return;

    const file = await req.file();
    if (!file) return reply.status(400).send({ error: 'no file' });

    const ext = extname(file.filename) || '.jpg';
    const filename = `${Date.now()}-${randomBytes(3).toString('hex')}${ext}`;
    const dest = join(PHOTOS_DIR, filename);

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) chunks.push(chunk);
    writeFileSync(dest, Buffer.concat(chunks));

    return { path: `/photos/${filename}` };
  });

  await app.register(fastifyStatic, {
    root: DIST_DIR,
    prefix: '/',
  });

  await app.register(fastifyStatic, {
    root: PHOTOS_DIR,
    prefix: '/photos/',
    decorateReply: false,
  });

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'not found' });
    }
    try {
      const html = readFileSync(join(DIST_DIR, 'index.html'), 'utf-8');
      return reply.type('text/html').send(html);
    } catch {
      return reply.status(500).send({ error: 'static build not found — run pnpm build first' });
    }
  });

  app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}

start();
