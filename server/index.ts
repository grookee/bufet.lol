import Fastify from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
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

const db = new DatabaseSync(join(DATA_DIR, 'bufet.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS thoughts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    position INTEGER NOT NULL
  );
`);

function seedDatabase() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM photos').get() as { n: number };
  if (n > 0) return;

  const seedPath = join(CONFIG_DIR, 'seed.json');
  if (!existsSync(seedPath)) return;
  const seed = JSON.parse(readFileSync(seedPath, 'utf-8'));

  const insertPhoto = db.prepare('INSERT INTO photos (path, caption, position) VALUES (?, ?, ?)');
  const insertThought = db.prepare('INSERT INTO thoughts (text, position) VALUES (?, ?)');

  db.exec('BEGIN');
  try {
    (seed.photos ?? []).forEach((p: { path: string; caption?: string }, i: number) => {
      insertPhoto.run(p.path, p.caption ?? '', i);
    });
    (seed.thoughts ?? []).forEach((t: string, i: number) => {
      insertThought.run(t, i);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

seedDatabase();

function auth(req: { headers: { authorization?: string } }, reply: { status: (code: number) => { send: (body: unknown) => void } }): boolean {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    reply.status(401).send({ error: 'nope' });
    return false;
  }
  return true;
}

function getPhotos() {
  return db
    .prepare('SELECT path, caption FROM photos ORDER BY position')
    .all() as { path: string; caption: string }[];
}

function getThoughts() {
  return (db.prepare('SELECT text FROM thoughts ORDER BY position').all() as { text: string }[]).map((t) => t.text);
}

const app = Fastify({ logger: true });

app.get('/api/config', async () => {
  return { photos: getPhotos(), thoughts: getThoughts() };
});

app.post<{ Body: { photos: unknown } }>('/api/save-photos', async (req, reply) => {
  if (!auth(req, reply)) return;
  const { photos } = req.body;
  if (!Array.isArray(photos)) return reply.status(400).send({ error: 'photos must be an array' });

  const stmt = db.prepare('INSERT INTO photos (path, caption, position) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM photos');
    photos.forEach((p: unknown, i: number) => {
      const { path = '', caption = '' } = (p ?? {}) as { path?: string; caption?: string };
      stmt.run(String(path), String(caption), i);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true };
});

app.post<{ Body: { thoughts: unknown } }>('/api/save-thoughts', async (req, reply) => {
  if (!auth(req, reply)) return;
  const { thoughts } = req.body;
  if (!Array.isArray(thoughts)) return reply.status(400).send({ error: 'thoughts must be an array' });

  const stmt = db.prepare('INSERT INTO thoughts (text, position) VALUES (?, ?)');
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM thoughts');
    thoughts.forEach((t: unknown, i: number) => stmt.run(String(t), i));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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
