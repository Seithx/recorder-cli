/**
 * POC: Direct gRPC-Web API approach
 * Extracts auth from a logged-in Chrome session, then calls Google Recorder APIs directly.
 */
const puppeteer = require('puppeteer-core');
const https = require('https');
const crypto = require('crypto');

// ============================================
// Auth Helper: Generate SAPISIDHASH
// ============================================
function generateSAPISIDHASH(sapisid, origin) {
  const timestamp = Math.floor(Date.now() / 1000);
  const input = `${timestamp} ${sapisid} ${origin}`;
  const hash = crypto.createHash('sha1').update(input).digest('hex');
  return `${timestamp}_${hash}`;
}

// ============================================
// HTTP Helper: Make gRPC-Web request
// ============================================
function makeGrpcRequest(endpoint, body, authHeaders) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const postData = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json+protobuf',
        'X-User-Agent': 'grpc-web-javascript/0.1',
        'X-Goog-AuthUser': '0',
        ...authHeaders,
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), raw: data });
        } catch {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ============================================
// Extract auth from Chrome
// ============================================
async function extractAuth() {
  console.log('[1/4] Connecting to Chrome on port 9222...');
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  });

  const pages = await browser.pages();
  const recorderPage = pages.find(p =>
    p.url().includes('recorder.google.com') && !p.url().includes('/about')
  );

  if (!recorderPage) {
    throw new Error('No logged-in Recorder tab found.');
  }

  console.log(`  [OK] Found logged-in tab: ${await recorderPage.title()}`);

  const cookies = await recorderPage.cookies();
  const sapisid = cookies.find(c => c.name === 'SAPISID');
  if (!sapisid) throw new Error('SAPISID cookie not found.');

  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  browser.disconnect();
  return { sapisid: sapisid.value, cookieStr };
}

// ============================================
// API Config
// ============================================
const BASE_URL = 'https://pixelrecorder-pa.clients6.google.com/$rpc/java.com.google.wireless.android.pixel.recorder.protos.PlaybackService';
const API_KEY = 'AIzaSyCqafaaFzCP07GzWUSRw0oXErxSlrEX2Ro';
const ORIGIN = 'https://recorder.google.com';

function getAuthHeaders(sapisid, cookieStr) {
  const sapisidhash = generateSAPISIDHASH(sapisid, ORIGIN);
  return {
    'Authorization': `SAPISIDHASH ${sapisidhash}`,
    'X-Goog-Api-Key': API_KEY,
    'Cookie': cookieStr,
    'Origin': ORIGIN,
    'Referer': `${ORIGIN}/`,
  };
}

// ============================================
// API Functions
// ============================================
async function listRecordings(auth) {
  const now = Math.floor(Date.now() / 1000);
  // Body: [[unix_seconds, nanos], page_size]
  const body = [[now, 0], 10];
  return makeGrpcRequest(`${BASE_URL}/GetRecordingList`, body, getAuthHeaders(auth.sapisid, auth.cookieStr));
}

async function getRecordingInfo(auth, shareId) {
  return makeGrpcRequest(`${BASE_URL}/GetRecordingInfo`, [shareId], getAuthHeaders(auth.sapisid, auth.cookieStr));
}

async function getTranscription(auth, shareId) {
  return makeGrpcRequest(`${BASE_URL}/GetTranscription`, [shareId], getAuthHeaders(auth.sapisid, auth.cookieStr));
}

async function listLabels(auth) {
  return makeGrpcRequest(`${BASE_URL}/ListLabels`, [], getAuthHeaders(auth.sapisid, auth.cookieStr));
}

// ============================================
// Parse helpers (based on actual captured responses)
// ============================================
function parseRecordingList(data) {
  // Response structure: [ [rec1, rec2, ...], [rec3, rec4, ...] ]  (paginated)
  // Each recording at data[page][i]:
  //   [0] internalId, [1] title, [2] [created_s, created_ns], [3] [duration_s, duration_ns],
  //   [8] audioInfo, [9] [[tags]], [10] [[audioSegments]],
  //   [11] cloudId, [12] null, [13] shareId
  if (!Array.isArray(data)) return [];

  const recordings = [];
  for (const page of data) {
    if (!Array.isArray(page)) continue;
    // Check if this is a recording array (has string at [0]) or a page of recordings
    if (typeof page[0] === 'string') {
      // Single recording directly in data
      recordings.push(parseSingleRecording(page));
    } else if (Array.isArray(page[0])) {
      // Page of recordings
      for (const rec of page) {
        if (Array.isArray(rec)) recordings.push(parseSingleRecording(rec));
      }
    }
  }
  return recordings.filter(Boolean);
}

