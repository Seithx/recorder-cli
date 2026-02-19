/**
 * Google Recorder API client.
 * Makes gRPC-Web calls to the Pixel Recorder backend.
 */
const https = require('https');
const { buildAuthHeaders } = require('./auth');

const BASE_URL = 'pixelrecorder-pa.clients6.google.com';
const SERVICE_PATH = '/$rpc/java.com.google.wireless.android.pixel.recorder.protos.PlaybackService';

// ============================================
// Low-level gRPC request
// ============================================
function rpc(method, body, auth) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const headers = buildAuthHeaders(auth.sapisid, auth.cookieStr);
    headers['Content-Length'] = Buffer.byteLength(postData);

    const req = https.request({
      hostname: BASE_URL,
      path: `${SERVICE_PATH}/${method}`,
      method: 'POST',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error(`AUTH_EXPIRED: ${res.statusCode} - Re-login needed`));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`API_ERROR: ${res.statusCode} - ${data.substring(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`PARSE_ERROR: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ============================================
// API Methods
// ============================================

async function listRecordings(auth, pageSize = 10, beforeTimestamp = null) {
  if (!beforeTimestamp) {
    beforeTimestamp = [Math.floor(Date.now() / 1000), 0];
  }
  const data = await rpc('GetRecordingList', [beforeTimestamp, pageSize], auth);
  return parseRecordingList(data);
}

async function getRecordingInfo(auth, shareId) {
  const data = await rpc('GetRecordingInfo', [shareId], auth);
  return parseSingleRecording(data);
}

async function getTranscription(auth, shareId) {
  const data = await rpc('GetTranscription', [shareId], auth);
  return parseTranscription(data);
}

async function getAudioTags(auth, shareId) {
  return rpc('GetAudioTag', [shareId], auth);
}

async function getWaveform(auth, shareId) {
  return rpc('GetWaveform', [shareId], auth);
}

async function listLabels(auth) {
  const data = await rpc('ListLabels', [], auth);
  if (!Array.isArray(data)) return [];
  return data.flat().filter(Array.isArray).map(l => ({ id: l[0], name: l[1] }));
}

async function getShareList(auth, shareId) {
  return rpc('GetShareList', [shareId], auth);
}

async function getGlobalSearchReadiness(auth) {
  return rpc('GetGlobalSearchReadiness', [], auth);
}

// ============================================
// Pagination: Get ALL recordings
// ============================================
async function listAllRecordings(auth, onPage = null) {
  const all = [];
  let beforeTimestamp = null;
  let page = 0;

  while (true) {
    const recordings = await listRecordings(auth, 10, beforeTimestamp);
    if (recordings.length === 0) break;

    all.push(...recordings);
    page++;
    if (onPage) onPage(page, recordings.length, all.length);

    // Use the last recording's timestamp for pagination
    const last = recordings[recordings.length - 1];
    if (last.createdSec) {
      beforeTimestamp = [last.createdSec, 0];
    } else {
      break;
    }

    // Safety: max 100 pages (1000 recordings)
    if (page >= 100) break;
  }

  return all;
}

// ============================================
// Parsers
// ============================================

function parseSingleRecording(rec) {
  if (!Array.isArray(rec)) return null;
  try {
    return {
      internalId: rec[0] || null,
      title: rec[1] || 'Untitled',
      createdSec: rec[2] ? parseInt(rec[2][0]) : null,
      createdDate: rec[2] ? new Date(parseInt(rec[2][0]) * 1000) : null,
      durationSec: rec[3] ? parseInt(rec[3][0]) : null,
      durationMin: rec[3] ? (parseInt(rec[3][0]) / 60).toFixed(1) : null,
      audioFormat: rec[8] || null,
      cloudId: rec[11] || null,
      shareId: rec[13] || null,
    };
  } catch {
    return null;
  }
}

function parseRecordingList(data) {
  if (!Array.isArray(data)) return [];
  const recordings = [];

  for (const page of data) {
    if (!Array.isArray(page)) continue;
    if (typeof page[0] === 'string') {
      // Single recording at top level
      const r = parseSingleRecording(page);
      if (r) recordings.push(r);
    } else if (Array.isArray(page[0])) {
      // Array of recordings
      for (const rec of page) {
        if (Array.isArray(rec)) {
          const r = parseSingleRecording(rec);
          if (r) recordings.push(r);
        }
      }
    }
  }
  return recordings;
}

function parseTranscription(data) {
  if (!Array.isArray(data)) return { segments: [], fullText: '' };

  const segments = [];

  function extract(arr) {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!Array.isArray(item)) continue;
      // Words array: [[word, display, startMs, endMs, ...], ...]
      if (Array.isArray(item[0]) && Array.isArray(item[0][0]) && typeof item[0][0][0] === 'string') {
        const words = item[0];
        const lang = item[2] || '';
        const wordDetails = [];
        let text = '';

        for (const w of words) {
          if (Array.isArray(w)) {
            const display = w[1] || w[0] || '';
            const startMs = w[2] ? parseInt(w[2]) : null;
            const endMs = w[3] ? parseInt(w[3]) : null;
            text += display + ' ';
            wordDetails.push({ word: w[0], display, startMs, endMs });
          }
        }

        if (text.trim()) {
          segments.push({
            text: text.trim(),
            lang,
            words: wordDetails,
            startMs: wordDetails[0]?.startMs || null,
            endMs: wordDetails[wordDetails.length - 1]?.endMs || null,
          });
        }
      } else {
        extract(item);
      }
    }
  }

  extract(data);

  const fullText = segments.map(s => s.text).join('\n');
  return { segments, fullText };
}

module.exports = {
  listRecordings,
  listAllRecordings,
  getRecordingInfo,
  getTranscription,
  getAudioTags,
  getWaveform,
  listLabels,
  getShareList,
  getGlobalSearchReadiness,
  rpc,
};
