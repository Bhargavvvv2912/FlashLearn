const APP_URL = 'https://flash-learn-three.vercel.app';
const frame = document.getElementById('flashlearn-frame');

let storedTabId = null;
let pendingContext = null;

// After iframe finishes loading, send the page context via postMessage
frame.addEventListener('load', () => {
  if (pendingContext) {
    // Small delay ensures React has fully hydrated
    setTimeout(() => {
      frame.contentWindow.postMessage(pendingContext, APP_URL);
      pendingContext = null;
    }, 150);
  }
});

// Listen for "Back to Source" requests from the iframe
window.addEventListener('message', (event) => {
  if (event.origin !== APP_URL) return;
  if (event.data?.type === 'FLASHLEARN_GOTO_SOURCE') {
    const { anchor } = event.data;
    if (storedTabId && anchor) {
      chrome.runtime.sendMessage({
        type: 'SCROLL_TO_SOURCE',
        tabId: storedTabId,
        anchor,
      });
    }
  }
});

// Read all stored context and set the iframe src
chrome.storage.local.get(
  ['selectedText', 'pageUrl', 'pageTitle', 'pageContent', 'tabId'],
  (result) => {
    storedTabId = result.tabId || null;
    const text = result.selectedText?.trim();

    // Prepare context payload to be sent after iframe loads
    if (result.pageContent || result.pageUrl) {
      pendingContext = {
        type: 'FLASHLEARN_CONTEXT',
        pageContent: result.pageContent || '',
        pageUrl: result.pageUrl || '',
        pageTitle: result.pageTitle || '',
      };
    }

    // Cache-buster: append timestamp so Chrome always fetches the latest Vercel deploy
    const bust = `_cb=${Date.now()}`;

    if (text) {
      frame.src = `${APP_URL}/?selectedText=${encodeURIComponent(text)}&${bust}`;
    } else {
      frame.src = `${APP_URL}/?${bust}`;
    }

    chrome.storage.local.remove([
      'selectedText',
      'pageUrl',
      'pageTitle',
      'pageContent',
      'tabId',
    ]);
  }
);
