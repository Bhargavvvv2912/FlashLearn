let btn = null;

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

    // Position near the selection
    const range = selection.getRangeAt(0).getBoundingClientRect();
    btn.style.top = `${range.top + window.scrollY - 40}px`;
    btn.style.left = `${range.left}px`;
    btn.style.display = 'block';

    btn.onclick = () => {
      chrome.runtime.sendMessage({ type: 'OPEN_PANEL', text });
      btn.style.display = 'none';
    };
  } else if (btn) {
    btn.style.display = 'none';
  }
});