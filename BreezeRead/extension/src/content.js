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
  // ⭐️ 2. 데이터 로드 및 초기화

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
   * 전체 폴더 목록을 개별 토글 요소로 렌더링하고 클릭 이벤트를 바인딩합니다.
   * @param {Array} folders - 전체 폴더 데이터
   * @param {HTMLElement} container - 폴더 목록을 담을 상위 요소 (#bookmarkFolderArea)
   */
  function renderFolderToggles(folders, container) {
      if (!container) return;
      container.innerHTML = ''; // 기존 목록 초기화

      folders.forEach(folder => {
          const count = folder.bookmarks.length;
          
          // 1. 개별 폴더 요소 생성 (각 폴더가 토글 가능하도록)
          const folderDiv = document.createElement('div');
          folderDiv.classList.add('bookmark-folder-item');
          folderDiv.dataset.folderId = folder.folderId; // ID 저장

          folderDiv.innerHTML = `
              <button class="folder-toggle-btn">
                  📁 ${folder.folderName} (${count}개)
                  <span class="toggle-icon">▶</span>
              </button>
              <div class="bookmark-details-container hidden"> 
                </div>
          `;

          // 2. 이벤트 리스너 바인딩 (개별 토글 로직)
          folderDiv.querySelector('.folder-toggle-btn').addEventListener('click', () => {
              const detailsContainer = folderDiv.querySelector('.bookmark-details-container');
              const icon = folderDiv.querySelector('.toggle-icon');
              
              const isHidden = detailsContainer.classList.contains('hidden');

              // 닫혀 있다면 -> 열고 상세 목록 렌더링
              if (isHidden) {
                  renderBookmarksInFolder(folder.folderId, folders, detailsContainer); // 상세 목록 렌더링
                  detailsContainer.classList.remove('hidden');
                  icon.textContent = '▼';
              } else {
                  // 열려 있다면 -> 닫고 내용 제거
                  detailsContainer.classList.add('hidden');
                  detailsContainer.innerHTML = ''; // 내용 제거로 메모리 관리
                  icon.textContent = '▶';
              }
          });
          
          container.appendChild(folderDiv);
      });
  }


  /**
   * 선택된 폴더의 북마크 상세 목록을 해당 폴더 요소 바로 아래에 렌더링합니다.
   * @param {number|string} folderId - 선택된 폴더 ID
   * @param {Array} folders - 전체 폴더 데이터
   * @param {HTMLElement} targetContainer - 상세 목록을 삽입할 div.bookmark-details-container
   */
  function renderBookmarksInFolder(folderId, folders, targetContainer) {
    const targetFolder = folders.find((f) => f.folderId == folderId);

    if (!targetContainer || !targetFolder) return;

    targetContainer.innerHTML = `
      <p class="details-header">총 ${targetFolder.bookmarks.length}개</p>
    `;

    if (targetFolder.bookmarks.length === 0) {
      targetContainer.innerHTML += '<p class="no-bookmark-item">이 폴더에는 북마크가 없습니다.</p>';
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
    
    targetContainer.innerHTML += `<ul class="folder-bookmarks-list">${bookmarkListHtml}</ul>`;
  }

  /**
   * 폴더 선택 플라이아웃 패널 UI를 생성하고 저장 이벤트를 바인딩합니다.
   */
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
        bookmarkArea.insertBefore(flyoutPanel, bookmarkArea.querySelector('.bookmark-action-bar'));
    }

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
    const folders = await initializeBookmarks();
    
    // 2. 폴더 목록 렌더링 (개별 토글 기능 사용)
    const folderArea = sidebar.querySelector("#bookmarkFolderArea");
    renderFolderToggles(folders, folderArea); 

    // 3. Flyout 패널 초기 설정
    setupFlyoutPanel(folders); 
    const flyoutPanel = document.getElementById(FLYOUT_PANEL_ID);
    
    // 4. 북마크 상세 영역 DOM 준비 (토글 방식에서는 사용하지 않음)
    // 5. saveBtn 이벤트 리스너 (Flyout 토글)
    const saveBtn = sidebar.querySelector(".saveBtn");
    if (saveBtn) {
      saveBtn.textContent = "폴더에 저장하기 ▼";
      saveBtn.onclick = null;
      saveBtn.addEventListener("click", () => {
        if (flyoutPanel) {
            flyoutPanel.classList.toggle('hidden');
        }
      });
    }

    // 6. 폴더 클릭 이벤트 리스너 (renderFolderToggles 함수 내에서 개별적으로 바인딩되므로 여기서는 제외)

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


  // 6. popup.html에서 보낸 메시지 수신 및 사이드바 토글 (외부 정의된 함수 필요)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "toggleSidebar") {
      // toggleSidebar();
    }
  });

  // =========================================================================
  // ⭐️ 실행 시작
  // =========================================================================
  runBreezeRead();
  setupBookmarkSystem();
})();