#!/usr/bin/env node
/**
 * Recorder CLI - Google Recorder transcript & audio downloader.
 * Uses gRPC-Web API calls with Chrome cookie authentication.
 */
const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const { getAuth, checkAuth, clearAuthFile } = require('./lib/auth');
const {
  listRecordings,
  listAllRecordings,
  getRecordingInfo,
  getTranscription,
  downloadAudio,
  isValidUUID,
  formatDuration,
} = require('./lib/api');

const program = new Command();

program
  .name('recorder-cli')
  .description('CLI tool for downloading transcripts and audio from Google Recorder')
  .version('1.0.0');

// ============================================
// auth - Set up / check authentication
// ============================================
program
  .command('auth')
  .description('Authenticate with Google Recorder')
  .option('--check', 'Test existing authentication')
  .option('--clear', 'Clear saved credentials')
  .option('--authuser <n>', 'Google account index (0, 1, 2...)', '0')
  .action(async (opts) => {
    try {
      if (opts.clear) {
        clearAuthFile();
        console.log('[OK] Credentials cleared.');
        return;
      }

      if (opts.check) {
        const result = await checkAuth({ authUser: parseInt(opts.authuser) });
        if (result.authenticated) {
          console.log('[OK] ' + result.message);
          console.log('  Account index: ' + result.authUser);
          console.log('  Saved at: ' + result.savedAt);
        } else {
          console.log('[ERROR] ' + result.message);
          process.exitCode = 1;
        }
        return;
      }

      // Interactive auth
      const auth = await getAuth({
        authUser: parseInt(opts.authuser),
        forceChrome: true,
      });
      console.log('\n[OK] Authentication successful! Credentials saved.');
    } catch (err) {
      console.error('[ERROR] ' + err.message);
      process.exitCode = 1;
    }
  });

