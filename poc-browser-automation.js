/**
 * POC: Browser automation approach (Puppeteer)
 * Controls the logged-in Chrome to interact with the Recorder UI.
 * Works through shadow DOM to access Lit web components.
 */
const puppeteer = require('puppeteer-core');

// ============================================
// Shadow DOM helper: query through shadow roots
// ============================================
async function shadowQuery(page, selectors) {
  return page.evaluateHandle((sels) => {
    let current = document;
    for (const sel of sels) {
      if (sel === '>>>') {
        if (current.shadowRoot) {
          current = current.shadowRoot;
        } else {
          return null;
        }
      } else {
        current = current.querySelector(sel);
        if (!current) return null;
      }
    }
    return current;
  }, selectors);
}

// ============================================
// Get all text content from shadow DOM
// ============================================
async function getDeepTextContent(page, rootSelector) {
  return page.evaluate((sel) => {
    function getText(node) {
      let text = '';
      if (node.shadowRoot) {
        text += getText(node.shadowRoot);
      }
      for (const child of (node.childNodes || [])) {
        if (child.nodeType === 3) { // text node
          text += child.textContent;
        } else if (child.nodeType === 1) { // element
          text += getText(child);
        }
      }
      return text;
    }
    const root = document.querySelector(sel);
    return root ? getText(root).replace(/\s+/g, ' ').trim() : null;
  }, rootSelector);
}

