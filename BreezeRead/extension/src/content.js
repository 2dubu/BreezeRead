// content.js
(async () => {
  const SIDEBAR_ID = "breezeread-sidebar";
  const TOGGLE_ID = "breezeread-toggle";
  const CONTAINER_ID = "breezeread-container";
  const LOGO_IMAGE = chrome.runtime.getURL("assets/breezecat.png");
  const SETTINGS_IMAGE = chrome.runtime.getURL("assets/setting.png");
  const CHEVRON_RIGHT = chrome.runtime.getURL("assets/chevron-right.png");
  const CHEVRON_LEFT = chrome.runtime.getURL("assets/chevron-left.png");

  // ✅ Cloud Run API 베이스 URL
  const API_BASE =
    "https://breezeread-api-866228904846.asia-northeast3.run.app";

  // ⭐️ [수정]: 최상위 컨테이너 ID를 기준으로 중복 실행 방지
  if (document.getElementById(CONTAINER_ID)) return;

  // HTML 및 CSS 가져오기
  const [htmlRes, cssRes] = await Promise.all([
    fetch(chrome.runtime.getURL("src/main.html")),
    fetch(chrome.runtime.getURL("src/style.css")),
  ]);
  const html = await htmlRes.text();
  const cssText = await cssRes.text();

  // 1. CSS 삽입
  const style = document.createElement("style");
  style.textContent = cssText;
  document.head.appendChild(style);

  // 2. 사이드바 컨테이너 생성 및 삽입
  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  document.body.appendChild(container);

  const sidebar = document.createElement("div");
  sidebar.id = SIDEBAR_ID;
  sidebar.innerHTML = html;
  container.appendChild(sidebar);

  // 익스텐션 환경에서 assets 폴더의 이미지를 사용하도록 런타임용 src를 설정
  try {
    const logoImg = sidebar.querySelector(".header-logo img");
    if (logoImg) {
      logoImg.src = LOGO_IMAGE;
      logoImg.alt = "BreezeRead Logo";
    }
    const settingsBtn = sidebar.querySelector("#settingsBtn");
    if (settingsBtn) {
      // 버튼 내부를 이미지로 교체
      settingsBtn.innerHTML = "";
      const img = document.createElement("img");
      img.src = SETTINGS_IMAGE;
      img.alt = "설정";
      settingsBtn.appendChild(img);
    }
  } catch (e) {
    // chrome.runtime 가 없거나 접근 불가한 환경에서는 무시
    console.debug("Could not set extension asset images", e);
  }

  // === ✅ BreezeRead 기능: 읽기 시간 + 요약 호출 ===

  // 현재 기사 URL 기준으로 읽기 시간 가져오기
  async function fetchReadTime(articleUrl) {
    const res = await fetch(`${API_BASE}/readtime/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: articleUrl }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`readtime 실패: ${res.status} ${err}`);
    }

    const data = await res.json();
    // main.py: return {"read_time_min": read_time_result}
    return data.read_time_min;
  }

  // 현재 기사 URL 기준으로 요약 가져오기
  async function fetchSummary(articleUrl) {
    const res = await fetch(`${API_BASE}/summarize/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: articleUrl, top_k: 3 }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`summarize 실패: ${res.status} ${err}`);
    }

    const data = await res.json();
    // main.py: sentences / indices / scores / abstract
    return data;
  }

  // UI에 읽기 시간 + 요약 반영하기
  async function runBreezeRead() {
    const articleUrl = window.location.href;

    const readTimeContainer = sidebar.querySelector("#readTime");
    const readTimeValue = readTimeContainer?.querySelector(".time-value");
    const summaryArea = sidebar.querySelector("#summaryArea");

    // 로딩 상태 표시
    if (readTimeValue) readTimeValue.textContent = "계산 중...";
    if (summaryArea) summaryArea.textContent = "요약 생성 중...";

    try {
      const [readTimeMin, summary] = await Promise.all([
        fetchReadTime(articleUrl),
        fetchSummary(articleUrl),
      ]);

      // 읽기 시간 UI 반영
      if (readTimeValue) {
        readTimeValue.textContent = `${readTimeMin}분`;
      }

      // 요약 UI 반영
      if (summaryArea) {
        const sentences = summary?.sentences || [];
        if (sentences.length === 0) {
          summaryArea.textContent = "요약할 문장을 찾지 못했어요.";
        } else {
          summaryArea.innerHTML = sentences
            .map((s) => `<p class="summary-sentence">• ${s}</p>`)
            .join("");
        }
      }
    } catch (e) {
      console.error("BreezeRead API 오류:", e);
      if (readTimeValue) readTimeValue.textContent = "오류";
      if (summaryArea) summaryArea.textContent = "요약 중 오류가 발생했습니다.";
    }
  }

  // 3. 토글 버튼 생성 (사이드바 외부, 컨테이너 내부에 위치)
  const toggleBtn = document.createElement("div");
  toggleBtn.id = TOGGLE_ID;

  const toggleIcon = document.createElement("img");
  toggleIcon.alt = "사이드바 토글";
  toggleIcon.src = CHEVRON_RIGHT;
  toggleBtn.appendChild(toggleIcon);

  // 초기 상태: 숨김 (collapsed)
  container.classList.add("collapsed");
  toggleIcon.src = CHEVRON_RIGHT;

  container.appendChild(toggleBtn);

  // 토글 기능
  const toggleSidebar = () => {
    const isCollapsed = container.classList.toggle("collapsed");
    toggleIcon.src = isCollapsed ? CHEVRON_RIGHT : CHEVRON_LEFT;
  };
  toggleBtn.onclick = toggleSidebar;
  
  // 4. 북마크 버튼 이벤트 핸들링 (chrome.storage 접근)
  const saveBtn = sidebar.querySelector(".saveBtn");
  const loadBtn = sidebar.querySelector(".loadBtn");

  // ⭐️ `saveBtn` 클릭 이벤트 리스너
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const articleTitle = document.querySelector('h2#title_area > span')?.textContent.trim() || '제목 없음';
      const articleUrl = window.location.href;
      
      const newBookmark = {
          title: articleTitle,
          url: articleUrl,
          timestamp: Date.now()
      };
      
      chrome.storage.local.get(["breezeReadBookmarks"], (result) => {
          const bookmarks = result.breezeReadBookmarks || [];
          
          if (bookmarks.some(b => b.url === articleUrl)) {
              alert("이미 북마크된 기사입니다!");
              return;
          }
          
          bookmarks.push(newBookmark);
          
          chrome.storage.local.set({ breezeReadBookmarks: bookmarks }, () => {
              console.log("북마크 저장 완료:", newBookmark.title);
              alert(`북마크 저장 완료: ${newBookmark.title}`);
          });
      });
    });
  }

  // ⭐️ `loadBtn` 클릭 이벤트 리스너
  if (loadBtn) {
    loadBtn.addEventListener("click", () => {
      chrome.storage.local.get(["breezeReadBookmarks"], (result) => {
        const bookmarks = result.breezeReadBookmarks || [];
        console.log("DB에서 불러온 북마크 목록:", bookmarks);
        
        // 🚨 수정된 부분: loadBtn의 결과로 사이드바 UI 업데이트가 이루어져야 합니다.
        // 현재는 alert만 뜨고 있으므로, 사이드바의 #bookmarkArea를 업데이트하는 로직을 추가하는 것이 좋습니다.
        
        const bookmarkArea = sidebar.querySelector("#bookmarkArea");
        
        if (bookmarkArea) {
            const ul = bookmarkArea.querySelector('.bookmark-list') || document.createElement('ul');
            ul.className = 'bookmark-list';
            
            if (bookmarks.length === 0) {
                ul.innerHTML = '<li class="no-bookmark-item">저장된 북마크가 없습니다.</li>';
            } else {
                // 최신 5개만 보여주기
                ul.innerHTML = bookmarks.slice(-5).reverse().map((b) => {
                    // 기사 제목을 25자까지만 표시 (너무 길어지는 것을 방지)
                    const displayTitle = b.title.length > 25 ? b.title.substring(0, 25) + '...' : b.title;
                    return `<li class="bookmark-item"><a href="${b.url}" target="_blank" title="${b.title}">🔗 ${displayTitle}</a></li>`;
                }).join('');
            }
            
            // 기존 폴더 정보 표시 영역(HTML에 있는 더미 데이터)을 지우고 목록을 삽입
            const existingInfo = bookmarkArea.querySelector('.bookmark-manager-info');
            if(existingInfo) existingInfo.style.display = 'none';

            const existingList = bookmarkArea.querySelector('.bookmark-list');
            if(!existingList) bookmarkArea.insertBefore(ul, bookmarkArea.querySelector('.bookmark-action-bar'));
        }
        
        alert(`총 ${bookmarks.length}개의 북마크를 불러왔습니다. 사이드바를 확인하세요.`);

      }); // 🚨 수정된 부분: chrome.storage.local.get 닫는 괄호
    }); // 🚨 수정된 부분: loadBtn.addEventListener 닫는 괄호
  }

  // 5. popup.html에서 보낸 메시지 수신 및 사이드바 토글
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "toggleSidebar") {
      toggleSidebar();
    }
  });

  // ✅ 사이드바가 세팅되면 바로 현재 기사 분석 실행
  runBreezeRead();
})(); 