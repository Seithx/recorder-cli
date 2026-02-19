const puppeteer = require('puppeteer-core');

(async () => {
  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null,
    });

    const pages = await browser.pages();
    const recorderPage = pages.find(p =>
      p.url().includes('recorder.google.com') && !p.url().includes('/about')
    );

    if (!recorderPage) {
      console.log('[ERROR] No logged-in Recorder tab found.');
      browser.disconnect();
      return;
    }

    console.log(`[OK] Connected to: ${recorderPage.url()}\n`);

    // ============================================
    // 1. Capture auth headers and cookies
    // ============================================
    console.log('=== AUTH INFO ===');

    const authInfo = await recorderPage.evaluate(() => {
      return {
        XSRF_TOKEN: window.XSRF_TOKEN || null,
        XSRF_TOKEN_HEADER: window.XSRF_TOKEN_HEADER || null,
      };
    });
    console.log('XSRF_TOKEN:', authInfo.XSRF_TOKEN ? authInfo.XSRF_TOKEN.substring(0, 30) + '...' : 'null');
    console.log('XSRF_TOKEN_HEADER:', authInfo.XSRF_TOKEN_HEADER);

    const cookies = await recorderPage.cookies();
    const sapisid = cookies.find(c => c.name === 'SAPISID');
    const sid = cookies.find(c => c.name === 'SID');
    console.log('SAPISID:', sapisid ? sapisid.value.substring(0, 15) + '...' : 'not found');
    console.log('SID:', sid ? sid.value.substring(0, 15) + '...' : 'not found');
    console.log('Total cookies:', cookies.length);

    // ============================================
    // 2. Intercept network requests to capture gRPC calls
    // ============================================
    console.log('\n=== INTERCEPTING API CALLS ===');
    console.log('Navigating to recording list to trigger API calls...\n');

    const capturedRequests = [];

    // Enable request interception via CDP
    const cdpSession = await recorderPage.createCDPSession();
    await cdpSession.send('Network.enable');

    const requestBodies = {};

    cdpSession.on('Network.requestWillBeSent', (event) => {
      if (event.request.url.includes('$rpc') || event.request.url.includes('pixelrecorder')) {
        requestBodies[event.requestId] = {
          url: event.request.url,
          method: event.request.method,
          headers: event.request.headers,
          postData: event.request.postData ? event.request.postData.substring(0, 500) : null,
          postDataLength: event.request.postData ? event.request.postData.length : 0,
        };
      }
    });

    cdpSession.on('Network.responseReceived', (event) => {
      if (requestBodies[event.requestId]) {
        requestBodies[event.requestId].status = event.response.status;
        requestBodies[event.requestId].responseHeaders = event.response.headers;
        requestBodies[event.requestId].mimeType = event.response.mimeType;
      }
    });

    cdpSession.on('Network.loadingFinished', async (event) => {
      if (requestBodies[event.requestId]) {
        try {
          const resp = await cdpSession.send('Network.getResponseBody', { requestId: event.requestId });
          requestBodies[event.requestId].responseBody = resp.body ? resp.body.substring(0, 1000) : null;
          requestBodies[event.requestId].responseBase64 = resp.base64Encoded;
          requestBodies[event.requestId].responseSize = resp.body ? resp.body.length : 0;
        } catch (e) {
          requestBodies[event.requestId].responseError = e.message;
        }
        capturedRequests.push(requestBodies[event.requestId]);
      }
    });

    // Navigate to the main page to trigger GetRecordingList
    await recorderPage.goto('https://recorder.google.com', { waitUntil: 'networkidle2', timeout: 15000 });

    // Wait a bit for all requests to complete
    await new Promise(r => setTimeout(r, 3000));

    console.log(`Captured ${capturedRequests.length} API calls:\n`);

    for (const req of capturedRequests) {
      console.log('-------------------------------------------');
      console.log(`URL: ${req.url}`);
      console.log(`Method: ${req.method}`);
      console.log(`Status: ${req.status}`);
      console.log(`MIME: ${req.mimeType}`);
      console.log(`Response base64: ${req.responseBase64}`);
      console.log(`Response size: ${req.responseSize} chars`);

      // Print key headers
      const interestingHeaders = ['authorization', 'x-goog-authuser', 'content-type', 'x-goog-api-key', 'x-user-agent'];
      console.log('Key Request Headers:');
      for (const h of interestingHeaders) {
        const val = Object.entries(req.headers).find(([k]) => k.toLowerCase() === h);
        if (val) console.log(`  ${val[0]}: ${val[1].substring(0, 80)}`);
      }

      if (req.postData) {
        console.log(`Post Data (first 300 chars): ${req.postData.substring(0, 300)}`);
      }

      if (req.responseBody && !req.responseBase64) {
        console.log(`Response (first 500 chars): ${req.responseBody.substring(0, 500)}`);
      } else if (req.responseBase64) {
        console.log(`Response: [binary/base64, ${req.responseSize} chars encoded]`);
      }
      console.log('');
    }

    // ============================================
    // 3. Capture the full UI structure (shadow DOM)
    // ============================================
    console.log('\n=== UI STRUCTURE (Shadow DOM) ===\n');

    const uiStructure = await recorderPage.evaluate(() => {
      function walkDOM(node, depth = 0, maxDepth = 5) {
        if (depth > maxDepth) return null;
        const result = {
          tag: node.tagName ? node.tagName.toLowerCase() : '#text',
          id: node.id || undefined,
          class: node.className && typeof node.className === 'string' ? node.className.substring(0, 80) : undefined,
          hasShadow: !!node.shadowRoot,
          children: [],
        };

        // If element has shadow root, walk into it
        const root = node.shadowRoot || node;
        const children = root.children || [];

        for (let i = 0; i < Math.min(children.length, 15); i++) {
          const child = walkDOM(children[i], depth + 1, maxDepth);
          if (child) result.children.push(child);
        }

        // Clean up empty arrays
        if (result.children.length === 0) delete result.children;
        if (!result.id) delete result.id;
        if (!result.class) delete result.class;

        return result;
      }

      // Start from recorder-main
      const main = document.querySelector('recorder-main');
      if (!main) return { error: 'recorder-main not found' };
      return walkDOM(main, 0, 6);
    });

    console.log(JSON.stringify(uiStructure, null, 2));

    // ============================================
    // 4. List interactive elements
    // ============================================
    console.log('\n=== INTERACTIVE ELEMENTS ===\n');

    const interactiveElements = await recorderPage.evaluate(() => {
      const elements = [];
      function findInteractive(root) {
        const selectors = 'button, a[href], input, select, [role="button"], [role="tab"], [role="listitem"], [tabindex]';

        // Search in regular DOM
        root.querySelectorAll(selectors).forEach(el => {
          elements.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().substring(0, 50),
            role: el.getAttribute('role'),
            ariaLabel: el.getAttribute('aria-label'),
            href: el.href || undefined,
            type: el.type || undefined,
          });
        });

        // Search in shadow DOMs
        root.querySelectorAll('*').forEach(el => {
          if (el.shadowRoot) {
            findInteractive(el.shadowRoot);
          }
        });
      }

      const main = document.querySelector('recorder-main');
      if (main) {
        if (main.shadowRoot) findInteractive(main.shadowRoot);
        findInteractive(main);
      }
      // Also check body level
      findInteractive(document.body);

      return elements.slice(0, 50);
    });

    console.log(`Found ${interactiveElements.length} interactive elements:`);
    interactiveElements.forEach((el, i) => {
      const desc = el.ariaLabel || el.text || el.role || el.tag;
      console.log(`  ${i + 1}. <${el.tag}> ${desc}${el.href ? ' -> ' + el.href.substring(0, 60) : ''}`);
    });

    // ============================================
    // 5. Check for available recordings
    // ============================================
    console.log('\n=== RECORDING LIST ===\n');

    const recordings = await recorderPage.evaluate(() => {
      // Look for recording items in the DOM
      const items = [];
      function findRecordings(root) {
        root.querySelectorAll('[role="listitem"], [data-recording-id], .recording-item, recorder-recording-list-item').forEach(el => {
          items.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().substring(0, 100),
            id: el.getAttribute('data-recording-id') || el.id,
          });
        });
        root.querySelectorAll('*').forEach(el => {
          if (el.shadowRoot) findRecordings(el.shadowRoot);
        });
      }
      findRecordings(document.body);
      return items.slice(0, 20);
    });

    if (recordings.length > 0) {
      recordings.forEach((r, i) => console.log(`  ${i + 1}. ${r.text}`));
    } else {
      console.log('  No recordings found in DOM (might need deeper shadow DOM traversal)');
    }

    await cdpSession.detach();
    browser.disconnect();
    console.log('\n[OK] Capture complete.');
  } catch (err) {
    console.error('[ERROR]', err.message);
  }
})();
