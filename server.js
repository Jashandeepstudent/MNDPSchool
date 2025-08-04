const express = require('express');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true, limit: '100mb' }));
app.use(bodyParser.json({ limit: '100mb' }));
app.use('/', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure folders exist
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};
ensureDir(path.join(__dirname, 'uploads/images'));
ensureDir(path.join(__dirname, 'uploads/videos'));
ensureDir(path.join(__dirname, 'data'));

const contentPath = path.join(__dirname, 'data', 'content.json');

// Multer setup
const imageStorage = multer.diskStorage({
  destination: './uploads/images',
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const videoStorage = multer.diskStorage({
  destination: './uploads/videos',
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const bgStorage = multer.diskStorage({
  destination: './uploads',
  filename: (req, file, cb) => cb(null, 'background.jpg')
});

const uploadImages = multer({ storage: imageStorage }).array('images');
const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/ogg'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only MP4, WebM, and OGG formats are allowed.'));
  }
}).single('video');
const uploadBackground = multer({ storage: bgStorage }).single('background');

// Upload image
app.post('/upload-image', (req, res) => {
  uploadImages(req, res, (err) => {
    if (err || !req.files) return res.status(500).send({ error: err?.message || 'No files uploaded' });
    const urls = req.files.map(file => `/uploads/images/${file.filename}`);
    let content = fs.existsSync(contentPath) ? JSON.parse(fs.readFileSync(contentPath, 'utf8')) : {};
    content.galleryImages = Array.from(new Set([...(content.galleryImages || []), ...urls]));
    fs.writeFileSync(contentPath, JSON.stringify(content, null, 2));
    res.send({ files: urls });
  });
});

// Upload video
app.post('/upload-video', (req, res) => {
  uploadVideo(req, res, (err) => {
    if (err) return res.status(500).send({ error: err.message });
    if (!req.file) return res.status(400).send({ error: 'No video file uploaded.' });

    const url = `/uploads/videos/${req.file.filename}`;
    let content = fs.existsSync(contentPath) ? JSON.parse(fs.readFileSync(contentPath, 'utf8')) : {};
    content.galleryVideos = Array.from(new Set([...(content.galleryVideos || []), url]));
    fs.writeFileSync(contentPath, JSON.stringify(content, null, 2));
    res.send({ file: url });
  });
});

// Upload background
app.post('/upload-background', (req, res) => {
  uploadBackground(req, res, (err) => {
    if (err || !req.file) return res.status(500).send({ error: err?.message || 'No file uploaded' });
    let content = fs.existsSync(contentPath) ? JSON.parse(fs.readFileSync(contentPath, 'utf8')) : {};
    content.backgroundImage = '/uploads/background.jpg';
    fs.writeFileSync(contentPath, JSON.stringify(content, null, 2));
    res.send({ file: '/uploads/background.jpg' });
  });
});

// Save text content
app.post('/save-content', (req, res) => {
  const { section, title, desc } = req.body;
  let content = fs.existsSync(contentPath) ? JSON.parse(fs.readFileSync(contentPath, 'utf8')) : {};
  content[section] = { title, desc };
  fs.writeFileSync(contentPath, JSON.stringify(content, null, 2));
  res.send({ message: 'Content saved.' });
});

// Submit leave (with persistent cooldown)
app.post('/submit-leave', (req, res) => {
  const { name, roll } = req.body;
  if (!name || !roll) return res.status(400).send({ error: 'Missing name or roll' });

  const key = `${name}_${roll}`;
  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;

  let content = fs.existsSync(contentPath)
    ? JSON.parse(fs.readFileSync(contentPath, 'utf8'))
    : {};

  if (!content.leaveRecords) content.leaveRecords = {};

  const lastSubmit = content.leaveRecords[key];

  if (lastSubmit && now - lastSubmit < cooldown) {
    const remaining = cooldown - (now - lastSubmit);
    return res.status(429).send({ error: 'Leave already submitted', remaining });
  }

  content.leaveRecords[key] = now;
  fs.writeFileSync(contentPath, JSON.stringify(content, null, 2));
  res.send({ message: 'Leave submitted successfully', nextAllowed: now + cooldown });
});

// Leave status (for frontend to check cooldown after refresh)
app.get('/leave-status', (req, res) => {
  const { name, roll } = req.query;
  if (!name || !roll) return res.status(400).send({ error: 'Missing name or roll' });

  const key = `${name}_${roll}`;
  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;

  let content = fs.existsSync(contentPath)
    ? JSON.parse(fs.readFileSync(contentPath, 'utf8'))
    : {};

  const lastSubmit = content.leaveRecords?.[key];

  if (!lastSubmit) return res.send({ canSubmit: true });

  const remaining = cooldown - (now - lastSubmit);
  if (remaining > 0) {
    res.send({ canSubmit: false, remaining });
  } else {
    res.send({ canSubmit: true });
  }
});

// Load content
app.get('/load-content', (req, res) => {
  try {
    const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
    res.send(content);
  } catch (err) {
    res.status(500).send({ error: 'Error loading content.' });
  }
});

// Delete image
app.post('/delete-image', (req, res) => {
  const { url } = req.body;
  const filename = path.basename(url);
  const filepath = path.join(__dirname, 'uploads/images', filename);
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    let content = fs.existsSync(contentPath) ? JSON.parse(fs.readFileSync(contentPath, 'utf8')) : {};
    content.galleryImages = (content.galleryImages || []).filter(img => img !== url);
    fs.writeFileSync(contentPath, JSON.stringify(content, null, 2));
    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ error: 'Failed to delete image' });
  }
});

// Delete video
app.post('/delete-video', (req, res) => {
  const { url } = req.body;
  const filename = path.basename(url);
  const filepath = path.join(__dirname, 'uploads/videos', filename);
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    let content = fs.existsSync(contentPath) ? JSON.parse(fs.readFileSync(contentPath, 'utf8')) : {};
    content.galleryVideos = (content.galleryVideos || []).filter(vid => vid !== url);
    fs.writeFileSync(contentPath, JSON.stringify(content, null, 2));
    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ error: 'Failed to delete video' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
