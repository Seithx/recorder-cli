/**
 * Google Recorder API client.
 * Makes gRPC-Web calls to the Pixel Recorder backend.
 * Also supports audio download from the usercontent endpoint.
 */
const https = require('https');
const { buildAuthHeaders } = require('./auth');

const BASE_URL = 'pixelrecorder-pa.clients6.google.com';
const AUDIO_HOST = 'usercontent.recorder.google.com';
const SERVICE_PATH = '/$rpc/java.com.google.wireless.android.pixel.recorder.protos.PlaybackService';

// UUID format for recording IDs
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id) {
  return UUID_REGEX.test(id);
}

// ============================================
// Low-level gRPC request
// ============================================
function rpc(method, body, auth) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const headers = buildAuthHeaders(auth.sapisid, auth.cookieStr, auth.authUser || 0);
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
    beforeTimestamp = [Math.floor(Date.now() / 1000).toString(), 0];
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
// Audio download (from usercontent endpoint)
// ============================================
function downloadAudio(auth, recordingId, authUser) {
  const au = authUser || auth.authUser || 0;
  return new Promise((resolve, reject) => {
    const reqPath = `/download/playback/${recordingId}?authuser=${au}&download=true`;
    const req = https.request({
      hostname: AUDIO_HOST,
      path: reqPath,
      method: 'GET',
      headers: {
        'Cookie': auth.cookieStr,
      },
    }, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        const location = res.headers.location;
        if (location) {
          // Follow redirect
          const url = new URL(location);
          const redirectReq = https.request({
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'GET',
            headers: { 'Cookie': auth.cookieStr },
          }, (rRes) => {
            if (rRes.statusCode !== 200) {
              reject(new Error(`Audio download failed: ${rRes.statusCode}`));
              return;
            }
            collectAudioResponse(rRes, resolve, reject);
          });
          redirectReq.on('error', reject);
          redirectReq.end();
          return;
        }
      }

      if (res.statusCode === 401 || res.statusCode === 403) {
        reject(new Error(`AUTH_EXPIRED: ${res.statusCode} - Re-login needed`));
        return;
      }
      if (res.statusCode === 404) {
        reject(new Error('Audio not found (404). Try refreshing auth cookies.'));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Audio download failed: ${res.statusCode}`));
        return;
      }

      collectAudioResponse(res, resolve, reject);
    });

    req.on('error', reject);
    req.end();
  });
}

function collectAudioResponse(res, resolve, reject) {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => {
    const buffer = Buffer.concat(chunks);
    // Extract filename from Content-Disposition header
    const disposition = res.headers['content-disposition'] || '';
    let filename = null;
    const match = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
    if (match) {
      filename = decodeURIComponent(match[1].replace(/"/g, ''));
    }
    resolve({ buffer, filename, contentType: res.headers['content-type'] });
  });
  res.on('error', reject);
}

// ============================================
// Pagination: Get ALL recordings
// ============================================
async function listAllRecordings(auth, options = {}) {
  const { limit = Infinity, since = null, onPage = null } = options;
  const all = [];
  let beforeTimestamp = null;
  let page = 0;
  const sinceDate = since ? new Date(since) : null;

  while (all.length < limit) {
    const pageSize = Math.min(50, limit - all.length);
    const recordings = await listRecordings(auth, pageSize, beforeTimestamp);
    if (recordings.length === 0) break;

    for (const rec of recordings) {
      // Filter by date if --since specified
      if (sinceDate && rec.createdDate && rec.createdDate < sinceDate) {
        return all; // Past the date cutoff, stop
      }
      all.push(rec);
      if (all.length >= limit) break;
    }

    page++;
    if (onPage) onPage(page, recordings.length, all.length);

    // Use the last recording's timestamp for pagination
    const last = recordings[recordings.length - 1];
    if (last.createdSec) {
      beforeTimestamp = [last.createdSec.toString(), 0];
    } else {
      break;
    }

    // Safety: max 200 pages
    if (page >= 200) break;
  }

  return all;
}

// ============================================
// Parsers
// ============================================

function parseSingleRecording(rec) {
  if (!Array.isArray(rec)) return null;
  try {
    const durationSec = rec[3] ? parseInt(rec[3][0]) : null;
    return {
      internalId: rec[0] || null,
      title: rec[1] || 'Untitled',
      createdSec: rec[2] ? parseInt(rec[2][0]) : null,
      createdDate: rec[2] ? new Date(parseInt(rec[2][0]) * 1000) : null,
      durationSec,
      duration: durationSec ? formatDuration(durationSec * 1000) : null,
      latitude: rec[4] || null,
      longitude: rec[5] || null,
      location: rec[6] || null,
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
      // Words array: [[word, display, startMs, endMs, ...], ...], speakerId, language
      if (Array.isArray(item[0]) && Array.isArray(item[0][0]) && typeof item[0][0][0] === 'string') {
        const words = item[0];
        const speakerId = typeof item[1] === 'number' ? item[1] : null;
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
            speaker: speakerId !== null ? `Speaker ${speakerId + 1}` : null,
            speakerId,
            lang,
            words: wordDetails,
            startMs: wordDetails[0]?.startMs || null,
            endMs: wordDetails[wordDetails.length - 1]?.endMs || null,
            startTime: wordDetails[0]?.startMs != null ? formatTime(wordDetails[0].startMs) : null,
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

// ============================================
// Helpers
// ============================================

/**
 * Format milliseconds as human-readable duration (e.g., "5:23" or "1:02:15")
 */
function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Format milliseconds as timestamp (e.g., "00:00", "01:23", "1:02:15")
 */
function formatTime(ms) {
  return formatDuration(ms);
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
  downloadAudio,
  rpc,
  isValidUUID,
  formatDuration,
  formatTime,
};
