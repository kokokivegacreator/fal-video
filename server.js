require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const falService = require('./services/fal');
const driveService = require('./services/drive');
const sheetsService = require('./services/sheets');

const app = express();
const PORT = process.env.PORT || 3100;
const JOBS_PATH = path.join(__dirname, 'jobs.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

falService.init();
driveService.init();
sheetsService.init();

// ─── Jobs Store ───
function loadJobs() {
  try { return JSON.parse(fs.readFileSync(JOBS_PATH, 'utf8')); }
  catch { return []; }
}

function saveJobs(jobs) {
  fs.writeFileSync(JOBS_PATH, JSON.stringify(jobs, null, 2));
}

function upsertJob(job) {
  const jobs = loadJobs();
  const idx = jobs.findIndex(j => j.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.unshift(job);
  saveJobs(jobs);
}

// ─── GET /api/sheets/channels ───
app.get('/api/sheets/channels', async (req, res) => {
  try {
    const channels = await sheetsService.getChannels();
    res.json(channels);
  } catch (err) {
    console.error('[Sheets] getChannels error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/sheets/data?row=N ───
app.get('/api/sheets/data', async (req, res) => {
  const { row } = req.query;
  if (!row) return res.status(400).json({ error: 'Missing ?row=N parameter' });
  try {
    const data = await sheetsService.getChannelData(row);
    res.json(data);
  } catch (err) {
    console.error('[Sheets] getChannelData error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/models ───
app.get('/api/models', (req, res) => {
  res.json(falService.MODELS);
});

// ─── GET /api/jobs ───
app.get('/api/jobs', (req, res) => {
  res.json(loadJobs());
});

// ─── GET /api/jobs/:id ───
app.get('/api/jobs/:id', (req, res) => {
  const job = loadJobs().find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ─── DELETE /api/jobs/:id ───
app.delete('/api/jobs/:id', (req, res) => {
  const jobs = loadJobs().filter(j => j.id !== req.params.id);
  saveJobs(jobs);
  res.json({ ok: true });
});

// ─── POST /api/generate ───
app.post('/api/generate', upload.single('image'), async (req, res) => {
  const jobId = uuidv4().split('-')[0];
  const { prompt = '', model = 'kling_pro', duration = '5', aspectRatio = '16:9' } = req.body;

  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  const job = {
    id: jobId,
    status: 'uploading',
    prompt,
    model,
    duration: Number(duration),
    aspectRatio,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [],
    falVideoUrl: null,
    driveUrl: null,
    downloadUrl: null,
    thumbnailUrl: null,
    error: null,
  };

  upsertJob(job);
  res.json({ jobId, status: 'uploading' });

  // Run async (don't await)
  runJob(job, req.file).catch(err => {
    console.error(`[Job ${jobId}] Fatal error:`, err.message);
  });
});

async function runJob(job, file) {
  const update = (patch) => {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    upsertJob(job);
  };

  try {
    // 1. Upload image to fal.ai storage
    update({ status: 'uploading', logs: [...job.logs, 'อัปโหลดรูปไปยัง fal.ai...'] });
    const imageUrl = await falService.uploadImageToFal(file.buffer, file.mimetype, file.originalname);
    update({ logs: [...job.logs, `อัปโหลดรูปสำเร็จ ✓`] });

    // 2. Generate video
    update({ status: 'generating', logs: [...job.logs, 'เริ่มสร้างวิดีโอ...'] });

    const { videoUrl } = await falService.generateVideo({
      imageUrl,
      prompt: job.prompt,
      model: job.model,
      duration: job.duration,
      aspectRatio: job.aspectRatio,
      onQueueUpdate: (qUpdate) => {
        if (qUpdate.status === 'IN_QUEUE') {
          update({ logs: [...job.logs, `รอคิว... (ตำแหน่ง ${qUpdate.queue_position ?? '?'})`] });
        } else if (qUpdate.status === 'IN_PROGRESS') {
          update({ status: 'generating', logs: [...job.logs, 'กำลังสร้างวิดีโอ...'] });
        }
      },
    });

    update({ falVideoUrl: videoUrl, logs: [...job.logs, 'สร้างวิดีโอสำเร็จ ✓'] });

    // 3. Upload to Google Drive
    update({ status: 'saving', logs: [...job.logs, 'บันทึกขึ้น Google Drive...'] });

    try {
      const driveResult = await driveService.uploadVideoFromUrl(videoUrl, job.id, job.prompt);
      update({
        status: 'done',
        driveUrl: driveResult.driveUrl,
        downloadUrl: driveResult.downloadUrl,
        thumbnailUrl: driveResult.thumbnailUrl,
        logs: [...job.logs, 'บันทึกลง Google Drive สำเร็จ ✓'],
      });
    } catch (driveErr) {
      // Drive failed but video exists — still mark partial success
      console.warn('[Drive] Upload failed:', driveErr.message);
      update({
        status: 'done',
        driveUrl: null,
        downloadUrl: videoUrl,
        logs: [...job.logs, `Drive upload ล้มเหลว: ${driveErr.message} — ใช้ fal.ai URL แทน`],
      });
    }
  } catch (err) {
    console.error(`[Job ${job.id}] Error:`, err.message);
    update({ status: 'error', error: err.message, logs: [...job.logs, `Error: ${err.message}`] });
  }
}

app.listen(PORT, () => {
  console.log(`\n🎬 fal.ai Video Generator running at http://localhost:${PORT}\n`);
});
