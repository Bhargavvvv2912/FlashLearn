chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "flashlearn-selection",
    title: "⚡ Generate Flashcards from selection",
    contexts: ["selection"],
  });
});

// Extract page content function injected into the active tab
function extractPageContentInTab() {
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
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "flashlearn-selection") {
    // Extract page content via scripting, then open panel
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContentInTab,
    }).then(results => {
      const pageContent = results?.[0]?.result || '';
      chrome.storage.local.set({
        selectedText: info.selectionText,
        pageUrl: info.pageUrl || tab.url,
        pageTitle: tab.title || '',
        pageContent,
        tabId: tab.id,
      }, () => {
        chrome.sidePanel.open({ tabId: tab.id });
      });
    }).catch(() => {
      chrome.storage.local.set({
        selectedText: info.selectionText,
        pageUrl: tab.url || '',
        pageTitle: tab.title || '',
        pageContent: '',
        tabId: tab.id,
      }, () => {
        chrome.sidePanel.open({ tabId: tab.id });
      });
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_PANEL') {
    chrome.storage.local.set({
      selectedText: msg.text,
      pageUrl: msg.pageUrl || '',
      pageTitle: msg.pageTitle || '',
      pageContent: msg.pageContent || '',
      tabId: sender.tab.id,
    }, () => {
      chrome.sidePanel.open({ tabId: sender.tab.id }, () => {
        if (chrome.runtime.lastError) {
          console.error('sidePanel.open error:', chrome.runtime.lastError.message);
        }
      });
    });
    sendResponse({ ok: true });
    return true;
  }

  // Scroll to the source anchor in the originating tab
  if (msg.type === 'SCROLL_TO_SOURCE') {
    chrome.scripting.executeScript({
      target: { tabId: msg.tabId },
      func: (anchorText) => {
        // Use browser's built-in find to locate and highlight the text
        if (window.find(anchorText, false, false, true, false, true, false)) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            sel.getRangeAt(0).startContainer.parentElement?.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }
          return true;
        }
        // Fallback: try a shorter prefix (first 8 words)
        const shortAnchor = anchorText.split(' ').slice(0, 8).join(' ');
        if (window.find(shortAnchor)) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            sel.getRangeAt(0).startContainer.parentElement?.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }
          return true;
        }
        return false;
      },
      args: [msg.anchor],
    }).catch(console.error);
    sendResponse({ ok: true });
    return true;
  }
});
