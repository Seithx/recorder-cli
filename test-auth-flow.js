/**
 * Test the full robust auth flow:
 * 1. Check if Chrome is running -> if not, launch it
 * 2. Check if logged in -> if not, wait for login
 * 3. Make API calls
 */
const { getAuth, PROFILE_DIR, CHROME_DEBUG_PORT } = require('./lib/auth');
const { listRecordings, getTranscription, listLabels } = require('./lib/api');

async function main() {
  console.log('=== Recorder CLI - Auth Flow Test ===\n');
  console.log(`Profile dir: ${PROFILE_DIR}`);
  console.log(`Debug port: ${CHROME_DEBUG_PORT}\n`);

  try {
    // Step 1: Get auth (handles everything: launch Chrome, wait for login, etc.)
    const auth = await getAuth();

    // Step 2: Use the API
    console.log('\n--- Testing API calls ---\n');

    // List labels
    const labels = await listLabels(auth);
    console.log(`Labels: ${labels.map(l => l.name).join(', ') || 'none'}`);

    // List recordings
    const recordings = await listRecordings(auth);
    console.log(`\nRecordings (${recordings.length}):`);
    recordings.forEach((r, i) => {
      const date = r.createdDate ? r.createdDate.toLocaleDateString() : '';
      console.log(`  ${i + 1}. "${r.title}" (${r.durationMin} min) - ${date}`);
      console.log(`     ID: ${r.shareId}`);
    });

    // Get transcript of first recording
    if (recordings.length > 0 && recordings[0].shareId) {
      const first = recordings[0];
      console.log(`\nTranscript for "${first.title}":`);
      const { segments, fullText } = await getTranscription(auth, first.shareId);
      console.log(`  ${segments.length} segments, ${fullText.length} chars`);
      console.log(`  First 200 chars: ${fullText.substring(0, 200)}...`);
    }

    console.log('\n[SUCCESS] Full auth flow works!');

    // Step 3: Test auth persistence - run this script again without re-logging in
    console.log('\nTo test persistence:');
    console.log('  1. Close this script');
    console.log('  2. Run it again - should skip login');
    console.log('  3. Close Chrome, run again - should auto-launch and use saved session');

  } catch (err) {
    if (err.message.includes('AUTH_EXPIRED')) {
      console.log('\n[WARNING] Auth expired. Run again - it will prompt for re-login.');
    } else {
      console.error(`\n[ERROR] ${err.message}`);
    }
  }
}

main();
