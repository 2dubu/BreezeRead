// content.js
(async () => {
  const SIDEBAR_ID = "breezeread-sidebar";
  const TOGGLE_ID = "breezeread-toggle";
  const CONTAINER_ID = "breezeread-container";
  const LOGO_IMAGE = chrome.runtime.getURL("assets/breezecat.png");
  const SETTINGS_IMAGE = chrome.runtime.getURL("assets/setting.png");
  const CHEVRON_RIGHT = chrome.runtime.getURL("assets/chevron-right.png");
  const CHEVRON_LEFT = chrome.runtime.getURL("assets/chevron-left.png");
// ⭐️ 북마크 시스템 관련 상수
  const FLYOUT_PANEL_ID = "breezeread-folder-flyout";
  const BOOKMARK_CONTENT_AREA_ID = "bookmarkContentArea";
  const INITIAL_BOOKMARK_DATA = [
  { folderId: 1, folderName: "경제", bookmarks: [] },
  { folderId: 2, folderName: "IT/기술", bookmarks: [] },
  { folderId: 3, folderName: "생활/문화", bookmarks: [] },
];
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
  // 📁 북마크 폴더 관리 로직
  // =========================================================================
/**
   * 로컬 스토리지에서 북마크 폴더 데이터를 로드하거나, 
   * 데이터가 없으면 초기 데이터를 설정하고 반환합니다.
   * @returns {Promise<Array>} 북마크 폴더 배열
   */
  async function initializeBookmarks() {
      return new Promise((resolve) => {
          chrome.storage.local.get(["breezeReadFolders"], (result) => {
              let folders = result.breezeReadFolders;
              
              if (!folders || folders.length === 0) {
                  folders = INITIAL_BOOKMARK_DATA; 
                  chrome.storage.local.set({ breezeReadFolders: folders });
              }
              
              resolve(folders); 
          });
      });
  }


  // =========================================================================
  // 📁 3. UI 렌더링 함수
  // =========================================================================

  /**
   * 북마크 폴더 목록을 렌더링하고 토글 기능을 추가합니다.
   * @param {Array} INITIAL_BOOKMARK_DATA - 폴더 데이터
   * @param {HTMLElement} container - 목록을 담을 상위 요소 (sidebar)
   */
  function renderBookmarkFolders(INITIAL_BOOKMARK_DATA, container) {
    if (!container) return;

    let listEl = container.querySelector("#bookmarkFolderArea");
    
    if (!listEl) {
      listEl = document.createElement("div"); 
      listEl.id = "bookmarkFolderArea";
      container.querySelector('.bookmark-section')?.appendChild(listEl); // bookmark-section 안에 삽입
    }

    const folderListHtml = INITIAL_BOOKMARK_DATA.map(folder => {
      const count = folder.bookmarks.length;
      return `
        <li class="bookmark-folder" data-folder-id="${folder.folderId}">
          📁 ${folder.folderName} (${count}개)
        </li>
      `;
    }).join("");
    
    // 토글 버튼과 목록을 포함하는 HTML 구조 생성
    listEl.innerHTML = `
      <div class="folder-toggle-header">
        <button id="folderListToggleButton">
          북마크 폴더 목록 (${INITIAL_BOOKMARK_DATA.length}개)
          <span class="toggle-icon">▼</span>
        </button>
      </div>
      <ul id="folderListContainer" class="folder-list-hidden"> 
        ${folderListHtml}
      </ul>
    `; 
    
    // 3. 토글 이벤트 바인딩
    const toggleButton = listEl.querySelector("#folderListToggleButton");
    const listContainer = listEl.querySelector("#folderListContainer");

    toggleButton.addEventListener("click", () => {
      listContainer.classList.toggle("folder-list-hidden");
      const icon = toggleButton.querySelector(".toggle-icon");
      if (listContainer.classList.contains("folder-list-hidden")) {
        icon.textContent = "▼"; // 닫힘
      } else {
        icon.textContent = "▲"; // 열림
      }
    });
  }


  /**
   * 선택된 폴더의 북마크 상세 목록을 화면의 BOOKMARK_CONTENT_AREA_ID에 렌더링합니다.
   */
  function renderBookmarksInFolder(folderId, folders) {
    const targetFolder = folders.find((f) => f.folderId == folderId);
    const bookmarkContentArea = sidebar.querySelector(`#${BOOKMARK_CONTENT_AREA_ID}`);

    if (!bookmarkContentArea || !targetFolder) return;

    bookmarkContentArea.innerHTML = `
      <h4>[${targetFolder.folderName}] 북마크 목록 (${targetFolder.bookmarks.length}개)</h4>
    `;

    if (targetFolder.bookmarks.length === 0) {
      bookmarkContentArea.innerHTML += '<p class="no-bookmark-item">이 폴더에는 북마크가 없습니다.</p>';
      return;
    }

    const bookmarkListHtml = targetFolder.bookmarks.slice().reverse().map(b => {
      const displayTitle = b.title.length > 30 ? b.title.substring(0, 30) + '...' : b.title;
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

  /**
   * 폴더 선택 플라이아웃 패널 UI를 생성하고 저장 이벤트를 바인딩합니다.
   */
  function setupFlyoutPanel(folders) {
    const existingFlyout = document.getElementById(FLYOUT_PANEL_ID);
    if (existingFlyout) existingFlyout.remove();

    const flyoutPanel = document.createElement('div');
    flyoutPanel.id = FLYOUT_PANEL_ID;
    flyoutPanel.classList.add('hidden'); // 기본적으로 숨김

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
        bookmarkArea.insertBefore(flyoutPanel, bookmarkArea.querySelector('.bookmark-action-bar'));
    }

    // 폴더 선택 클릭 이벤트 (저장 로직)
    flyoutPanel.querySelector('.flyout-folder-list').addEventListener('click', (event) => {
      const folderItem = event.target.closest(".flyout-folder-item");
      if (folderItem) {
        const folderId = parseInt(folderItem.dataset.folderId);
        
        const articleTitle = document.querySelector('h2#title_area > span')?.textContent.trim() || '제목 없음';
        const articleUrl = window.location.href;

        saveBookmarkToFolder(folderId, articleTitle, articleUrl);
        
        flyoutPanel.classList.add('hidden'); // 저장 후 플라이아웃 패널 숨김
      }
    });
  }


  // =========================================================================
  // 💾 4. 북마크 저장 로직
  // =========================================================================

  /**
   * 현재 기사를 선택된 폴더에 저장하고 전체 시스템을 갱신합니다.
   */
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
          
          setupBookmarkSystem(); // 저장 후 전체 시스템 갱신
        });
      } else {
        alert("오류: 선택된 폴더를 찾을 수 없습니다.");
      }
    });
  }


  // =========================================================================
  // ⚙️ 5. 시스템 초기화 및 이벤트 바인딩
  // =========================================================================

  /**
   * 북마크 시스템 설정 및 이벤트 핸들링 (전체 시스템 초기화 및 갱신 역할)
   */
  async function setupBookmarkSystem() {
    // 1. 초기 데이터 로드
    const folders = await initializeBookmarks();
    
    // 2. 폴더 목록 렌더링 (토글 기능 포함)
    renderBookmarkFolders(folders, sidebar);
    
    // 3. Flyout 패널 초기 설정 (숨겨진 상태로 DOM에 추가)
    setupFlyoutPanel(folders); 
    const flyoutPanel = document.getElementById(FLYOUT_PANEL_ID);
    
    // 4. 북마크 상세 영역 DOM 준비
    let contentArea = sidebar.querySelector(`#${BOOKMARK_CONTENT_AREA_ID}`);
    if (!contentArea) {
        contentArea = document.createElement('div');
        contentArea.id = BOOKMARK_CONTENT_AREA_ID; 
        const bookmarkArea = sidebar.querySelector('#bookmarkArea');
        if (bookmarkArea) {
            // bookmarkArea가 있다면, 그 아래에 상세 목록 영역 추가
            bookmarkArea.appendChild(contentArea); 
        }
    }

    // 5. saveBtn 이벤트 리스너 (Flyout 토글)
    const saveBtn = sidebar.querySelector(".saveBtn");
    if (saveBtn) {
      saveBtn.textContent = "폴더에 저장하기 ▼";
      saveBtn.onclick = null; // 기존 리스너 제거 (중복 방지)
      saveBtn.addEventListener("click", () => {
        if (flyoutPanel) {
            flyoutPanel.classList.toggle('hidden');
        }
      });
    }

    // 6. 폴더 클릭 이벤트 리스너 (목록 조회) - 이벤트 위임
    const bookmarkListArea = sidebar.querySelector("#bookmarkFolderArea");
    if (bookmarkListArea) {
        bookmarkListArea.onclick = null; // 기존 리스너 제거 (중복 방지)
        
        bookmarkListArea.addEventListener('click', (event) => {
            const folderItem = event.target.closest(".bookmark-folder");
            if (folderItem) {
                const folderId = parseInt(folderItem.dataset.folderId); 
                renderBookmarksInFolder(folderId, folders); // 상세 목록 렌더링
            }
        });
    }

    // 7. loadBtn 이벤트 리스너 (폴더 목록 갱신)
    const loadBtn = sidebar.querySelector(".loadBtn");
    if (loadBtn) {
        loadBtn.textContent = "폴더 목록 갱신";
        loadBtn.onclick = null;
        loadBtn.addEventListener("click", async () => {
            await setupBookmarkSystem(); 
            alert("북마크 폴더 목록을 갱신했습니다.");
        });
    }
  }


  // 6. popup.html에서 보낸 메시지 수신 및 사이드바 토글 (toggleSidebar 함수는 외부 정의 필요)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "toggleSidebar") {
      // toggleSidebar(); // 외부 정의 함수 호출
    }
  });

  // =========================================================================
  // ⭐️ 실행 시작
  // =========================================================================
  // runBreezeRead(); // 외부 정의 함수 호출
  setupBookmarkSystem();
})();