// content.js
(async () => {
  const SIDEBAR_ID = "breezeread-sidebar";
  const TOGGLE_ID = "breezeread-toggle";
  const CONTAINER_ID = "breezeread-container";

  // ⭐️ [수정]: 최상위 컨테이너 ID를 기준으로 중복 실행 방지
  if (document.getElementById(CONTAINER_ID)) return;

  // HTML 및 CSS 가져오기
  const [htmlRes, cssRes] = await Promise.all([
    fetch(chrome.runtime.getURL("src/main.html")),
    fetch(chrome.runtime.getURL("src/style.css"))
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

  // ⭐️ [버튼 작동 수정]: 사이드바 내부 버튼에 이벤트 리스너 추가
  const startBtn = sidebar.querySelector("#startBtn");
  const newsArea = sidebar.querySelector("#newsArea");

  if (startBtn && newsArea) {
    startBtn.addEventListener("click", () => {
      // 뉴스 추천 시작 로직
      newsArea.innerHTML = "<p>여기에 뉴스 추천이 표시됩니다. (실행됨)</p>";
      // 필요한 경우 chrome.runtime.sendMessage(...) 통신 로직 추가
    });
  } else {
    console.error("BreezeRead: 사이드바 내부 버튼(#startBtn)을 찾을 수 없습니다.");
  }

  // 3. 토글 버튼 생성 (사이드바 외부, 컨테이너 내부에 위치)
  const toggleBtn = document.createElement("div");
  toggleBtn.id = TOGGLE_ID;
  toggleBtn.innerText = "<<"; // ⭐️ [수정]: 닫힌 상태에서 열기 버튼이므로 "<<" 대신 ">>"
  
  // 닫힌 상태에서 버튼은 사이드바가 **열리는 방향**을 가리키는 것이 일반적입니다.
  // 이 코드가 가장 최근 코드의 초기값을 << 로 변경했으므로, << 로 유지합니다.
  // **주의:** 토글 로직과 일치하는지 확인하세요. (닫힘: <<, 열림: >>)
  toggleBtn.innerText = "<<"; 

  container.appendChild(toggleBtn);

  // 초기 상태: 숨김 (collapsed)
  container.classList.add("collapsed");

  // 토글 기능
  const toggleSidebar = () => {
    const isCollapsed = container.classList.toggle("collapsed");
    // ⭐️ 토글 버튼 화살표 로직: 닫힘(collapsed) 상태면 열기 방향(>>), 열림 상태면 닫기 방향(<<)
    toggleBtn.innerText = isCollapsed ? "<<" : ">>"; 
  };
  toggleBtn.onclick = toggleSidebar;

  // 4. popup.html에서 보낸 메시지 수신 및 사이드바 토글
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "toggleSidebar") {
      toggleSidebar();
    }
  });
})();