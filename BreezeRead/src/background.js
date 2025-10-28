// src/background.js
const API_BASE = 'http://localhost:8000'; // FastAPI 주소
const TTL_MS = 60 * 60 * 1000; // 1시간 캐시

async function getCache(url) {
  const key = `cache:${url}`;
  const obj = await chrome.storage.local.get(key);
  const hit = obj[key];
  if (!hit) return null;
  if (Date.now() - hit.t > TTL_MS) return null;
  return hit.data;
}

async function setCache(url, data) {
  const key = `cache:${url}`;
  await chrome.storage.local.set({ [key]: { t: Date.now(), data } });
}

async function analyzeArticle(payload) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(to);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'SNAP_ANALYZE') {
      const { url, title, body } = msg.payload || {};
      if (!url || !body) { sendResponse(null); return; }

      const cached = await getCache(url);
      if (cached) { sendResponse(cached); return; }

      try {
        const data = await analyzeArticle({ url, title, article: body, title });
        await setCache(url, data);
        sendResponse(data);
      } catch (e) {
        console.warn('analyze error:', e);
        sendResponse({ summary: '', read_time_min: 0, keywords: [] });
      }
      return;
    }
  })();
  return true; // async 응답 유지
});