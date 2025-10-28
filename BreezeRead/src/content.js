// src/content.js
if (!window.__snapbrief_injected) {
  window.__snapbrief_injected = true;

  function extractArticle() {
    const title =
      document.querySelector('#title_area')?.textContent?.trim() ||
      document.querySelector('h2')?.textContent?.trim() ||
      document.title?.replace(/ : 네이버 뉴스.*$/, '').trim() || '';

    const area = document.querySelector('#dic_area') || document.querySelector('article');
    if (!area) return null;

    const body = Array.from(area.querySelectorAll('p, span'))
      .map(n => n.textContent?.trim() || '')
      .filter(t => t && !/무단 전재|재배포|광고|사진=|Copyright/i.test(t))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!body || body.length < 50) return null;
    return { url: location.href, title, body };
  }

  function ensurePanel() {
    let panel = document.getElementById('snapbrief-panel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'snapbrief-panel';
    panel.innerHTML = `
      <div class="sb-header">
        <strong>SnapBrief</strong>
        <button class="sb-close" title="닫기">×</button>
      </div>
      <div class="sb-body">
        <div class="sb-summary">요약 로딩 중…</div>
        <div class="sb-meta">예상 읽기: <span class="sb-rt">—</span>분</div>
        <div class="sb-kw"></div>
      </div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('.sb-close')?.addEventListener('click', () => {
      panel.remove();
    });
    return panel;
  }

  async function run() {
    const payload = extractArticle();
    if (!payload) return;

    const panel = ensurePanel();

    chrome.runtime.sendMessage({ type: 'SNAP_ANALYZE', payload }, (res) => {
      if (!res) return;

      const sumEl = panel.querySelector('.sb-summary');
      const rtEl = panel.querySelector('.sb-rt');
      const kwEl = panel.querySelector('.sb-kw');

      sumEl.textContent = res.summary || '요약 없음';
      rtEl.textContent = (res.read_time_min ?? 0).toFixed ? res.read_time_min.toFixed(1) : res.read_time_min;

      kwEl.innerHTML = '';
      (res.keywords || []).slice(0, 6).forEach(k => {
        const chip = document.createElement('span');
        chip.className = 'sb-chip';
        chip.textContent = `#${k}`;
        kwEl.appendChild(chip);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  // 비동기 로드 대비 한번 더 시도(최대 1회)
  const mo = new MutationObserver((_m) => {
    run();
    mo.disconnect();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
}