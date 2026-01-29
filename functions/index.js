const functions = require("firebase-functions");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const Busboy = require("busboy");
const path = require("path");

admin.initializeApp();

const STORAGE_PREFIX = "excel-files/";
const ALLOWED_EXT = new Set([".xls", ".xlsx", ".xlsm", ".xlsb"]);

const sanitizeName = (name) => path.basename(name);

const uniqueObjectName = async (bucket, baseName) => {
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  let candidate = `${stem}${ext}`;
  let counter = 1;

  while (true) {
    const file = bucket.file(`${STORAGE_PREFIX}${candidate}`);
    const [exists] = await file.exists();
    if (!exists) return candidate;
    candidate = `${stem} (${counter})${ext}`;
    counter += 1;
  }
};

const listFiles = async (bucket) => {
  const [files] = await bucket.getFiles({ prefix: STORAGE_PREFIX });
  return files
    .filter((file) => {
      const name = file.name.replace(STORAGE_PREFIX, "");
      const ext = path.extname(name).toLowerCase();
      return ALLOWED_EXT.has(ext);
    })
    .map((file) => {
      const name = file.name.replace(STORAGE_PREFIX, "");
      return {
        name,
        size: Number(file.metadata.size || 0),
        updated: file.metadata.updated || null
      };
    })
    .sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));
};

exports.api = functions.https.onRequest(async (req, res) => {
  const bucket = admin.storage().bucket();
  const url = new URL(req.url, `https://${req.headers.host}`);
  const pathname = url.pathname.replace(/^\/api/, "");

  try {
    if (req.method === "GET" && pathname === "/files") {
      const files = await listFiles(bucket);
      res.json({ files });
      return;
    }

    if (req.method === "POST" && pathname === "/upload") {
      const busboy = Busboy({ headers: req.headers });
      let uploadPromise = null;

      busboy.on("file", (fieldname, file, info) => {
        if (fieldname !== "excel") {
          file.resume();
          return;
        }

        const originalName = sanitizeName(info.filename || "");
        const ext = path.extname(originalName).toLowerCase();
        if (!ALLOWED_EXT.has(ext)) {
          file.resume();
          res.status(400).json({ message: "엑셀 파일만 업로드할 수 있어요." });
          return;
        }

        uploadPromise = (async () => {
          const finalName = await uniqueObjectName(bucket, originalName);
          const objectName = `${STORAGE_PREFIX}${finalName}`;
          const storageFile = bucket.file(objectName);
          await new Promise((resolve, reject) => {
            const writeStream = storageFile.createWriteStream({
              metadata: { contentType: info.mimeType || "application/octet-stream" }
            });
            file.pipe(writeStream)
              .on("error", reject)
              .on("finish", resolve);
          });
          return { name: finalName };
        })();
      });

      busboy.on("finish", async () => {
        try {
          if (!uploadPromise) {
            res.status(400).json({ message: "업로드할 파일이 없습니다." });
            return;
          }
          const result = await uploadPromise;
          res.json({ ok: true, file: result });
        } catch (err) {
          logger.error(err);
          res.status(500).json({ message: "업로드에 실패했습니다." });
        }
      });

      req.pipe(busboy);
      return;
    }

    if (req.method === "DELETE" && pathname.startsWith("/files/")) {
      const rawName = decodeURIComponent(pathname.replace("/files/", ""));
      const safeName = sanitizeName(rawName);
      const ext = path.extname(safeName).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        res.status(400).json({ message: "허용되지 않은 파일 형식입니다." });
        return;
      }
      await bucket.file(`${STORAGE_PREFIX}${safeName}`).delete({ ignoreNotFound: true });
      res.json({ ok: true });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/files/") && pathname.endsWith("/download")) {
      const rawName = decodeURIComponent(pathname.replace("/files/", "").replace("/download", ""));
      const safeName = sanitizeName(rawName);
      const ext = path.extname(safeName).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        res.status(400).send("허용되지 않은 파일 형식입니다.");
        return;
      }
      const storageFile = bucket.file(`${STORAGE_PREFIX}${safeName}`);
      const [exists] = await storageFile.exists();
      if (!exists) {
        res.status(404).send("파일을 찾을 수 없습니다.");
        return;
      }
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`);
      storageFile.createReadStream().pipe(res);
      return;
    }

    res.status(404).json({ message: "Not found" });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});