// ============================================
// list - List recent recordings
// ============================================
program
  .command('list')
  .description('List recent recordings')
  .option('-l, --limit <n>', 'Number of recordings to show', '20')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const auth = await getAuth({ silent: true });
      const limit = parseInt(opts.limit);
      const recordings = await listAllRecordings(auth, { limit });

      if (opts.json) {
        console.log(JSON.stringify(recordings, null, 2));
        return;
      }

      if (recordings.length === 0) {
        console.log('No recordings found.');
        return;
      }

      console.log(`Showing ${recordings.length} recording(s):\n`);
      for (const rec of recordings) {
        const date = rec.createdDate ? rec.createdDate.toLocaleDateString() : 'Unknown';
        const time = rec.createdDate ? rec.createdDate.toLocaleTimeString() : '';
        const dur = rec.duration || '?';
        const id = rec.shareId || rec.cloudId || rec.internalId || '?';
        const loc = rec.location ? ` | ${rec.location}` : '';
        console.log(`  ${rec.title}`);
        console.log(`    ${date} ${time} | ${dur}${loc}`);
        console.log(`    ID: ${id}`);
        console.log('');
      }
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// info <id> - Show recording details
// ============================================
program
  .command('info <id>')
  .description('Show details for a specific recording')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    try {
      if (!isValidUUID(id)) {
        console.error('[ERROR] Invalid recording ID format. Must be a UUID.');
        console.error('  Use `recorder-cli list` to find valid IDs.');
        process.exitCode = 1;
        return;
      }

      const auth = await getAuth({ silent: true });
      const info = await getRecordingInfo(auth, id);

      if (!info) {
        console.error('[ERROR] Recording not found.');
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }

      console.log(`Title:    ${info.title}`);
      console.log(`Date:     ${info.createdDate ? info.createdDate.toLocaleString() : 'Unknown'}`);
      console.log(`Duration: ${info.duration || '?'}`);
      console.log(`ID:       ${info.shareId || info.cloudId || info.internalId}`);
      if (info.location) console.log(`Location: ${info.location}`);
      if (info.latitude) console.log(`Coords:   ${info.latitude}, ${info.longitude}`);
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// transcript <id> - Download a transcript
// ============================================
program
  .command('transcript <id>')
  .description('Download transcript for a recording')
  .option('-o, --output <file>', 'Save to file instead of stdout')
  .option('--json', 'Output as JSON')
  .option('--plain', 'Plain text without speaker labels')
  .action(async (id, opts) => {
    try {
      if (!isValidUUID(id)) {
        console.error('[ERROR] Invalid recording ID format. Must be a UUID.');
        process.exitCode = 1;
        return;
      }

      const auth = await getAuth({ silent: true });

      // Get recording info for header
      const info = await getRecordingInfo(auth, id);
      const transcript = await getTranscription(auth, id);

      if (!transcript.segments.length) {
        console.log('No transcript available for this recording.');
        return;
      }

      if (opts.json) {
        const output = {
          recording: {
            id,
            title: info?.title || 'Unknown',
            date: info?.createdDate?.toISOString() || null,
            duration: info?.duration || null,
          },
          transcript: {
            recordingId: id,
            segments: transcript.segments.map(s => ({
              speaker: s.speaker,
              text: s.text,
              startTime: s.startTime,
            })),
            rawText: transcript.fullText,
          },
        };
        const jsonStr = JSON.stringify(output, null, 2);
        if (opts.output) {
          fs.writeFileSync(opts.output, jsonStr);
          console.log(`[OK] Transcript saved to ${opts.output}`);
        } else {
          console.log(jsonStr);
        }
        return;
      }

      // Text format
      let text = '';
      if (info) {
        text += `Recording: ${info.title}\n`;
        text += `Date: ${info.createdDate ? info.createdDate.toLocaleString() : 'Unknown'}\n`;
        text += `Duration: ${info.duration || '?'}\n`;
        text += `ID: ${id}\n\n`;
        text += `=== Transcript ===\n\n`;
      }

      if (opts.plain) {
        text += transcript.fullText;
      } else {
        for (const seg of transcript.segments) {
          const speaker = seg.speaker ? `[${seg.speaker}]` : '';
          const time = seg.startTime ? ` (${seg.startTime})` : '';
          if (speaker || time) {
            text += `${speaker}${time}\n`;
          }
          text += seg.text + '\n\n';
        }
      }

      if (opts.output) {
        fs.writeFileSync(opts.output, text);
        console.log(`[OK] Transcript saved to ${opts.output}`);
      } else {
        console.log(text);
      }
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// audio <id> - Download audio file
// ============================================
program
  .command('audio <id>')
  .description('Download audio for a recording')
  .option('-o, --output <file>', 'Save to specific file')
  .action(async (id, opts) => {
    try {
      if (!isValidUUID(id)) {
        console.error('[ERROR] Invalid recording ID format. Must be a UUID.');
        process.exitCode = 1;
        return;
      }

      const auth = await getAuth({ silent: true });
      console.log('Downloading audio...');

      const result = await downloadAudio(auth, id);
      const filename = opts.output || result.filename || `${id}.m4a`;

      fs.writeFileSync(filename, result.buffer);
      const sizeMB = (result.buffer.length / (1024 * 1024)).toFixed(2);
      console.log(`[OK] Audio saved to ${filename} (${sizeMB} MB)`);
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// search <query> - Search recordings by title
// ============================================
program
  .command('search <query>')
  .description('Search recordings by title')
  .option('-l, --limit <n>', 'Maximum results', '10')
  .option('--json', 'Output as JSON')
  .action(async (query, opts) => {
    try {
      const auth = await getAuth({ silent: true });
      const limit = parseInt(opts.limit);

      // Fetch all recordings and filter client-side (API has no search endpoint)
      const all = await listAllRecordings(auth, { limit: 500 });
      const q = query.toLowerCase();
      const matches = all.filter(r =>
        r.title && r.title.toLowerCase().includes(q)
      ).slice(0, limit);

      if (opts.json) {
        console.log(JSON.stringify(matches, null, 2));
        return;
      }

      if (matches.length === 0) {
        console.log(`No recordings matching "${query}".`);
        return;
      }

      console.log(`Found ${matches.length} recording(s) matching "${query}":\n`);
      for (const rec of matches) {
        const date = rec.createdDate ? rec.createdDate.toLocaleDateString() : 'Unknown';
        const dur = rec.duration || '?';
        const id = rec.shareId || rec.cloudId || rec.internalId || '?';
        console.log(`  ${rec.title}`);
        console.log(`    ${date} | ${dur} | ID: ${id}`);
        console.log('');
      }
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// download - Bulk download transcripts
// ============================================
program
  .command('download')
  .description('Bulk download transcripts')
  .option('-o, --output <dir>', 'Output directory', '.')
  .option('-l, --limit <n>', 'Maximum number of recordings', '20')
  .option('--since <date>', 'Only recordings after this date (YYYY-MM-DD)')
  .option('--format <fmt>', 'Output format: text or json', 'text')
  .option('--skip-existing', 'Skip files that already exist')
  .action(async (opts) => {
    try {
      const auth = await getAuth({ silent: true });
      const limit = parseInt(opts.limit);
      const outDir = opts.output;

      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      console.log('Fetching recording list...');
      const recordings = await listAllRecordings(auth, {
        limit,
        since: opts.since,
        onPage: (page, count, total) => {
          process.stdout.write(`  Page ${page}: ${total} recordings so far...\r`);
        },
      });
      console.log(`\nFound ${recordings.length} recording(s).\n`);

      let downloaded = 0;
      let skipped = 0;
      let failed = 0;

      for (const rec of recordings) {
        const id = rec.shareId || rec.cloudId;
        if (!id) { skipped++; continue; }

        const ext = opts.format === 'json' ? 'json' : 'txt';
        const safeName = (rec.title || id).replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
        const filename = `${safeName}.${ext}`;
        const filepath = path.join(outDir, filename);

        if (opts.skipExisting && fs.existsSync(filepath)) {
          skipped++;
          continue;
        }

        try {
          const transcript = await getTranscription(auth, id);
          if (!transcript.segments.length) {
            skipped++;
            continue;
          }

          let content;
          if (opts.format === 'json') {
            content = JSON.stringify({
              recording: {
                id,
                title: rec.title,
                date: rec.createdDate?.toISOString(),
                duration: rec.duration,
              },
              transcript: {
                segments: transcript.segments.map(s => ({
                  speaker: s.speaker,
                  text: s.text,
                  startTime: s.startTime,
                })),
                rawText: transcript.fullText,
              },
            }, null, 2);
          } else {
            let text = `Recording: ${rec.title}\n`;
            text += `Date: ${rec.createdDate ? rec.createdDate.toLocaleString() : 'Unknown'}\n`;
            text += `Duration: ${rec.duration || '?'}\n`;
            text += `ID: ${id}\n\n=== Transcript ===\n\n`;
            for (const seg of transcript.segments) {
              const speaker = seg.speaker ? `[${seg.speaker}]` : '';
              const time = seg.startTime ? ` (${seg.startTime})` : '';
              if (speaker || time) text += `${speaker}${time}\n`;
              text += seg.text + '\n\n';
            }
            content = text;
          }

          fs.writeFileSync(filepath, content);
          downloaded++;
          console.log(`  [OK] ${filename}`);
        } catch (err) {
          failed++;
          console.log(`  [ERROR] ${rec.title}: ${err.message}`);
        }
      }

      console.log(`\nDone! Downloaded: ${downloaded} | Skipped: ${skipped} | Failed: ${failed}`);
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// download-audio - Bulk download audio files
// ============================================
program
  .command('download-audio')
  .description('Bulk download audio files')
  .option('-o, --output <dir>', 'Output directory', '.')
  .option('-l, --limit <n>', 'Maximum number of recordings', '20')
  .option('--since <date>', 'Only recordings after this date (YYYY-MM-DD)')
  .option('--skip-existing', 'Skip files that already exist')
  .action(async (opts) => {
    try {
      const auth = await getAuth({ silent: true });
      const limit = parseInt(opts.limit);
      const outDir = opts.output;

      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      console.log('Fetching recording list...');
      const recordings = await listAllRecordings(auth, {
        limit,
        since: opts.since,
      });
      console.log(`Found ${recordings.length} recording(s).\n`);

      let downloaded = 0;
      let skipped = 0;
      let failed = 0;

      for (const rec of recordings) {
        const id = rec.shareId || rec.cloudId;
        if (!id) { skipped++; continue; }

        try {
          const result = await downloadAudio(auth, id);
          const filename = result.filename
            || `${(rec.title || id).replace(/[<>:"/\\|?*]/g, '_').substring(0, 100)}.m4a`;
          const filepath = path.join(outDir, filename);

          if (opts.skipExisting && fs.existsSync(filepath)) {
            skipped++;
            continue;
          }

          fs.writeFileSync(filepath, result.buffer);
          const sizeMB = (result.buffer.length / (1024 * 1024)).toFixed(2);
          downloaded++;
          console.log(`  [OK] ${filename} (${sizeMB} MB)`);
        } catch (err) {
          failed++;
          console.log(`  [ERROR] ${rec.title}: ${err.message}`);
        }
      }

      console.log(`\nDone! Downloaded: ${downloaded} | Skipped: ${skipped} | Failed: ${failed}`);
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// config - Show current configuration
// ============================================
program
  .command('config')
  .description('Show current configuration')
  .action(async () => {
    const { AUTH_FILE, PROFILE_DIR, CONFIG_DIR } = require('./lib/auth');
    console.log('Recorder CLI Configuration');
    console.log('=========================\n');
    console.log(`Auth file:      ${AUTH_FILE}`);
    console.log(`Chrome profile: ${PROFILE_DIR}`);
    console.log(`Config dir:     ${CONFIG_DIR}`);

    const authResult = await checkAuth();
    console.log(`\nAuthenticated:  ${authResult.authenticated ? 'Yes' : 'No'}`);
    if (authResult.savedAt) {
      console.log(`Saved at:       ${authResult.savedAt}`);
    }
    console.log(`Status:         ${authResult.message}`);
  });

// ============================================
// Error handler
// ============================================
function handleError(err) {
  if (err.message && err.message.includes('AUTH_EXPIRED')) {
    console.error('[ERROR] Authentication expired. Run `recorder-cli auth` to re-authenticate.');
  } else {
    console.error('[ERROR] ' + err.message);
  }
  process.exitCode = 1;
}

program.parse(process.argv);
