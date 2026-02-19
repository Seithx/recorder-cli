# Recorder CLI | Google Recorder API tool

## Project Overview
CLI tool that calls Google Recorder's gRPC-Web APIs directly | Extracts transcripts, lists recordings | Auth via persistent Chrome profile + SAPISIDHASH | No browser UI interaction needed after initial login

## Architecture
`lib/auth.js` - Chrome management, cookie extraction, SAPISIDHASH generation | `lib/api.js` - gRPC-Web client for all PlaybackService endpoints | Auth flow: check Chrome port 9222 -> extract cookies -> verify with test call -> fallback to launch/re-login

## Key Technical Details
API host: `pixelrecorder-pa.clients6.google.com` | Service: `PlaybackService` | Content-Type: `application/json+protobuf` | API key: `AIzaSyCqafaaFzCP07GzWUSRw0oXErxSlrEX2Ro` | Auth header: `SAPISIDHASH {timestamp}_{sha1(timestamp + SAPISID + origin)}` | Chrome profile: `%LOCALAPPDATA%\recorder-cli\chrome-profile` | Debug port: 9222

## Response Parsing
GetRecordingList returns `[ [rec1, rec2, ...], [more...] ]` | Recording fields: [0]=internalId [1]=title [2]=[created_s,ns] [3]=[duration_s,ns] [8]=audioInfo [11]=cloudId [13]=shareId | GetTranscription returns nested arrays of word segments: `[[[words], langFlag, langCode], ...]` | Word format: `[rawWord, displayText, startMs, endMs]`

## API Methods (lib/api.js)
`listRecordings(auth, pageSize, beforeTimestamp)` | `listAllRecordings(auth, onPage)` - paginated | `getTranscription(auth, shareId)` - returns `{segments, fullText}` | `getRecordingInfo(auth, shareId)` | `getAudioTags(auth, shareId)` | `getWaveform(auth, shareId)` | `listLabels(auth)` | `getShareList(auth, shareId)`

## Windows/Git Bash Notes
Use `cmd /c npx` for MCP servers (not bare `npx`) | `MSYS_NO_PATHCONV=1` to prevent `/c` -> `C:/` mangling | Chrome must use separate `--user-data-dir` (Chrome 136+ blocks debug on default profile) | `py` launcher for Python | ASCII symbols for console output: `[OK]` `[ERROR]` `[WARNING]` `[SUCCESS]`

## Dependencies
puppeteer-core | Node.js built-in: https, crypto, path, fs, child_process

## Frontend (for reference)
Google Recorder web app uses Lit (Web Components) | Root element: `<recorder-main>` with shadow DOM | Bundled via Google Closure Compiler (not webpack) | All UI elements are custom elements with shadow roots (`recorder-sidebar`, `recorder-transcript`, `recorder-controls`, etc.)
