from http.client import HTTPSConnection
from urllib.parse import quote
from xml.etree.ElementTree import fromstring
import urllib.request
import json
import pandas as pd
from dotenv import load_dotenv
import os
import requests
from bs4 import BeautifulSoup
from sklearn.feature_extraction.text import TfidfVectorizer
from konlpy.tag import Okt
import networkx as nx
'''
recommend.py 기능 핵심요약 

현재 읽고 있는 기사 url 입력 
-> 본문 크롤링
-> tfidf/textrank 수치 계산
-> keyword그룹 create
-> 네이버 데이터랩에서 키워드별 검색량 추출
-> 성별/연령별 선호 키워드 추출
-> 키워드로 추천 기사 url/제목/thumbnail 출력
'''

'''
[How to use]
# 프로젝트 폴더로 이동
cd ~/GitHub/BreezeRead/BreezeRead/recommendation

# 가상환경 생성
/opt/homebrew/bin/python3.12 -m venv venv

# 가상환경 활성화
source venv/bin/activate

# 가상환경 안에서 코드 실행하기 
python 실행파일.py

'''
load_dotenv()

# 환경변수 불러오기
CLIENT_ID = os.environ.get("client_id")
CLIENT_SECRET = os.environ.get("client_secret")
NAVER_CLIENT_ID = os.environ.get("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.environ.get("NAVER_CLIENT_SECRET")

if not CLIENT_ID or not CLIENT_SECRET or not NAVER_CLIENT_ID or not NAVER_CLIENT_SECRET:
    raise EnvironmentError("필수 CLIENT_ID/SECRET 환경변수가 설정되어야 합니다.")

# =========================
# 1️⃣ 뉴스 본문 크롤링
# =========================
def get_naver_news_content(url: str) -> str:
    """주어진 네이버 뉴스 URL에서 본문을 크롤링한다.

    Args:
        url: 네이버 뉴스 기사 URL

    Returns:
        본문 텍스트(str), 없으면 오류 메시지
    """
    response = requests.get(url)
    if response.status_code == 200:
        soup = BeautifulSoup(response.text, 'html.parser')
        content = soup.find('div', {'id': 'newsct_article'})
        if content:
            for script in content(['script', 'style']):
                script.decompose()
            return content.get_text(strip=True)
        else:
            return "본문을 찾을 수 없습니다."
    else:
        return "페이지를 불러올 수 없습니다."

# =========================
# 2️⃣ TF-IDF 키워드 추출
# =========================
def extract_keywords_tfidf(text: str, top_n: int = 6):
    """본문 텍스트에서 TF-IDF 기반 상위 키워드를 추출한다.

    Args:
        text: 원문 텍스트
        top_n: 상위 n개 키워드 추출

    Returns:
        [(키워드, 점수), ...] 형태 리스트
    """
    okt = Okt()
    tokens = [t for t in okt.nouns(text) if len(t) > 1]
    tfidf_vectorizer = TfidfVectorizer()
    tfidf_matrix = tfidf_vectorizer.fit_transform([" ".join(tokens)])
    feature_names = tfidf_vectorizer.get_feature_names_out()
    scores = tfidf_matrix.toarray()[0]
    return sorted(zip(feature_names, scores), key=lambda x: x[1], reverse=True)[:top_n]

# =========================
# 3️⃣ TextRank 키워드 추출
# =========================
def extract_keywords_textrank(text: str, top_n: int = 6, window_size: int = 4, damping: float = 0.85):
    """본문 텍스트에서 TextRank 기반 상위 키워드를 추출한다.

    Args:
        text: 원문 텍스트
        top_n: 상위 n개 키워드 추출
        window_size: 단어 그래프 연결 범위
        damping: PageRank 감쇠계수

    Returns:
        [(키워드, 점수), ...] 형태 리스트
    """
    okt = Okt()
    words = [w for w in okt.nouns(text) if len(w) > 1]
    graph = nx.Graph()
    for i, word in enumerate(words):
        for j in range(i+1, min(i+window_size, len(words))):
            graph.add_edge(word, words[j])
    ranks = nx.pagerank(graph, alpha=damping)
    return sorted(ranks.items(), key=lambda x: x[1], reverse=True)[:top_n]

# =========================
# 4️⃣ 키워드 그룹 생성
# =========================
def create_keyword_groups(tfidf_keywords, textrank_keywords):
    """TF-IDF와 TextRank 결과를 바탕으로 그룹화한다.

    Args:
        tfidf_keywords: TF-IDF 키워드 리스트
        textrank_keywords: TextRank 키워드 리스트

    Returns:
        [
            {"groupName": 대표키워드, "keywords": [관련 키워드 리스트]},
            ...
        ]
    """
    groups = []
    tfidf_groupName = tfidf_keywords[0][0]
    tfidf_keywords_list = [w for w, s in tfidf_keywords[1:]]
    groups.append({'groupName': tfidf_groupName, 'keywords': tfidf_keywords_list})
    textrank_groupName = textrank_keywords[0][0]
    textrank_keywords_list = [w for w, s in textrank_keywords[1:]]
    groups.append({'groupName': textrank_groupName, 'keywords': textrank_keywords_list})
    return groups

# =========================
# 5️⃣ 뉴스 객체 정의
# =========================
class NewsArticle:
    """뉴스 기사 객체"""
    def __init__(self, title: str, link: str, thumbnail: str):
        self.title = title
        self.link = link
        self.thumbnail = thumbnail

    def __repr__(self):
        return f"NewsArticle(title={self.title}, link={self.link}, thumbnail={self.thumbnail})"

# =========================
# 6️⃣ 문자열 정리
# =========================
class StringCleaner:
    @staticmethod
    def clean(txt: str) -> str:
        txt = txt.replace("&lt;/b&gt;0","").replace("&apos","").replace("&lt;/b&gt;","")
        txt = txt.replace("<b>","").replace("</b>","").replace("&quot;","")
        return txt

# =========================
# 7️⃣ 기사 썸네일 추출
# =========================
def extract_thumbnail(url: str) -> str:
    """기사 페이지에서 #img1 또는 og:image를 추출한다.

    Args:
        url: 뉴스 기사 URL

    Returns:
        썸네일 URL(str) 또는 None
    """
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        res = requests.get(url, headers=headers, timeout=5)
        soup = BeautifulSoup(res.text, "html.parser")
        img = soup.select_one("#img1")
        if img and img.get("src"):
            return img["src"]
        og = soup.find("meta", property="og:image")
        if og and og.get("content"):
            return og["content"]
        return None
    except:
        return None

# =========================
# 8️⃣ 최종 추천 뉴스 객체 생성
# =========================
def recommend_news_from_url(url: str):
    """URL 하나만 넣으면 크롤링, 키워드 추출, 뉴스 추천까지 수행한다.

    Args:
        url: 추천 기반 원문 뉴스 URL

    Returns:
        [NewsArticle 객체, ...] 상위 3개 뉴스
    """
    text = get_naver_news_content(url)
    if not text or "본문을 찾을 수 없습니다." in text:
        return []

    tfidf_keywords = extract_keywords_tfidf(text)
    textrank_keywords = extract_keywords_textrank(text)
    keyword_groups = create_keyword_groups(tfidf_keywords, textrank_keywords)
    main_keyword = keyword_groups[0]['groupName']

    # 네이버 뉴스 검색 상위 3개 추출
    q = quote(main_keyword)
    headers = {"X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET}
    hc = HTTPSConnection("openapi.naver.com")
    hc.request("GET", f"/v1/search/news.xml?query={q}", headers=headers)
    res = hc.getresponse()
    resBody = res.read()
    hc.close()
    items = list(fromstring(resBody).iter("item"))[:3]

    news_objects = []
    for n in items:
        title = StringCleaner.clean(n.find("title").text)
        link = StringCleaner.clean(n.find("link").text)
        thumbnail = extract_thumbnail(link)
        news_objects.append(NewsArticle(title, link, thumbnail))

    return news_objects

# =========================
# CLI 테스트용
# =========================
if __name__ == "__main__":
    test_url = "https://n.news.naver.com/article/008/0005278558?cds=news_media_pc"
    recommended = recommend_news_from_url(test_url)
    for news in recommended:
        print(news)
