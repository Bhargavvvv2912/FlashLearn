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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "flashlearn-selection") {
    chrome.storage.local.set({ selectedText: info.selectionText }, () => {
      chrome.sidePanel.open({ tabId: tab.id });
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_PANEL') {
    chrome.storage.local.set({ selectedText: msg.text }, () => {
      chrome.sidePanel.open({ tabId: sender.tab.id }, () => {
        if (chrome.runtime.lastError) {
          console.error('sidePanel.open error:', chrome.runtime.lastError.message);
        }
      });
    });
    sendResponse({ ok: true });
    return true;
  }
});