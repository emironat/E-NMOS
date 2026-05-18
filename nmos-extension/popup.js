const urlInput = document.getElementById('url');
const openBtn  = document.getElementById('open');

// Restore last used URL
chrome.storage.local.get('lastUrl', data => {
  if (data.lastUrl) urlInput.value = data.lastUrl;
});

openBtn.addEventListener('click', () => {
  const url = urlInput.value.trim();
  chrome.storage.local.set({ lastUrl: url });
  const appUrl = chrome.runtime.getURL('app.html') + (url ? '?base=' + encodeURIComponent(url) : '');
  chrome.tabs.create({ url: appUrl });
  window.close();
});

urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') openBtn.click();
});
