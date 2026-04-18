let btn = null;

function extractPageContent() {
  try {
    const wikiContent = document.querySelector('#mw-content-text');
    if (wikiContent) {
      const elements = wikiContent.querySelectorAll('h2, h3, p');
      let text = Array.from(elements).map(el => {
        if (el.tagName === 'H2' || el.tagName === 'H3') {
          const headline = el.querySelector('.mw-headline') || el;
          return '\n## ' + headline.innerText.trim();
        }
        return el.innerText.trim();
      }).filter(t => t.length > 20).join('\n\n');
      text = text.replace(/\[\d+\]/g, '').trim();
      return text.slice(0, 15000);
    }
    const main = document.querySelector('main') || document.querySelector('article') || document.body;
    return (main.innerText || '').replace(/\s{3,}/g, '\n\n').slice(0, 10000);
  } catch (e) {
    return '';
  }
}

/**
 * Finds searchText in the page by walking raw DOM text nodes (so citation
 * markers like [1][23] don't block the match), scrolls to it, and tries to
 * visually highlight it.  Returns true on success.
 */
function findAndScrollToAnchor(searchText) {
  const needle = searchText
    .replace(/\[\d+\]/g, '')   // strip citation markers
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (needle.length < 4) return false;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const tag = node.parentElement?.tagName?.toLowerCase?.() ?? '';
      if (['script', 'style', 'noscript', 'head'].includes(tag)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const segments = [];
  let haystack = '';
  let node;
  while ((node = walker.nextNode())) {
    const clean = node.textContent.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ');
    segments.push({ node, start: haystack.length, len: clean.length });
    haystack += clean;
  }

  const idx = haystack.toLowerCase().indexOf(needle);
  if (idx === -1) return false;

  const seg = segments.find(s => s.start <= idx && idx < s.start + s.len);
  if (!seg?.node?.parentElement) return false;

  // Scroll the matching element into the center of the viewport
  seg.node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Visually highlight by selecting the text in the DOM range
  try {
    const range = document.createRange();
    // Map the cleaned-text offset back to the raw text node offset
    const raw = seg.node.textContent;
    let rawPos = 0;
    let cleanPos = 0;
    const targetCleanPos = idx - seg.start;
    while (cleanPos < targetCleanPos && rawPos < raw.length) {
      const ciMatch = raw.slice(rawPos).match(/^\[\d+\]/);
      if (ciMatch) { rawPos += ciMatch[0].length; }
      else { rawPos++; cleanPos++; }
    }
    range.setStart(seg.node, Math.min(rawPos, raw.length - 1));
    range.setEnd(seg.node, Math.min(rawPos + needle.length, raw.length));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) { /* highlight is best-effort */ }

  return true;
}

// Listen for "Back to Source" scroll requests from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'SCROLL_TO_SOURCE' || !msg.anchor) return;

  const words = msg.anchor.trim().split(/\s+/);
  // Try progressively shorter slices so citation mid-sentence noise doesn't break the match
  const attempts = [
    msg.anchor,
    words.slice(0, 10).join(' '),
    words.slice(0, 6).join(' '),
    words.slice(0, 4).join(' '),
  ];

  for (const attempt of attempts) {
    if (attempt.length < 8) break;
    if (findAndScrollToAnchor(attempt)) return;
  }
});

document.addEventListener('mouseup', (e) => {
  // Don't react to mouseup events that originated from our own button
  if (btn && btn.contains(e.target)) return;

  const selection = window.getSelection();
  const text = selection?.toString().trim();

  if (text && text.length > 0) {
    if (!btn) {
      btn = document.createElement('button');
      btn.innerText = '⚡ FlashLearn';
      btn.style.cssText = `
        position: fixed; z-index: 999999;
        background: #01696f; color: white;
        border: none; border-radius: 8px;
        padding: 6px 12px; font-size: 13px;
        cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        font-family: system-ui, sans-serif;
        user-select: none;
      `;
      document.body.appendChild(btn);
    }

    const range = selection.getRangeAt(0).getBoundingClientRect();
    btn.style.top = `${range.top - 40}px`;
    btn.style.left = `${range.left}px`;
    btn.style.display = 'block';

    // Capture selected text now — it'll be cleared by the time onclick fires
    const captured = text;
    btn.onclick = () => {
      // chrome.runtime becomes undefined if the extension was reloaded
      // without refreshing this page — handle it gracefully
      if (!chrome?.runtime?.id) {
        btn.innerText = '↻ Refresh page first';
        btn.style.background = '#dc2626';
        setTimeout(() => location.reload(), 1200);
        return;
      }
      const pageContent = extractPageContent();
      chrome.runtime.sendMessage({
        type: 'OPEN_PANEL',
        text: captured,
        pageUrl: window.location.href,
        pageTitle: document.title,
        pageContent,
      });
      btn.style.display = 'none';
    };
  } else if (btn) {
    btn.style.display = 'none';
  }
});
