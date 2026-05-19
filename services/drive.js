const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

let driveClient = null;

function init() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || './service-account.json';
  const resolvedPath = path.resolve(keyPath);

  if (!fs.existsSync(resolvedPath)) {
    console.warn('[Drive] service-account.json not found — Drive upload disabled');
    return;
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: resolvedPath,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  driveClient = google.drive({ version: 'v3', auth });
  console.log('[Drive] Google Drive client initialized');
}

async function downloadVideo(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  return Buffer.from(response.data);
}

async function uploadToDrive(videoBuffer, filename, mimeType = 'video/mp4') {
  if (!driveClient) {
    throw new Error('Google Drive not configured — add service-account.json and GOOGLE_SERVICE_ACCOUNT_JSON in .env');
  }

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const { Readable } = require('stream');

  const fileMetadata = {
    name: filename,
    parents: folderId ? [folderId] : [],
  };

  const media = {
    mimeType,
    body: Readable.from(videoBuffer),
  };

  const file = await driveClient.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id, name, webViewLink, webContentLink',
  });

  await driveClient.permissions.create({
    fileId: file.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  const driveId = file.data.id;
  const driveUrl = `https://drive.google.com/file/d/${driveId}/view`;
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;
  const thumbnailUrl = `https://drive.google.com/thumbnail?id=${driveId}&sz=w400`;

  return { driveId, driveUrl, downloadUrl, thumbnailUrl, filename: file.data.name };
}

async function uploadVideoFromUrl(falVideoUrl, jobId, prompt) {
  const safePrompt = (prompt || 'video').replace(/[^a-zA-Z0-9ก-๙\s]/g, '').trim().slice(0, 40) || 'video';
  const filename = `fal_${jobId}_${safePrompt.replace(/\s+/g, '_')}.mp4`;

  console.log(`[Drive] Downloading video from fal.ai...`);
  const buffer = await downloadVideo(falVideoUrl);

  console.log(`[Drive] Uploading ${filename} to Google Drive...`);
  const result = await uploadToDrive(buffer, filename);

  console.log(`[Drive] Uploaded: ${result.driveUrl}`);
  return result;
}

module.exports = { init, uploadVideoFromUrl };
