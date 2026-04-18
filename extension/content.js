let btn = null;

function extractPageContent() {
  // Wikipedia-specific: grab headings + paragraphs from article body
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
    // Strip citation markers like [1], [2]
    text = text.replace(/\[\d+\]/g, '').trim();
    return text.slice(0, 15000);
  }

  // Fallback for any other page
  const main = document.querySelector('main') || document.querySelector('article') || document.body;
  return (main.innerText || '').replace(/\s{3,}/g, '\n\n').slice(0, 10000);
}

document.addEventListener('mouseup', () => {
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
      `;
      document.body.appendChild(btn);
    }

    const range = selection.getRangeAt(0).getBoundingClientRect();
    btn.style.top = `${range.top + window.scrollY - 40}px`;
    btn.style.left = `${range.left}px`;
    btn.style.display = 'block';

    btn.onclick = () => {
      const pageContent = extractPageContent();
      chrome.runtime.sendMessage({
        type: 'OPEN_PANEL',
        text,
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
