const puppeteer = require('puppeteer-core');

(async () => {
  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null,
    });

    const pages = await browser.pages();
    console.log(`\n=== Found ${pages.length} tabs ===`);
    for (const p of pages) {
      console.log(`  - ${p.url()} | ${await p.title()}`);
    }

    // Find the recorder tab
    const recorderPage = pages.find(p =>
      p.url().includes('recorder.google.com') && !p.url().includes('/about')
    );

    if (!recorderPage) {
      console.log('\n[ERROR] No logged-in Recorder tab found.');
      console.log('Open https://recorder.google.com in your Chrome and log in first.');
      browser.disconnect();
      return;
    }

    console.log(`\n=== Inspecting: ${recorderPage.url()} ===\n`);

    // 1. Check frameworks & globals
    const appInfo = await recorderPage.evaluate(() => {
      const info = {};

      // Check for common frameworks
      info.hasReact = !!(window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot]'));
      info.hasAngular = !!(window.ng || window.getAllAngularRootElements);
      info.hasVue = !!(window.__VUE__);
      info.hasPolymer = !!(window.Polymer);
      info.hasLit = !!(window.litElementVersions);
      info.hasjQuery = !!(window.jQuery);

      // Check for webpack
      info.hasWebpack = !!(window.webpackJsonp || window.__webpack_modules__ || window.webpackChunk);
      info.webpackChunkNames = Object.keys(window).filter(k => k.includes('webpack'));

      // Check for Google Closure
      info.hasClosure = !!(window.goog);
      info.hasGoogleMaps = !!(window.google && window.google.maps);

      // Check for Service Workers
      info.hasServiceWorker = !!navigator.serviceWorker.controller;

      // Check all global variables (non-default)
      const defaultGlobals = new Set(['window','self','document','name','location','customElements','history','navigation','locationbar','menubar','personalbar','scrollbars','statusbar','toolbar','status','closed','frames','length','top','opener','parent','frameElement','navigator','origin','external','screen','visualViewport','innerWidth','innerHeight','outerWidth','outerHeight','devicePixelRatio','clientInformation','screenX','screenY','screenLeft','screenTop','pageXOffset','pageYOffset','scrollX','scrollY','crypto','indexedDB','sessionStorage','localStorage','chrome','performance','getComputedStyle','matchMedia','moveTo','moveBy','resizeTo','resizeBy','scroll','scrollTo','scrollBy','alert','confirm','prompt','print','postMessage','open','close','stop','focus','blur','getSelection','find','createImageBitmap','setTimeout','clearTimeout','setInterval','clearInterval','queueMicrotask','requestAnimationFrame','cancelAnimationFrame','requestIdleCallback','cancelIdleCallback','reportError','btoa','atob','structuredClone','fetch','isSecureContext','crossOriginIsolated','caches','cookieStore','scheduler','trustedTypes','speechSynthesis','onabort','onafterprint','onanimationend','onanimationiteration','onanimationstart','onbeforeprint','onbeforeunload','onblur','oncancel','oncanplay','oncanplaythrough','onchange','onclick','onclose','oncontentvisibilityautostatechange','oncontextlost','oncontextmenu','oncontextrestored','oncuechange','ondblclick','ondrag','ondragend','ondragenter','ondragleave','ondragover','ondragstart','ondrop','ondurationchange','onemptied','onerror','onfocus','onformdata','ongotpointercapture','onhashchange','oninput','oninvalid','onkeydown','onkeypress','onkeyup','onlanguagechange','onload','onloadeddata','onloadedmetadata','onloadstart','onlostpointercapture','onmessage','onmessageerror','onmousedown','onmouseenter','onmouseleave','onmousemove','onmouseout','onmouseover','onmouseup','onmousewheel','onoffline','ononline','onpagehide','onpagereveal','onpageshow','onpageswap','onpause','onplay','onplaying','onpointercancel','onpointerdown','onpointerenter','onpointerleave','onpointermove','onpointerout','onpointerover','onpointerrawupdate','onpointerup','onpopstate','onprogress','onratechange','onreset','onresize','onscroll','onscrollend','onscrollsnapchange','onscrollsnapchanging','onsearch','onsecuritypolicyviolation','onseeked','onseeking','onselect','onselectionchange','onselectstart','onslotchange','onstalled','onstorage','onsubmit','onsuspend','ontimeupdate','ontoggle','ontransitioncancel','ontransitionend','ontransitionrun','ontransitionstart','onunhandledrejection','onunload','onvolumechange','onwaiting','onwebkitanimationend','onwebkitanimationiteration','onwebkitanimationstart','onwebkittransitionend','onwheel']);

      info.customGlobals = Object.keys(window).filter(k => !defaultGlobals.has(k)).slice(0, 50);

      // Check DOM structure
      info.bodyClasses = document.body.className;
      info.bodyId = document.body.id;
      info.rootElement = document.body.firstElementChild ? {
        tag: document.body.firstElementChild.tagName,
        id: document.body.firstElementChild.id,
        class: document.body.firstElementChild.className
      } : null;

      // Count script tags
      const scripts = document.querySelectorAll('script[src]');
      info.scriptSrcs = Array.from(scripts).map(s => s.src).slice(0, 20);

      // Check meta tags
      const metas = document.querySelectorAll('meta');
      info.metaTags = Array.from(metas).map(m => ({
        name: m.name || m.getAttribute('property') || m.httpEquiv,
        content: (m.content || '').substring(0, 100)
      })).filter(m => m.name);

      // Check for protobuf / gRPC indicators
      info.hasProtobuf = !!(window.proto || window.jspb);

      // Check for IndexedDB databases
      info.idbDatabases = 'databases' in indexedDB ? 'supported' : 'not_queryable';

      return info;
    });

    console.log('=== Framework Detection ===');
    console.log(JSON.stringify(appInfo, null, 2));

    // 2. Check network - intercept API calls
    console.log('\n=== Script Sources ===');
    appInfo.scriptSrcs.forEach(s => console.log(`  ${s}`));

    // 3. Check for XHR/fetch endpoints
    const apiEndpoints = await recorderPage.evaluate(() => {
      // Check performance entries for API calls
      const entries = performance.getEntriesByType('resource');
      const apis = entries
        .filter(e => e.initiatorType === 'xmlhttprequest' || e.initiatorType === 'fetch')
        .map(e => e.name);
      return [...new Set(apis)].slice(0, 30);
    });

    console.log('\n=== API Endpoints (XHR/Fetch) ===');
    apiEndpoints.forEach(e => console.log(`  ${e}`));

    // 4. Check cookies
    const cookies = await recorderPage.cookies();
    console.log('\n=== Cookies ===');
    cookies.forEach(c => console.log(`  ${c.name} (domain: ${c.domain}, httpOnly: ${c.httpOnly}, secure: ${c.secure})`));

    // 5. Page HTML structure overview
    const htmlStructure = await recorderPage.evaluate(() => {
      const el = document.documentElement;
      return {
        lang: el.lang,
        dir: el.dir,
        doctype: document.doctype ? document.doctype.name : null,
        title: document.title,
        bodyChildCount: document.body.children.length,
        bodyChildren: Array.from(document.body.children).slice(0, 10).map(c => ({
          tag: c.tagName,
          id: c.id,
          class: c.className.substring(0, 100),
          childCount: c.children.length
        }))
      };
    });

    console.log('\n=== Page Structure ===');
    console.log(JSON.stringify(htmlStructure, null, 2));

    browser.disconnect();
    console.log('\n[OK] Done inspecting.');
  } catch (err) {
    console.error('[ERROR]', err.message);
  }
})();
