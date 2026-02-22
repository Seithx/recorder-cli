# TODO - Recorder CLI & Automation

## Goal
Automated pipeline: when a new Google Recorder recording is created, download the audio,
transcribe it in Hebrew (Gemini), summarize it (Gemini), save to Google Drive, and email
the summary to asafl@rh.co.il via Gmail.

## Architecture

```
[VPS with Chrome + Node.js]
        |
  [Cron / scheduler] -- every 5-15 min
        |
  [Poll Recorder API] -- any new recordings since last check?
        | yes
  [Download audio (m4a)]
        |
  [Gemini API] -- transcribe Hebrew + summarize
        |
  [Save transcript + summary to Google Drive]
        |
  [Send summary via Gmail to asafl@rh.co.il]
```

## Why VPS (not Vercel / Cloud Functions)
- Need persistent Chrome for cookie refresh (SAPISIDHASH auth)
- Vercel = serverless, no browser, no persistent filesystem
- Google Cloud Functions = same limitations
- VPS options: DigitalOcean, Hetzner, Linode (~$5/mo)
- Chrome runs headless on VPS for auto cookie refresh

## Phase 1 - Done (CLI)
- [x] Build proper CLI with commander.js (Issue #1)
- [x] Audio download from usercontent endpoint
- [x] Speaker diarization in transcript parsing
- [x] File-based auth persistence (~/.config/recorder-cli/auth.json)
- [x] Multi-account support (--authuser flag)
- [x] Client-side search (Issue #5)
- [x] Bulk download with --since, --skip-existing, --format
- [x] UUID validation, location data, duration formatting

## Phase 2 - Automation Pipeline
- [ ] Gemini integration (transcription + summarization)
  - `@google/generative-ai` package
  - Send m4a audio -> transcribe in Hebrew
  - Summarize transcript
  - Needs: Gemini API key
- [ ] Google Drive integration
  - `googleapis` package
  - Upload transcript + summary files
  - Needs: OAuth2 credentials or service account
- [ ] Gmail integration
  - Send summary email to asafl@rh.co.il
  - Needs: OAuth2 credentials (or SMTP with app password)
- [ ] Polling / scheduler
  - Track last-checked timestamp
  - Detect new recordings since last poll
  - Auto-retry on transient failures
- [ ] Auto cookie refresh (Issue #7)
  - Headless Chrome on VPS for automatic re-auth
  - Alert email if re-auth fails

## Phase 3 - VPS Deployment
- [ ] Choose VPS provider
- [ ] Set up Node.js + headless Chrome
- [ ] Deploy automation as systemd service or pm2 process
- [ ] Set up cron schedule
- [ ] Cross-platform support for Linux (Issue #2)
  - Chrome path: /usr/bin/google-chrome
  - Profile dir: ~/.local/share/recorder-cli/chrome-profile

## Remaining CLI Issues (lower priority)
- [ ] Add transcript export formats: SRT, VTT (Issue #3)
- [ ] Parse getAudioTags and getWaveform responses (Issue #4)
