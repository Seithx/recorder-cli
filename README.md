# Recorder CLI

CLI tool to interact with Google Recorder recordings via direct API calls. Extracts transcripts, lists recordings, and more - all without needing the browser UI.

## How It Works

Google Recorder's web app (`recorder.google.com`) uses gRPC-Web APIs behind the scenes. This tool calls those APIs directly using auth cookies from a Chrome session.

```
Chrome (persistent profile) --> extract cookies --> direct HTTPS API calls
     (login once)                (automatic)         (no browser needed)
```

## Prerequisites

- **Node.js** 18+
- **Google Chrome** installed
- **A Google account** with Recorder data (synced from a Pixel phone)

## Setup

```bash
npm install
```

## Usage

### Test the full flow

```bash
node test-auth-flow.js
```

On first run:
1. Chrome opens automatically with a dedicated profile
2. Log into your Google account in the Chrome window
3. Navigate to `recorder.google.com` if not redirected
4. The CLI detects login and proceeds

On subsequent runs:
- Chrome reuses the saved session (no login needed)
- If Chrome isn't running, it auto-launches with the saved profile

### What it does

- Lists all recordings with titles, dates, durations
- Downloads full transcripts with word-level timestamps
- Retrieves audio tags (speech/music/silence segments)
- Retrieves waveform data
- Paginates through all recordings automatically

## Project Structure

```
lib/
  auth.js              Auth management (Chrome launch, cookie extraction, SAPISIDHASH)
  api.js               Recorder API client (all gRPC-Web endpoints)
test-auth-flow.js      Integration test - run this first
poc-api-direct.js      PoC: direct API approach
poc-browser-automation.js  PoC: browser UI automation approach
inspect-recorder.js    Page inspection/discovery script
```

## Auth Flow

```
CLI starts
  |
  Try connect to Chrome on port 9222
  |-- Connected --> Check login (test API call)
  |     |-- Valid --> Proceed
  |     |-- Expired --> Prompt re-login, wait
  |-- Not connected --> Launch Chrome with persistent profile
        |-- Session exists --> Auto-logged in --> Proceed
        |-- No session --> Prompt login, wait
```

Session is stored in: `%LOCALAPPDATA%\recorder-cli\chrome-profile`

## API Endpoints

All calls go to `pixelrecorder-pa.clients6.google.com` via gRPC-Web:

| Method | Body | Returns |
|--------|------|---------|
| `GetRecordingList` | `[[timestamp_s, ns], pageSize]` | Array of recording metadata |
| `GetRecordingInfo` | `[shareId]` | Single recording metadata |
| `GetTranscription` | `[shareId]` | Word-level transcript with timestamps |
| `GetAudioTag` | `[shareId]` | Speech/music/silence segments |
| `GetWaveform` | `[shareId]` | Waveform amplitude data |
| `ListLabels` | `[]` | User labels (e.g., "favorite") |
| `GetShareList` | `[shareId]` | Share permissions |

Auth: `SAPISIDHASH` header (SHA1 of timestamp + SAPISID cookie + origin) + Google API key.

## Tech Details

- **Google Recorder frontend**: Lit (Web Components), Google Closure Compiler
- **API format**: `application/json+protobuf` (JSON-serialized protobuf)
- **Auth**: SAPISIDHASH derived from SAPISID cookie, rotated per-request
- **Chrome profile**: Persistent `--user-data-dir` keeps Google session alive for weeks
