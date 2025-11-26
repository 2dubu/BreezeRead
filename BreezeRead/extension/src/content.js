// content.js
(async () => {
  const SIDEBAR_ID = "breezeread-sidebar";
  const TOGGLE_ID = "breezeread-toggle";
  const CONTAINER_ID = "breezeread-container";
  const LOGO_IMAGE = chrome.runtime.getURL("assets/breezecat.png");
  const SETTINGS_IMAGE = chrome.runtime.getURL("assets/setting.png");
  const CHEVRON_RIGHT = chrome.runtime.getURL("assets/chevron-right.png");
  const CHEVRON_LEFT = chrome.runtime.getURL("assets/chevron-left.png");
  const FLYOUT_PANEL_ID = "breezeread-folder-flyout";
  const BOOKMARK_CONTENT_AREA_ID = "breezeread-bookmark-content";
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
  
// =========================================================================
  // 📁 북마크 폴더 관리 로직 (함수 정의)
  // =========================================================================

  /**
   * 선택된 폴더의 북마크 상세 목록을 화면에 렌더링합니다.
   */
  function renderBookmarksInFolder(folderId, folders) {
    const targetFolder = folders.find((f) => f.folderId === folderId);
    const bookmarkContentArea = sidebar.querySelector(`#${BOOKMARK_CONTENT_AREA_ID}`);

    if (!bookmarkContentArea || !targetFolder) return;

    // 제목 업데이트
    bookmarkContentArea.innerHTML = `
      <h4>[${targetFolder.folderName}] 북마크 목록 (${targetFolder.bookmarks.length}개)</h4>
    `;

    if (targetFolder.bookmarks.length === 0) {
      bookmarkContentArea.innerHTML += '<p class="no-bookmark-item">이 폴더에는 북마크가 없습니다.</p>';
      return;
    }

    // 북마크 리스트 HTML 생성 (최신순으로 표시)
    const bookmarkListHtml = targetFolder.bookmarks.slice().reverse().map(b => {
      // 제목이 길면 자르기
      const displayTitle = b.title.length > 30 ? b.title.substring(0, 30) + '...' : b.title;
      // 저장 시간 포맷팅
      const date = new Date(b.timestamp).toLocaleDateString("ko-KR");
      
      return `
        <li class="folder-bookmark-item">
          <a href="${b.url}" target="_blank" title="${b.title}">
            <span class="bookmark-title">🔗 ${displayTitle}</span>
            <span class="bookmark-date">${date}</span>
          </a>
        </li>
      `;
    }).join('');
    
    bookmarkContentArea.innerHTML += `<ul class="folder-bookmarks-list">${bookmarkListHtml}</ul>`;
  }
  // 🚨 2. 초기화 함수 정의
  function initializeBookmarks() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["breezeReadFolders"], (result) => {
        if (!result.breezeReadFolders || result.breezeReadFolders.length === 0) {
          chrome.storage.local.set(
            { breezeReadFolders: INITIAL_BOOKMARK_DATA },
            () => { resolve(INITIAL_BOOKMARK_DATA); }
          );
        } else {
          resolve(result.breezeReadFolders);
        }
      });
    });
  }

  // 🚨 3. 렌더링 함수 정의
  function renderBookmarkFolders(folders) { 
    const bookmarkList = sidebar.querySelector(".bookmark-list");
    if (!bookmarkList) return;

    bookmarkList.innerHTML = folders
      .map((folder) => {
        const count = folder.bookmarks.length;
        return `
          <li class="bookmark-folder" data-folder-id="${folder.folderId}">
            📁 ${folder.folderName} 
            <span class="folder-count">(${count}개)</span>
          </li>
        `;
      })
      .join("");
      
      const existingInfo = sidebar.querySelector('.bookmark-manager-info');
      if(existingInfo) existingInfo.style.display = 'none';
  }

  // 🚨 4. 저장 함수 정의
  function saveBookmarkToFolder(folderId, articleTitle, articleUrl) {
    chrome.storage.local.get(["breezeReadFolders"], (result) => {
      const folders = result.breezeReadFolders || INITIAL_BOOKMARK_DATA;
      const targetFolder = folders.find((f) => f.folderId === folderId);

      if (targetFolder) {
        const newBookmarkId = `b${Date.now()}`; 
        
        const newBookmark = {
          id: newBookmarkId,
          title: articleTitle,
          url: articleUrl,
          timestamp: Date.now(), 
          folderId: folderId
        };

        if (targetFolder.bookmarks.some((b) => b.url === articleUrl)) {
          alert(`이미 [${targetFolder.folderName}] 폴더에 저장된 기사입니다!`);
          return;
        }
        
        targetFolder.bookmarks.push(newBookmark);

        chrome.storage.local.set({ breezeReadFolders: folders }, () => {
          console.log(`[${targetFolder.folderName}]에 북마크 저장 완료:`, articleTitle);
          alert(`[${targetFolder.folderName}]에 저장되었습니다!`);
          
          renderBookmarkFolders(folders); 
        });
      } else {
        alert("오류: 선택된 폴더를 찾을 수 없습니다.");
      }
    });
  }

  // 🚨 5. 플라이아웃 패널 생성 함수 정의
  function setupFlyoutPanel(folders) {
    const existingFlyout = document.getElementById(FLYOUT_PANEL_ID);
    if (existingFlyout) existingFlyout.remove();

    const flyoutPanel = document.createElement('div');
    flyoutPanel.id = FLYOUT_PANEL_ID;
    flyoutPanel.classList.add('hidden');

    const folderListHtml = folders.map(folder => `
      <li class="flyout-folder-item" data-folder-id="${folder.folderId}">
        📁 ${folder.folderName} 
        <span class="folder-count">(${folder.bookmarks.length}개)</span>
      </li>
    `).join('');

    flyoutPanel.innerHTML = `
      <p class="flyout-title">저장할 폴더 선택</p>
      <ul class="flyout-folder-list">${folderListHtml}</ul>
    `;
    
    const bookmarkArea = sidebar.querySelector('#bookmarkArea');
    if (bookmarkArea) {
        // 기존 폴더 목록(ul.bookmark-list) 아래, 액션 바 위에 삽입
        bookmarkArea.insertBefore(flyoutPanel, bookmarkArea.querySelector('.bookmark-action-bar'));
    }

    flyoutPanel.querySelector('.flyout-folder-list').addEventListener('click', (event) => {
      const folderItem = event.target.closest(".flyout-folder-item");
      if (folderItem) {
        const folderId = parseInt(folderItem.dataset.folderId);
        
        const articleTitle = document.querySelector('h2#title_area > span')?.textContent.trim() || '제목 없음';
        const articleUrl = window.location.href;

        saveBookmarkToFolder(folderId, articleTitle, articleUrl);
        
        flyoutPanel.classList.add('hidden');
      }
    });
  }

  // 🚨 6. 북마크 시스템 설정 함수 정의 (정리된 버전)
  async function setupBookmarkSystem() {
    // 1. 초기 데이터 로드/설정
    const folders = await initializeBookmarks();
    
    // 2. 폴더 목록 렌더링 (하단에 보이는 목록)
    renderBookmarkFolders(folders);
    
    // 3. Flyout 패널 초기 설정 및 이벤트 바인딩
    setupFlyoutPanel(folders); 
    const flyoutPanel = document.getElementById(FLYOUT_PANEL_ID);
    // 🚨 [추가]: 북마크 상세 영역 DOM 준비
    let contentArea = sidebar.querySelector(`#${BOOKMARK_CONTENT_AREA_ID}`);
    if (!contentArea) {
        contentArea = document.createElement('div');
        contentArea.id = BOOKMARK_CONTENT_AREA_ID;
        // bookmarkArea 내에서 목록(ul.bookmark-list) 바로 아래에 삽입
        sidebar.querySelector('.bookmark-list')?.after(contentArea);
    }
    // 4. saveBtn 이벤트 리스너 (Flyout 토글)
    const saveBtn = sidebar.querySelector(".saveBtn");
    if (saveBtn) {
      saveBtn.textContent = "폴더에 저장하기 ▼";
      saveBtn.addEventListener("click", () => {
        if (flyoutPanel) {
            flyoutPanel.classList.toggle('hidden');
        }
      });
    }
    // 🚨 [추가]: 폴더 클릭 이벤트 리스너 (목록 조회)
    const bookmarkList = sidebar.querySelector(".bookmark-list");
    if (bookmarkList) {
        bookmarkList.addEventListener('click', (event) => {
            const folderItem = event.target.closest(".bookmark-folder");
            if (folderItem) {
                const folderId = parseInt(folderItem.dataset.folderId);
                // 선택된 폴더의 상세 북마크 목록을 렌더링합니다.
                renderBookmarksInFolder(folderId, folders);
            }
        });
    }

    // 5. loadBtn 이벤트 리스너 (폴더 목록 갱신)
    const loadBtn = sidebar.querySelector(".loadBtn");
    if (loadBtn) {
      loadBtn.textContent = "폴더 목록 갱신";
      loadBtn.addEventListener("click", () => {
        // setupBookmarkSystem을 재실행하여 폴더 데이터를 다시 불러오고 UI를 갱신합니다.
        setupBookmarkSystem(); 
        alert("북마크 폴더 목록을 갱신했습니다.");
      });
    }
  }

  // 7. 메시지 수신 (기존 로직 유지)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "toggleSidebar") {
      toggleSidebar();
    }
  });

  // ✅ 사이드바가 세팅되면 바로 현재 기사 분석 실행
  runBreezeRead();
  setupBookmarkSystem();
})(); 