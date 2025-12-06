// content.js
(async () => {
  const SIDEBAR_ID = "breezeread-sidebar";
  const TOGGLE_ID = "breezeread-toggle";
  const CONTAINER_ID = "breezeread-container";
  const LOGO_IMAGE = chrome.runtime.getURL("assets/breezecat.png");
  const SETTINGS_IMAGE = chrome.runtime.getURL("assets/setting.png");
  const CHEVRON_RIGHT = chrome.runtime.getURL("assets/chevron-right.png");
  const CHEVRON_LEFT = chrome.runtime.getURL("assets/chevron-left.png");

  // 북마크 시스템 관련 상수
  const FLYOUT_PANEL_ID = "breezeread-folder-flyout";
  const INITIAL_BOOKMARK_DATA = [
    { folderId: 1, folderName: "경제", bookmarks: [] },
    { folderId: 2, folderName: "IT/기술", bookmarks: [] },
    { folderId: 3, folderName: "생활/문화", bookmarks: [] },
  ];

  // Cloud Run API 베이스 URL
  const API_BASE =
    "https://breezeread-api-866228904846.asia-northeast3.run.app";

  // 최상위 컨테이너 ID를 기준으로 중복 실행 방지
  if (document.getElementById(CONTAINER_ID)) return;

  let isReadTimeLoaded = false;
  let isSummaryLoaded = false;

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

  // === BreezeRead 기능: 읽기 시간 + 요약 호출 ===

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

  // read_time 호출
  async function loadReadTimeAtInitialized() {
    if (isReadTimeLoaded) return;

    const articleUrl = window.location.href;
    const readTimeContainer = sidebar.querySelector("#readTime");
    const readTimeValue = readTimeContainer?.querySelector(".time-value");

    if (!readTimeValue) return;

    readTimeValue.textContent = "계산 중...";

    try {
      const readTimeMin = await fetchReadTime(articleUrl);
      // "1분", "10분" 이렇게 표기
      readTimeValue.textContent = `${readTimeMin}분`;
      // 토글 버튼 우측 배지에 반영
      const badge = document.getElementById("breezeread-time-badge");
      if (badge) badge.textContent = `${readTimeMin}분`;
      isReadTimeLoaded = true;
    } catch (e) {
      console.error("read_time 호출 오류:", e);
      readTimeValue.textContent = "오류";
    }
  }

  // UI에 읽기 시간 + 요약 반영하기
  async function runBreezeRead() {
    if (isSummaryLoaded) return;
    const articleUrl = window.location.href;
    const summaryArea = sidebar.querySelector("#summaryArea");
    const readTimeContainer = sidebar.querySelector("#readTime");
    const readTimeValue = readTimeContainer?.querySelector(".time-value");

    // 로딩 상태 표시
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

      // 읽기 추천 메시지 반영 (랜덤 선택)
      const readRecommend = readTimeContainer?.querySelector(".read-recommend");
      if (readRecommend) {
        const shortMessages = [
          "⏰ 짧은 틈에 딱 좋아요",
          "🚀 금방 읽을 수 있는 글이에요",
          "📖 빠르게 훑어볼만한 글이에요",
        ];
        const mediumMessages = [
          "🚶 산책하며 읽기 좋아요",
          "🌟 여유롭게 읽어보세요",
          "🌿 편하게 읽기 좋은 글이에요",
          "☕ 커피 한 잔과 함께 읽어봐요",
        ];
        const longMessages = [
          "🛋️ 소파에서 여유롭게 읽어봐요",
          "📚 깊이 있게 읽어봐요",
          "🏠 집에서 편하게 읽어봐요",
          "🍿 간식과 함께 천천히 읽어봐요",
        ];

        let messages;
        if (readTimeMin <= 3) {
          messages = shortMessages;
        } else if (readTimeMin <= 7) {
          messages = mediumMessages;
        } else {
          messages = longMessages;
        }
        const randomMessage =
          messages[Math.floor(Math.random() * messages.length)];
        readRecommend.textContent = randomMessage;
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
      isSummaryLoaded = true;
    } catch (e) {
      console.error("BreezeRead API 오류:", e);
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

  // 읽기 시간 배지 생성 (토글 버튼 오른쪽에 표시)
  const readTimeBadge = document.createElement("div");
  readTimeBadge.id = "breezeread-time-badge";
  readTimeBadge.textContent = "...";

  // 초기 상태: 숨김 (collapsed)
  container.classList.add("collapsed");
  toggleIcon.src = CHEVRON_RIGHT;

  container.appendChild(toggleBtn);
  container.appendChild(readTimeBadge);

  // 토글 기능
  const toggleSidebar = () => {
    const isCollapsed = container.classList.toggle("collapsed");
    toggleIcon.src = isCollapsed ? CHEVRON_RIGHT : CHEVRON_LEFT;

    if (!isCollapsed) {
      runBreezeRead();
    }
  };
  toggleBtn.onclick = toggleSidebar;

  // =========================================================================
  // 📁 북마크 폴더 관리 로직
  // =========================================================================
  // 데이터 로드 및 초기화

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
    container.innerHTML = ""; // 기존 목록 초기화

    folders.forEach((folder) => {
      const count = folder.bookmarks.length;

      // 1. 개별 폴더 요소 생성 (각 폴더가 토글 가능하도록)
      const folderDiv = document.createElement("div");
      folderDiv.classList.add("bookmark-folder-item");
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
      folderDiv
        .querySelector(".folder-toggle-btn")
        .addEventListener("click", () => {
          const detailsContainer = folderDiv.querySelector(
            ".bookmark-details-container"
          );
          const icon = folderDiv.querySelector(".toggle-icon");

          const isHidden = detailsContainer.classList.contains("hidden");

          // 닫혀 있다면 -> 열고 상세 목록 렌더링
          if (isHidden) {
            renderBookmarksInFolder(folder.folderId, folders, detailsContainer); // 상세 목록 렌더링
            detailsContainer.classList.remove("hidden");
            icon.textContent = "▼";
          } else {
            // 열려 있다면 -> 닫고 내용 제거
            detailsContainer.classList.add("hidden");
            detailsContainer.innerHTML = ""; // 내용 제거로 메모리 관리
            icon.textContent = "▶";
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
      targetContainer.innerHTML +=
        '<p class="no-bookmark-item">이 폴더에는 북마크가 없습니다.</p>';
      return;
    }

    const bookmarkListHtml = targetFolder.bookmarks
      .slice()
      .reverse()
      .map((b) => {
        const displayTitle =
          b.title.length > 30 ? b.title.substring(0, 30) + "..." : b.title;
        const date = new Date(b.timestamp).toLocaleDateString("ko-KR");

        return `
        <li class="folder-bookmark-item">
          <a href="${b.url}" target="_blank" title="${b.title}">
            <span class="bookmark-title">🔗 ${displayTitle}</span>
            <span class="bookmark-date">${date}</span>
          </a>
          <button class="bookmark-delete-btn" data-bookmark-id="${b.id}" title="삭제">
          ×
          </button>
          </li>
      `;
      })
      .join("");

    targetContainer.innerHTML += `<ul class="folder-bookmarks-list">${bookmarkListHtml}</ul>`;
  }
/**
 * 삭제버튼을 누르면 해당 기사 북마크가 지워짐
 */

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("bookmark-delete-btn")) {
    const id = e.target.dataset.bookmarkId;

    // 1) 스토리지에서 삭제
    deleteBookmark(id);

    // 2) UI에서 제거
    removeBookmarkItem(id);
  }
});
function deleteBookmark(id) {
  chrome.storage.local.get(["breezeReadFolders"], (result) => {
    let folders = result.breezeReadFolders;

    if (!folders || folders.length === 0) return;

    folders = folders.map(folder => {
      return {
        ...folder,
        bookmarks: folder.bookmarks.filter(b => b.id !== id)
      };
    });

    chrome.storage.local.set({ breezeReadFolders: folders });
  });
}

function removeBookmarkItem(id) {
  const item = document.querySelector(`button[data-bookmark-id="${id}"]`)
                 ?.closest(".folder-bookmark-item");
  if (item) item.remove();
}



  /**
   * 폴더 선택 플라이아웃 패널 UI를 생성하고 저장 이벤트를 바인딩합니다.
   */
  function setupFlyoutPanel(folders) {
    const existingFlyout = document.getElementById(FLYOUT_PANEL_ID);
    if (existingFlyout) existingFlyout.remove();

    const flyoutPanel = document.createElement("div");
    flyoutPanel.id = FLYOUT_PANEL_ID;
    flyoutPanel.classList.add("hidden");

    const folderListHtml = folders
      .map(
        (folder) => `
      <li class="flyout-folder-item" data-folder-id="${folder.folderId}">
        📁 ${folder.folderName} 
        <span class="folder-count">(${folder.bookmarks.length}개)</span>
      </li>
    `
      )
      .join("");

    flyoutPanel.innerHTML = `
      <p class="flyout-title">저장할 폴더 선택</p>
      <ul class="flyout-folder-list">${folderListHtml}</ul>
    `;

    const bookmarkArea = sidebar.querySelector("#bookmarkArea");
    if (bookmarkArea) {
      bookmarkArea.insertBefore(
        flyoutPanel,
        bookmarkArea.querySelector(".bookmark-action-bar")
      );
    }

    flyoutPanel
      .querySelector(".flyout-folder-list")
      .addEventListener("click", (event) => {
        const folderItem = event.target.closest(".flyout-folder-item");
        if (folderItem) {
          const folderId = parseInt(folderItem.dataset.folderId);

          const articleTitle =
            document
              .querySelector("h2#title_area > span")
              ?.textContent.trim() || "제목 없음";
          const articleUrl = window.location.href;

          saveBookmarkToFolder(folderId, articleTitle, articleUrl);

          flyoutPanel.classList.add("hidden"); // 저장 후 플라이아웃 패널 숨김
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
          folderId: folderId,
        };

        if (targetFolder.bookmarks.some((b) => b.url === articleUrl)) {
          alert(`이미 [${targetFolder.folderName}] 폴더에 저장된 기사입니다!`);
          return;
        }

        targetFolder.bookmarks.push(newBookmark);

        chrome.storage.local.set({ breezeReadFolders: folders }, () => {
          console.log(
            `[${targetFolder.folderName}]에 북마크 저장 완료:`,
            articleTitle
          );
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
          flyoutPanel.classList.toggle("hidden");
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

  // =========================================================================
  // 📁 성별/ 연령별 정보 입력하기
  // =========================================================================
  // =========================================================================
  // ⚙️ 5. 시스템 초기화 및 이벤트 바인딩 (참고 문법)
  // =========================================================================

  // 설정 패널
  const settingsBtn = document.getElementById("settingsBtn");
  const filterPanel = document.querySelector(".section-panel-filterPanel");

  // 닫기 버튼
  const closePanelBtn = document.getElementById("closePanelBtn");

  // 1) 설정 버튼 클릭 → 토글
  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // 이벤트 버블링 방지
    filterPanel.classList.toggle("hidden");
  });

  // 2) 닫기 버튼 클릭 → 패널 숨김
  closePanelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    filterPanel.classList.add("hidden");
  });

  // 3) 패널 외부 클릭시 자동 닫기
  document.addEventListener("click", (e) => {
    if (!filterPanel.contains(e.target) && e.target !== settingsBtn) {
      filterPanel.classList.add("hidden");
    }
  });

  // 연령/성별 적용버튼
  document.getElementById("applyFilterBtn").addEventListener("click", () => {
    // 🔹 선택된 성별 가져오기
    const genderInput = document.querySelector("input[name='gender']:checked");

    // 프론트 값 → 서버 값 매핑
    const genderMap = {
      male: "m",
      female: "f",
    };

    // 성별 변환 ('male' | 'female' → 'm' | 'f')
    const gender = genderInput ? genderMap[genderInput.value] : "";

    // 🔹 선택된 연령대 가져오기
    const age = document.getElementById("ageGroup").value;

    // 🔹 서버에 맞는 데이터 형태
    const userFilter = {
      gender: gender, // 'm' / 'f' / ''
      agesList: age ? [age] : [], // ["3"] or []
    };

    // 🔹 storage에 저장
    chrome.storage.local.set({ userFilter }, () => {
      console.log("사용자 필터 저장 완료:", userFilter);
      alert("필터가 저장되었습니다!");
    });
  });

  // 1. filter 없는 함수 (기본 요약)
  async function fetchDefaultRecommend(articleUrl) {
    const res = await fetch(`${API_BASE}/recommend/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: articleUrl }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`fetchDefaultRecommend 실패: ${res.status} ${err}`);
    }

    return await res.json();
  }

  // 2. filter 있는 fetchSummary 함수 (맞춤형 요약)
  async function fetchRecommendWithUserData(articleUrl, gender, agesList) {
    const res = await fetch(`${API_BASE}/recommend/age-gender`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: articleUrl,
        gender: gender,
        agesList: agesList,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`fetchRecommendWithUserData 실패: ${res.status} ${err}`);
    }

    return await res.json();
  }

  // 3. Promise 기반의 로컬스토리지 읽기 함수
  function getUserFilter() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["userFilter"], (result) => {
        resolve(result.userFilter || null);
      });
    });
  }

  /**
   * 사용자 필터 여부에 따라 적절한 API를 호출하고 요약 데이터를 반환합니다.
   * @param {string} currentArticleUrl 현재 요약할 기사의 URL
   * @returns {Promise<Object>} API로부터 받은 요약 데이터
   */
  async function getFilter(currentArticleUrl) {
    console.log("필터 및 요약 시스템 시작");
    const userFilter = await getUserFilter();

    try {
      let recommendData;

      if (userFilter != null) {
        console.log("✅ userFilter 존재:", userFilter);

        const gender = userFilter.gender;
        const agesList = userFilter.agesList;

        console.log(`API에 전송: Gender: ${gender}, Age: ${agesList[0]}`);

        // fetchRecommendWithUserData 호출 및 데이터 수신 (필터 O)
        recommendData = await fetchRecommendWithUserData(
          currentArticleUrl,
          gender,
          agesList
        );
        console.log("🎉 맞춤형 요약 정보 로드 성공");
      } else {
        console.log("❌ userFilter 없음.");

        // fetchDefaultRecommend 호출 및 데이터 수신 (필터 X)
        recommendData = await fetchDefaultRecommend(currentArticleUrl);
        console.log("🎉 기본 요약 정보 로드 성공");
      }

      // 최종적으로 API 결과를 반환합니다.
      return recommendData;
    } catch (error) {
      console.error("⛔ 시스템 실행 중 오류 발생:", error.message);
      throw error; // 에러를 상위 호출자로 다시 던져서 처리할 수 있도록 합니다.
    }
  }

  // 4. 실행부 (getFilter 함수를 호출하는 부분)

  async function recommend() {
    // ⚠️ articleUrl을 현재 실행 환경에 맞게 가져와야 합니다.
    // 예: Content Script라면
    const articleUrl = window.location.href;
    // 예: Background/Popup Script라면 chrome.tabs.query를 사용해야 합니다.

    try {
      const finalRecommendData = await getFilter(articleUrl);
      console.log("최종 요약 데이터:", finalRecommendData);
      renderRecommendation(finalRecommendData);
      // TODO: finalRecommendData 사용하여 사용자에게 결과를 보여주는 로직을 구현합니다.
    } catch (error) {
      console.error("요약 프로세스 최종 실패:", error.message);
    }
  }

  /**
   * 추천 데이터 렌더링 함수 (선택 키워드 + 뉴스 반복)
   * @param {Object} recommendData API에서 받아온 추천 데이터
   */
  function renderRecommendation(recommendData) {
    // 🔹 키워드 영역 초기화
    const keywordArea = document.getElementById("keywordArea");
    keywordArea.innerHTML = "";

    // 🔹 키워드 직접 추가
    const kw1 = recommendData.keyword_groups[0].groupName;
    const kw2 = recommendData.keyword_groups[0].keywords[0];
    const kw3 = recommendData.keyword_groups[0].keywords[1];

    [kw1, kw2, kw3].forEach((kw) => {
      const span = document.createElement("span");
      span.className = "keyword-tag";
      span.textContent = kw ? `#${kw}` : "";
      keywordArea.appendChild(span);
    });

    // 🔹 뉴스 추천 영역 초기화
    const recommendationArea = document.getElementById("recommendationArea");
    recommendationArea.innerHTML = "";

    if (recommendData.results && recommendData.results.length > 0) {
      recommendData.results.forEach((news) => {
        const newsDiv = document.createElement("div");
        newsDiv.className = "news-item";

        const img = document.createElement("img");
        img.src = news.thumbnail || "";
        img.alt = "뉴스 썸네일";

        const p = document.createElement("p");
        p.textContent = news.title;

        // 클릭 시 새 탭으로 링크 열기
        newsDiv.addEventListener("click", () => {
          window.open(news.link, "_blank");
        });

        newsDiv.appendChild(img);
        newsDiv.appendChild(p);
        recommendationArea.appendChild(newsDiv);
      });
    }
  }

  recommend();
  loadReadTimeAtInitialized();
  setupBookmarkSystem();
})();
