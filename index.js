const express = require('express');
const path = require('path');
const multer = require('multer');
const {
  STORAGE_ROOT,
  ALLOWED_EXT,
  ensureStorage,
  uniqueName,
  listExcelFiles,
  getFilePath,
  deleteFile,
  sanitizeFileName
} = require('./lib/fileStore');

const app = express();

const port = parseInt(process.env.PORT) || process.argv[3] || 8080;

app.use(express.static(path.join(__dirname, 'public')))
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'ejs');

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        await ensureStorage();
        cb(null, STORAGE_ROOT);
      } catch (err) {
        cb(err);
      }
    },
    filename: async (req, file, cb) => {
      try {
        const safeName = sanitizeFileName(file.originalname);
        const finalName = await uniqueName(safeName);
        cb(null, finalName);
      } catch (err) {
        cb(err);
      }
    }
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.has(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error('엑셀 파일만 업로드할 수 있어요.'));
  }
});

const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

app.get('/', (req, res) => {
  listExcelFiles()
    .then((files) => {
      const list = files.map((file) => ({
        name: file.name,
        sizeLabel: formatBytes(file.size),
        updatedLabel: new Date(file.mtime).toLocaleString()
      }));
      res.render('index', { files: list, error: null });
    })
    .catch((err) => {
      res.status(500).render('index', { files: [], error: err.message });
    });
});

app.post('/upload', (req, res) => {
  const handler = upload.single('excel');
  handler(req, res, async (err) => {
    if (err) {
      const files = await listExcelFiles().catch(() => []);
      const list = files.map((file) => ({
        name: file.name,
        sizeLabel: formatBytes(file.size),
        updatedLabel: new Date(file.mtime).toLocaleString()
      }));
      res.status(400).render('index', { files: list, error: err.message });
      return;
    }
    res.redirect('/');
  });
});

app.get('/files/:name/download', (req, res) => {
  const safeName = sanitizeFileName(req.params.name);
  const ext = path.extname(safeName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    res.status(400).send('허용되지 않은 파일 형식입니다.');
    return;
  }
  const filePath = getFilePath(safeName);
  res.download(filePath, safeName, (err) => {
    if (err) {
      res.status(404).send('파일을 찾을 수 없습니다.');
    }
  });
});

app.delete('/files/:name', async (req, res) => {
  const safeName = sanitizeFileName(req.params.name);
  try {
    await deleteFile(safeName);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ ok: false, message: '파일을 삭제할 수 없습니다.' });
  }
});

app.get('/api', (req, res) => {
  res.json({"msg": "Hello world"});
});

app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
})
