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

# 가상환경 생성
/opt/homebrew/bin/python3.12 -m venv venv
# 프로젝트 폴더로 이동
cd /GitHub/BreezeRead

# 가상환경 활성화
source venv/bin/activate

# 실행파일로 이동 
cd BreezeRead/server    

원래 라이브러리 설치 

# 추가 설치 
pip install konlpy==0.6.0
pip install JPype1==1.6.0

# 자바 경로 설정
brew install openjdk@17
usr/libexec/java_home -V 
sudo ln -sfn /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk
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

    Returns:keyword_groups
        [
            {"groupName": TF-IDF 1등, "keywords": [관련 키워드 리스트]},
            {"groupName": TextRank 1등, "keywords": [관련 키워드 리스트]},
            ...
        ]
    """
    keyword_groups = []
    tfidf_groupName = tfidf_keywords[0][0]
    tfidf_keywords_list = [w for w, s in tfidf_keywords[1:]]  
    keyword_groups.append({'groupName': tfidf_groupName, 'keywords': tfidf_keywords_list})
    textrank_groupName = textrank_keywords[0][0]
    textrank_keywords_list = [w for w, s in textrank_keywords[1:]]
    keyword_groups.append({'groupName': textrank_groupName, 'keywords': textrank_keywords_list})
    return keyword_groups
    
# =========================
# 연령대별, 나이대별 선호도 조사 
# ages는 숫자로 입력받으면 age_conv에 해당하는 나이대에 적용하게 됨. 
# =========================
def get_preference_result(keywordGroups, g, ages):
    # 나이대 코드 변환
    age_conv = {
        '1': '0∼12세', '2': '13∼18세', '3': '19∼24세', '4': '25∼29세',
        '5': '30∼34세', '6': '35∼39세', '7': '40∼44세', '8': '45∼49세',
        '9': '50∼54세', '10': '55∼59세', '11': '60세 이상'
    }

    url = "https://openapi.naver.com/v1/datalab/search"
    response_results_all = pd.DataFrame()

    # 나이대별 반복
    for age in ages:
        body_dict={} #검색 정보를 저장할 변수
        body_dict['startDate']='2025-01-01'
        body_dict['endDate']='2025-10-30'
        body_dict['timeUnit']='month'
        body_dict['keywordGroups']=keywordGroups
        body_dict['device']='pc'
        body_dict['gender']=g
        body_dict['ages']=[age]
        body=str(body_dict).replace("'",'"')
        request = urllib.request.Request(url, data=body.encode("utf-8"))
        request.add_header("X-Naver-Client-Id", CLIENT_ID)
        request.add_header("X-Naver-Client-Secret", CLIENT_SECRET)
        request.add_header("Content-Type", "application/json")
        response = urllib.request.urlopen(request)
        rescode = response.getcode()
        if rescode != 200:
            print(f"Error Code: {rescode}")
            continue
        response_body = response.read()
        response_json = json.loads(response_body)

        # DataFrame 변환
        response_results = pd.DataFrame()
        for data in response_json['results']:
            result = pd.DataFrame(data['data'])
            result['title'] = data['title']       # groupName
            result['age'] = age
            result['gender'] = g
            response_results = pd.concat([response_results, result])

        response_results_all = pd.concat([response_results_all, response_results])

    if response_results_all.empty:
        return None

    # ratio 컬럼 float 변환
    response_results_all['ratio'] = response_results_all['ratio'].astype(float)

    # groupName(=title)별 전체 기간 합계 계산
    group_sums = response_results_all.groupby('title')['ratio'].sum()

    # 검색량이 가장 많은 groupName 선택
    top_group = group_sums.idxmax()
    # 해당 groupName의 키워드 리스트 가져오기
    keywords_list = []
    for group in keywordGroups:
        if group['groupName'] == top_group:
            keywords_list = group['keywords']
            break

    return {"groupName": top_group, "keywords": keywords_list}


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
        [NewsArticle 객체, ...] 상위 3개 뉴스 + 기사에서 추출된 키워드 리스트
    """
    text = get_naver_news_content(url)
    if not text or "본문을 찾을 수 없습니다." in text:
        return {"keyword_groups": [], "news": []}

    tfidf_keywords = extract_keywords_tfidf(text)
    textrank_keywords = extract_keywords_textrank(text)
    keyword_groups = create_keyword_groups(tfidf_keywords, textrank_keywords)
    # 두 그룹의 groupName 가져오기
    group1 = keyword_groups[0]['groupName']
    group2 = keyword_groups[1]['groupName']

    # 두 키워드를 공백 또는 다른 구분자로 합치기
    main_keyword = f"{group1} {group2}"  # 공백으로 조합

    # URL 인코딩
    q = quote(main_keyword)

    # 네이버 뉴스 검색
    headers = {"X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET}
    hc = HTTPSConnection("openapi.naver.com")
    hc.request("GET", f"/v1/search/news.xml?query={q}", headers=headers)

    res = hc.getresponse()
    resBody = res.read()
    hc.close()
    items = list(fromstring(resBody).iter("item"))[:4]

    news_objects = []
    for n in items:
        link = StringCleaner.clean(n.find("link").text)
        # 2. 🚨 필터링 로직: 원본 URL과 검색된 뉴스의 링크가 같은지 비교
        if link == url:
            continue  # 원본 URL과 같으면 이 뉴스를 건너뛰고 다음 뉴스를 확인합니다.
        title = StringCleaner.clean(n.find("title").text)
        thumbnail = extract_thumbnail(link)
        news_objects.append(NewsArticle(title, link, thumbnail))

    return {
        "keyword_groups": keyword_groups,
        "news": news_objects
    }

# =========================
# 8️⃣ 연령.성별별로 추천 뉴스 객체 생성
# =========================
def recommend_news_with_age_gender(url, g, ages):
    """
    URL 하나만 넣으면 뉴스 본문 분석 → 키워드 그룹 생성 → 데이터랩 검색량 비교 → 
    groupName + 첫 키워드로 뉴스 검색 → 상위 3개 NewsArticle 객체 반환

    Args:
        url (str): 추천 기반 원문 뉴스 URL
        g (str): 성별 ('m' or 'f')
        ages (list[str]): 나이대 코드 리스트, 예: ['3','4']

    Returns:
        news_objects (list[NewsArticle]): 상위 3개 뉴스 객체
    """
    # 1️⃣ 뉴스 본문 가져오기
    text = get_naver_news_content(url)
    if not text or "본문을 찾을 수 없습니다." in text:
        return {"keyword_groups": [], "news": []}

    # 2️⃣ 키워드 추출
    tfidf_keywords = extract_keywords_tfidf(text)
    textrank_keywords = extract_keywords_textrank(text)
    keyword_groups = create_keyword_groups(tfidf_keywords, textrank_keywords)

    # 3️⃣ 데이터랩에서 검색량 기준 가장 인기 group 선택
    top_group_data = get_preference_result(keyword_groups, g, ages)
    if not top_group_data:
        return {"keyword_groups": [], "news": []}

    # 4️⃣ groupName + 첫 키워드 조합 → 검색어
    main_keyword = f"{top_group_data['groupName']} {top_group_data['keywords'][0]}"
    q = quote(main_keyword)

    # 5️⃣ 네이버 뉴스 검색
    headers = {"X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET}
    hc = HTTPSConnection("openapi.naver.com")
    hc.request("GET", f"/v1/search/news.xml?query={q}", headers=headers)
    res = hc.getresponse()
    resBody = res.read()
    hc.close()

    items = list(fromstring(resBody).iter("item"))[:4]
        # Error handling for HTTP status and XML parsing
    if res.status != 200:
        return []
    try:
        items = list(fromstring(resBody).iter("item"))[:4]
    except Exception:
        return []

    # 6️⃣ NewsArticle 객체 생성
    news_objects = []
    for n in items:
        link = StringCleaner.clean(n.find("link").text)
        if link == url:
            # 원본 기사이면 다음 아이템으로 넘어갑니다.
            continue
        # 필터링 통과시
        title = StringCleaner.clean(n.find("title").text)
        thumbnail = extract_thumbnail(link)
        news_objects.append(NewsArticle(title, link, thumbnail))  # NewsArticle 사용

    return {
        "keyword_groups": [top_group_data],
        "news": news_objects
    }


# =========================
# CLI 테스트용
# =========================
if __name__ == "__main__":
    test_url = "https://n.news.naver.com/mnews/article/009/0005593794"
    recommended = recommend_news_with_age_gender(test_url,'m',['3','4'])
    # 🔹 키워드 출력
    print("===== 추출된 키워드 그룹 =====")
    for group in recommended["keyword_groups"]:
        print(f"{group['groupName']} : {group['keywords']}")

    # 🔹 뉴스 출력
    print("\n===== 추천 뉴스 =====")
    for news in recommended["news"]:
        print(f"제목: {news.title}")
        print(f"링크: {news.link}")
        print(f"썸네일: {news.thumbnail}")
        print("-" * 50)