function parseSingleRecording(rec) {
  try {
    return {
      internalId: rec[0],
      title: rec[1],
      createdSec: rec[2] ? parseInt(rec[2][0]) : null,
      durationSec: rec[3] ? parseInt(rec[3][0]) : null,
      cloudId: rec[11] || null,
      shareId: rec[13] || null,
    };
  } catch {
    return null;
  }
}

function parseTranscription(data) {
  // Response: [[[words_array, lang_flag, lang_code], ...], ...]
  const segments = [];
  if (!Array.isArray(data)) return segments;

  function extract(arr) {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!Array.isArray(item)) continue;
      // Check if this looks like a words array: [[word, display, start, end, ...], ...]
      if (Array.isArray(item[0]) && Array.isArray(item[0][0]) && typeof item[0][0][0] === 'string') {
        const words = item[0];
        const lang = item[2] || '';
        let text = '';
        for (const w of words) {
          if (Array.isArray(w)) {
            // word[1] is the display text (with punctuation), word[0] is raw word
            text += (w[1] || w[0] || '') + ' ';
          }
        }
        if (text.trim()) {
          segments.push({ text: text.trim(), lang });
        }
      } else {
        extract(item);
      }
    }
  }

  extract(data);
  return segments;
}

// ============================================
// Main
// ============================================
async function main() {
  try {
    const auth = await extractAuth();
    console.log('  [OK] Auth extracted\n');

    // List labels
    console.log('[2/4] Listing labels...');
    const labels = await listLabels(auth);
    if (labels.status === 200) {
      console.log(`  [OK] Labels: ${JSON.stringify(labels.data)}\n`);
    } else {
      console.log(`  [WARNING] Labels returned ${labels.status}\n`);
    }

    // List recordings
    console.log('[3/4] Listing recordings...');
    const resp = await listRecordings(auth);

    if (resp.status !== 200) {
      console.log(`  [ERROR] Status ${resp.status}`);
      console.log(`  Response: ${resp.raw.substring(0, 500)}`);
      return;
    }

    const recordings = parseRecordingList(resp.data);
    console.log(`  [OK] Found ${recordings.length} recordings:\n`);

    recordings.forEach((r, i) => {
      const durMin = r.durationSec ? (r.durationSec / 60).toFixed(1) : '?';
      const date = r.createdSec ? new Date(r.createdSec * 1000).toLocaleDateString() : '';
      console.log(`  ${i + 1}. "${r.title}" (${durMin} min) - ${date}`);
      console.log(`     Share ID: ${r.shareId}`);
    });

    // Get transcript of first recording
    if (recordings.length > 0) {
      const first = recordings[0];
      const sid = first.shareId;
      console.log(`\n[4/4] Getting transcript for "${first.title}" (${sid})...`);

      if (!sid) {
        console.log('  [WARNING] No shareId found for this recording.');
        // Try with internalId or cloudId
        console.log(`  Trying with cloudId: ${first.cloudId}`);
      }

      const tResp = await getTranscription(auth, sid || first.cloudId || first.internalId);
      if (tResp.status === 200) {
        const segments = parseTranscription(tResp.data);
        console.log(`  [OK] Got ${segments.length} transcript segments:\n`);
        segments.slice(0, 15).forEach((s, i) => {
          console.log(`  [${s.lang}] ${s.text.substring(0, 150)}`);
        });
        if (segments.length > 15) console.log(`  ... and ${segments.length - 15} more segments`);
      } else {
        console.log(`  [ERROR] Transcript returned ${tResp.status}: ${tResp.raw.substring(0, 200)}`);
      }
    }

    console.log('\n[SUCCESS] Direct API approach works!');
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
  }
}

main();
