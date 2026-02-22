# Recorder CLI

CLI tool for downloading transcripts and audio from [Google Recorder](https://recorder.google.com) via its gRPC-Web API.

Google Recorder is a voice recording app on Pixel phones that automatically transcribes recordings and syncs them to the cloud. This tool lets you download transcripts and audio files from the command line.

## Features

- List and search recordings
- Download individual or bulk transcripts (with speaker labels)
- Download audio files (m4a)
- Output in plain text or JSON format
- Speaker-labeled transcript segments with timestamps
- Multi-account support
- Persistent auth (file-based cookie storage)

## Prerequisites

- **Node.js** 18+
- **Google Chrome** installed
- **A Google account** with Recorder data (synced from a Pixel phone)

## Setup

```bash
npm install
```

To install globally:

```bash
npm link
```

Or run directly:

```bash
node cli.js <command>
```

## Authentication

The tool needs Google cookies from Chrome to authenticate. On first run, Chrome opens with a persistent profile for you to log in.

```bash
# Interactive auth (launches Chrome, you log in once)
node cli.js auth

# With specific account index (for multi-account users)
node cli.js auth --authuser 1

# Check if auth is still valid
node cli.js auth --check

# Clear saved credentials
node cli.js auth --clear
```

### How auth works

```
CLI starts
  |
  Check saved credentials (file-based)
  |-- Valid --> Use immediately (no Chrome needed)
  |-- Expired/missing --> Connect to Chrome on port 9222
        |-- Connected --> Extract fresh cookies
        |-- Not connected --> Launch Chrome with persistent profile
              |-- Session exists --> Auto-logged in
              |-- No session --> Prompt login, wait
```

Credentials saved to: `~/.config/recorder-cli/auth.json`
Chrome profile stored at: `%LOCALAPPDATA%\recorder-cli\chrome-profile`

## Commands

### `list` - List recent recordings

```bash
node cli.js list
node cli.js list --limit 50
node cli.js list --json
```

### `info <id>` - Show recording details

```bash
node cli.js info <recording-uuid>
node cli.js info <recording-uuid> --json
```

### `transcript <id>` - Download a transcript

```bash
# Print to stdout
node cli.js transcript <recording-uuid>

# Save to file
node cli.js transcript <recording-uuid> -o transcript.txt

# JSON output (includes speaker segments and timing)
node cli.js transcript <recording-uuid> --json

# Plain text (no speaker labels)
node cli.js transcript <recording-uuid> --plain
```

### `audio <id>` - Download audio

```bash
# Download with server-provided filename
node cli.js audio <recording-uuid>

# Save to specific file
node cli.js audio <recording-uuid> -o meeting.m4a
```

### `search <query>` - Search recordings by title

```bash
node cli.js search "meeting notes"
node cli.js search "meeting" --limit 5
node cli.js search "meeting" --json
```

### `download` - Bulk download transcripts

```bash
node cli.js download
node cli.js download -o ./transcripts
node cli.js download --limit 100
node cli.js download --since 2025-01-01
node cli.js download --skip-existing
node cli.js download --format json
node cli.js download -o ./transcripts --limit 50 --since 2025-12-01 --skip-existing
```

### `download-audio` - Bulk download audio files

```bash
node cli.js download-audio
node cli.js download-audio -o ./audio
node cli.js download-audio --limit 10
node cli.js download-audio --since 2025-01-01 --skip-existing
```

### `config` - Show configuration

```bash
node cli.js config
```

## Transcript Format

### Text format (default)

```
Recording: Feb 5 at 12:07 PM
Date: 2/5/2026, 12:07:30 PM
Duration: 33:12
ID: bf3451e0-4ea6-424e-8e77-fbef4c0fe17c

=== Transcript ===

[Speaker 1] (00:00)
Hello, welcome to today's meeting...

[Speaker 2] (01:23)
Thanks for having me...
```

### JSON format

```json
{
  "recording": {
    "id": "bf3451e0-...",
    "title": "Feb 5 at 12:07 PM",
    "date": "2026-02-05T22:07:30.207Z",
    "duration": "33:12"
  },
  "transcript": {
    "segments": [
      {
        "speaker": "Speaker 1",
        "text": "Hello, welcome to today's meeting...",
        "startTime": "00:00"
      }
    ],
    "rawText": "..."
  }
}
```

## API Endpoints

All gRPC-Web calls go to `pixelrecorder-pa.clients6.google.com`:

| Method | Body | Returns |
|--------|------|---------|
| `GetRecordingList` | `[[timestamp_s, ns], pageSize]` | Array of recording metadata |
| `GetRecordingInfo` | `[shareId]` | Single recording metadata |
| `GetTranscription` | `[shareId]` | Word-level transcript with timestamps |
| `GetAudioTag` | `[shareId]` | Speech/music/silence segments |
| `GetWaveform` | `[shareId]` | Waveform amplitude data |
| `ListLabels` | `[]` | User labels |
| `GetShareList` | `[shareId]` | Share permissions |

Audio downloads: `GET https://usercontent.recorder.google.com/download/playback/{id}?authuser={N}&download=true`

Auth: `SAPISIDHASH` header (SHA1 of timestamp + SAPISID cookie + origin) + Google API key.

## Project Structure

```
cli.js                 CLI entry point (commander.js)
lib/
  auth.js              Auth management (Chrome, cookies, SAPISIDHASH, file persistence)
  api.js               Recorder API client (gRPC-Web + audio download)
test-auth-flow.js      Integration test
```

## Troubleshooting

### "Not authenticated" error
Run `node cli.js auth` to set up or refresh your cookies.

### "AUTH_EXPIRED: 401"
Your cookies have expired. Re-authenticate: `node cli.js auth`

### "AUTH_EXPIRED: 403"
Wrong account index. Try: `node cli.js auth --authuser 1`

### "Audio not found (404)"
Refresh cookies. Audio uses a different endpoint that may be more sensitive to cookie freshness.

### No recordings shown
Make sure recordings are synced to the cloud at [recorder.google.com](https://recorder.google.com).

### "Invalid recording ID format"
IDs must be UUIDs. Use `node cli.js list` to find valid IDs.

## Acknowledgments

Inspired by [google-recorder-cli](https://github.com/dylantmoore/google-recorder-cli) by Dylan Moore, a TypeScript implementation using Playwright for browser auth and `better-sqlite3` for direct Chrome cookie extraction. This project reimplements the concept in plain JavaScript with `puppeteer-core`, adds file-based auth persistence, and targets a different goal: an automated pipeline for Hebrew transcription and summarization via Gemini.

## License

ISC
