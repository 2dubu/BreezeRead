# crawler.py
import requests
from bs4 import BeautifulSoup, Tag
from urllib.parse import urlparse

class CrawlError(Exception):
    """기사 크롤링 과정에서 발생하는 예외."""
    pass

def fetch_html(url: str) -> str:
    """주어진 URL에 HTTP 요청을 보내 HTML 문서를 가져온다.

    Args:
        url (str): HTML을 가져올 페이지의 URL

    Returns:
        str: 응답 본문의 HTML 소스(문자열)

    Raises:
        requests.exceptions.RequestException: 네트워크 오류, 타임아웃, HTTP 에러 등이 발생한 경우
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        "Referer": "https://news.naver.com/",
    }
    resp = requests.get(url, headers=headers, timeout=5)
    resp.raise_for_status()
    return resp.text

def extract_naver_news_text(html: str) -> str:
    """네이버 뉴스 HTML에서 기사 본문 컨테이너의 텍스트를 가져온다.

    NOTE:
        여기서는 HTML 구조에서 본문 영역만 선택하고,
        텍스트 전처리(불필요 문구 제거, 공백 정리, 문장 분리 등)는
        summarize.py 쪽에서 수행한다.

    Args:
        html (str): 전체 HTML 소스

    Returns:
        str: 기사 본문 텍스트(가공 전 원문에 가까운 형태)

    Raises:
        CrawlError: 본문 후보 셀렉터들에서 텍스트를 찾지 못한 경우
    """
    soup = BeautifulSoup(html, "html.parser")

    # 네이버 뉴스 본문으로 자주 쓰이는 후보 셀렉터들
    candidates = [
        "#dic_area",
        "#articeBody",
        "#newsEndContents"
    ]
    exclude_selectors = [
        "span.end_photo_org",
        "em.img_desc",
        "table.nbd_table",
        "div[style*='border-left:solid 4px']", # 이거 조심
        ".media_end_summary",
    ]

    for selector in candidates:
        node = soup.select_one(selector)
        if not node:
            continue

        # ✅ dic_area인 경우: 맨 앞에 붙어 있는 <strong> 요약 블록들 제거
        if getattr(node, "get", None) and node.get("id") == "dic_area":
            while True:
                # 첫 번째 자식 중 "태그"만 골라서 본다 (텍스트/개행은 건너뜀)
                first_tag = next(
                    (c for c in node.contents if isinstance(c, Tag)),
                    None,
                )
                # 더 이상 태그가 없거나, strong이 아니면 중단
                if not first_tag or first_tag.name != "strong":
                    break
                # 맨 앞 strong 제거 (요약 줄)
                first_tag.decompose()

        for ex_sel in exclude_selectors:
            for ex in node.select(ex_sel):
                ex.decompose()

        text = node.get_text()
        if text and text.strip():
            return text.strip()

    # 못 찾은 경우 에러
    raise CrawlError("네이버 뉴스 본문을 찾지 못했습니다.")

def crawl_article(url: str) -> str:
    """네이버 뉴스 기사 URL에서 본문 텍스트를 크롤링한다.

    1) URL의 도메인이 `news.naver.com` 인지 확인하고,
    2) HTML을 가져온 뒤,
    3) 기사 본문 텍스트만 추출하여 반환한다.

    Args:
        url (str): 네이버 뉴스 기사 URL

    Returns:
        str: 기사 본문 텍스트

    Raises:
        CrawlError: 지원하지 않는 도메인이거나, 본문 추출에 실패한 경우
        requests.exceptions.RequestException: HTML을 가져오는 과정에서 네트워크/HTTP 에러가 발생한 경우
    """
    parsed = urlparse(url)
    if "news.naver.com" not in parsed.netloc:
        raise CrawlError("현재는 news.naver.com 만 지원합니다.")

    html = fetch_html(url)
    text = extract_naver_news_text(html)
    return text