const APP_URL = 'https://flash-learn-three.vercel.app';
const frame = document.getElementById('flashlearn-frame');

frame.addEventListener('load', () => {
  // Nothing here now
});

// Every time the side panel opens, set the iframe src based on stored text
chrome.storage.local.get(['selectedText'], (result) => {
  const text = result.selectedText?.trim();
  if (text) {
    const url = `${APP_URL}/?selectedText=${encodeURIComponent(text)}`;
    frame.src = url;
    chrome.storage.local.remove('selectedText');
  } else {
    frame.src = APP_URL;
  }
});