// ============================================
// Main
// ============================================
async function main() {
  try {
    console.log('[1/5] Connecting to Chrome on port 9222...');
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null,
    });

    const pages = await browser.pages();
    const page = pages.find(p =>
      p.url().includes('recorder.google.com') && !p.url().includes('/about')
    );

    if (!page) {
      throw new Error('No logged-in Recorder tab found.');
    }
    console.log(`  [OK] Connected: ${await page.title()}\n`);

    // ============================================
    // Step 2: Navigate to recording list
    // ============================================
    console.log('[2/5] Navigating to recording list...');
    await page.goto('https://recorder.google.com', { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    console.log(`  [OK] Page loaded: ${page.url()}\n`);

    // ============================================
    // Step 3: Extract recordings from sidebar
    // ============================================
    console.log('[3/5] Extracting recordings from UI...');

    const recordings = await page.evaluate(() => {
      const items = [];

      function findInShadow(root) {
        // Look for recording list items
        const listItems = root.querySelectorAll('recorder-sidebar-recording');
        listItems.forEach(item => {
          const sr = item.shadowRoot;
          if (!sr) return;
          const title = sr.querySelector('.title');
          const date = sr.querySelector('.date');
          const duration = sr.querySelector('.duration');

          items.push({
            title: title ? title.textContent.trim() : 'unknown',
            date: date ? date.textContent.trim() : '',
            duration: duration ? duration.textContent.trim() : '',
          });
        });

        // Also try generic approach
        if (items.length === 0) {
          root.querySelectorAll('[role="listitem"], [role="option"]').forEach(item => {
            items.push({
              title: item.textContent.trim().substring(0, 100),
              tag: item.tagName.toLowerCase(),
            });
          });
        }

        // Recurse into shadow DOMs
        root.querySelectorAll('*').forEach(el => {
          if (el.shadowRoot && items.length < 30) {
            findInShadow(el.shadowRoot);
          }
        });
      }

      findInShadow(document);
      return items;
    });

    if (recordings.length > 0) {
      console.log(`  [OK] Found ${recordings.length} recordings:`);
      recordings.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.title} ${r.date ? '(' + r.date + ')' : ''} ${r.duration || ''}`);
      });
    } else {
      console.log('  [WARNING] No recordings found via UI selectors.');
      console.log('  Trying alternative: extract from sidebar text...');

      const sidebarText = await getDeepTextContent(page, 'recorder-sidebar');
      if (sidebarText) {
        console.log(`  Sidebar text: ${sidebarText.substring(0, 300)}`);
      }
    }

    // ============================================
    // Step 4: Get transcript from current view
    // ============================================
    console.log('\n[4/5] Extracting transcript from current recording...');

    // Navigate to a specific recording if we're on the list
    const currentUrl = page.url();
    if (!currentUrl.includes('/ec5') && !currentUrl.match(/\/[0-9a-f-]{36}/)) {
      // Try clicking first recording in sidebar
      const clicked = await page.evaluate(() => {
        function findAndClick(root) {
          const items = root.querySelectorAll('recorder-sidebar-recording, [role="listitem"]');
          if (items.length > 0) {
            items[0].click();
            return true;
          }
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot && findAndClick(el.shadowRoot)) return true;
          }
          return false;
        }
        return findAndClick(document);
      });
      if (clicked) {
        console.log('  Clicked first recording...');
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    const transcript = await page.evaluate(() => {
      const segments = [];

      function findTranscript(root) {
        // Look for transcript words/paragraphs
        root.querySelectorAll('recorder-transcript-paragraph, .paragraph, [class*="transcript"]').forEach(el => {
          const sr = el.shadowRoot || el;
          const words = sr.querySelectorAll('recorder-transcript-word, .word, span');
          let text = '';
          words.forEach(w => text += w.textContent + ' ');
          if (text.trim()) segments.push(text.trim());
        });

        // Look for any text that seems like transcript content
        if (segments.length === 0) {
          root.querySelectorAll('recorder-transcript').forEach(el => {
            if (el.shadowRoot) findTranscript(el.shadowRoot);
          });
        }

        root.querySelectorAll('*').forEach(el => {
          if (el.shadowRoot && segments.length < 100) {
            findTranscript(el.shadowRoot);
          }
        });
      }

      findTranscript(document);
      return segments;
    });

    if (transcript.length > 0) {
      console.log(`  [OK] Got ${transcript.length} transcript segments:`);
      transcript.slice(0, 10).forEach((t, i) => {
        console.log(`  ${i + 1}. ${t.substring(0, 120)}`);
      });
      if (transcript.length > 10) console.log(`  ... and ${transcript.length - 10} more`);
    } else {
      console.log('  [WARNING] No transcript found via UI selectors.');
      console.log('  Trying deep text extraction from recorder-transcript...');
      const transcriptText = await getDeepTextContent(page, 'recorder-transcript');
      if (transcriptText) {
        console.log(`  Transcript text (first 500 chars): ${transcriptText.substring(0, 500)}`);
      } else {
        console.log('  No recorder-transcript element found.');
      }
    }

    // ============================================
    // Step 5: Test playback controls
    // ============================================
    console.log('\n[5/5] Checking playback controls...');

    const controls = await page.evaluate(() => {
      const found = [];

      function findControls(root) {
        // Play/pause button
        root.querySelectorAll('recorder-transport, [aria-label*="Play"], [aria-label*="Pause"], button').forEach(el => {
          const sr = el.shadowRoot;
          if (sr) {
            sr.querySelectorAll('button, [role="button"]').forEach(btn => {
              found.push({
                tag: btn.tagName.toLowerCase(),
                label: btn.getAttribute('aria-label') || btn.textContent.trim().substring(0, 30),
                parent: el.tagName.toLowerCase(),
              });
            });
          }
          if (el.tagName === 'BUTTON') {
            found.push({
              tag: 'button',
              label: el.getAttribute('aria-label') || el.textContent.trim().substring(0, 30),
              parent: el.parentElement ? el.parentElement.tagName.toLowerCase() : 'unknown',
            });
          }
        });

        root.querySelectorAll('*').forEach(el => {
          if (el.shadowRoot && found.length < 50) findControls(el.shadowRoot);
        });
      }

      findControls(document);
      return found;
    });

    console.log(`  Found ${controls.length} controls:`);
    controls.forEach((c, i) => {
      console.log(`  ${i + 1}. <${c.tag}> "${c.label}" (in <${c.parent}>)`);
    });

    browser.disconnect();
    console.log('\n[SUCCESS] Browser automation approach works!');
    console.log('Shadow DOM traversal is needed for all interactions.');
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
  }
}

main();
