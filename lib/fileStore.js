const fs = require('fs/promises');
const path = require('path');

const STORAGE_ROOT = path.join(__dirname, '..', 'root', 'excel-files');
const ALLOWED_EXT = new Set(['.xls', '.xlsx', '.xlsm', '.xlsb']);

const ensureStorage = async () => {
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
};

const sanitizeFileName = (name) => path.basename(name);

const uniqueName = async (name) => {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = `${base}${ext}`;
  let counter = 1;

  while (true) {
    try {
      await fs.access(path.join(STORAGE_ROOT, candidate));
      candidate = `${base} (${counter})${ext}`;
      counter += 1;
    } catch (err) {
      return candidate;
    }
  }
};

const listExcelFiles = async () => {
  await ensureStorage();
  const entries = await fs.readdir(STORAGE_ROOT, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) continue;
    const stat = await fs.stat(path.join(STORAGE_ROOT, entry.name));
    files.push({ name: entry.name, size: stat.size, mtime: stat.mtimeMs });
  }

  files.sort((a, b) => b.mtime - a.mtime);
  return files;
};

const getFilePath = (name) => path.join(STORAGE_ROOT, sanitizeFileName(name));

const deleteFile = async (name) => {
  const filePath = getFilePath(name);
  await fs.unlink(filePath);
};

module.exports = {
  STORAGE_ROOT,
  ALLOWED_EXT,
  ensureStorage,
  uniqueName,
  listExcelFiles,
  getFilePath,
  deleteFile,
  sanitizeFileName
};
