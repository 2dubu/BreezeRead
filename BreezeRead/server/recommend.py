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
사용자가 읽고있는 페이지의 본문 글 크롤링해오기 
'''

# 1. url에서 뉴스 본문 크롤링하기 
def get_naver_news_content(url):
    response = requests.get(url)
    if response.status_code == 200:
        soup = BeautifulSoup(response.text, 'html.parser')
        # 네이버 뉴스 본문 영역
        content = soup.find('div', {'id': 'newsct_article'}) 
        if content:
            # 본문에서 스크립트 및 스타일 제거
            for script in content(['script', 'style']):
                script.decompose()
            return content.get_text(strip=True)
        else:
            return "본문을 찾을 수 없습니다."
    else:
        return "페이지를 불러올 수 없습니다."

# 지금은 네이버 뉴스 URL 입력했지만 나중에는 content.js에서 사용자가 읽고있는 뉴스 url 불러올 계획
news_url = "https://n.news.naver.com/article/008/0005278558?cds=news_media_pc"  
news_content = get_naver_news_content(news_url)
print(news_content)

# 2. 본문에 있는 글에서 TF-IDF 키워드 추출
def extract_keywords_tfidf(text, top_n=6):
    okt = Okt()
    tokens = okt.nouns(text)
    tokens = [t for t in tokens if len(t) > 1]  # 한 글자는 제외

    # TF-IDF 계산
    tfidf_vectorizer = TfidfVectorizer()
    tfidf_matrix = tfidf_vectorizer.fit_transform([" ".join(tokens)])
    feature_names = tfidf_vectorizer.get_feature_names_out()
    scores = tfidf_matrix.toarray()[0]
    word_score = dict(zip(feature_names, scores))
    sorted_words = sorted(word_score.items(), key=lambda x: x[1], reverse=True)
    # 상위 top_n 단어와 점수 출력
    return sorted_words[:top_n]
# 3️. TextRank 키워드 추출
def extract_keywords_textrank(text, top_n=6, window_size=4, damping=0.85, min_diff=1e-5, steps=100):
    okt = Okt()
    words = [w for w in okt.nouns(text) if len(w) > 1]

    # 단어 그래프 생성
    graph = nx.Graph()
    for i, word in enumerate(words):
        for j in range(i+1, min(i+window_size, len(words))):
            graph.add_edge(word, words[j])

    # PageRank 계산
    ranks = nx.pagerank(graph, alpha=damping)
    sorted_words = sorted(ranks.items(), key=lambda x: x[1], reverse=True)
    return sorted_words[:top_n]

# groupName + keywords 생성
def create_keyword_groups(tfidf_keywords, textrank_keywords):
    groups = []

    # TF-IDF 1등
    tfidf_groupName = tfidf_keywords[0][0]
    tfidf_keywords_list = [w for w, s in tfidf_keywords[1:]]  # 나머지 상위 키워드
    groups.append({'groupName': tfidf_groupName, 'keywords': tfidf_keywords_list})

    # TextRank 1등
    textrank_groupName = textrank_keywords[0][0]
    textrank_keywords_list = [w for w, s in textrank_keywords[1:]]
    groups.append({'groupName': textrank_groupName, 'keywords': textrank_keywords_list})

    return groups


# 4️. 결과 출력
if __name__ == "__main__":
    text = get_naver_news_content(news_url)
    if text:
        print("본문 크롤링 성공!\n")
        tfidf_keywords = extract_keywords_tfidf(text)
        textrank_keywords = extract_keywords_textrank(text)
        print("🔹 TF-IDF 키워드 및 점수:")
        for w, s in tfidf_keywords:
            print(f"{w}: {s:.4f}")
        
        print("\n🔹 TextRank 키워드 및 점수:")
        for w, s in textrank_keywords:
            print(f"{w}: {s:.4f}")
        my_keywordGroups = create_keyword_groups(tfidf_keywords, textrank_keywords)
        print(my_keywordGroups)
    else:
        print("본문을 가져오지 못했습니다.")

'''
추출한 키워드로 연령대별, 나이대별 선호도 조사 진행

'''

load_dotenv()

client_id = os.environ.get("client_id")
client_secret = os.environ.get("client_secret")
if not client_id or not client_secret:
    raise EnvironmentError("CLIENT_ID and SECRET environment variables must be set.")

# 연령대 코드 → 설명 변환용 딕셔너리
age_conv = {
    '1': '0∼12세', '2': '13∼18세', '3': '19∼24세', '4': '25∼29세',
    '5': '30∼34세', '6': '35∼39세', '7': '40∼44세', '8': '45∼49세',
    '9': '50∼54세', '10': '55∼59세', '11': '60세 이상'
}

def getresult(startDate, endDate, timeUnit, keywordGroups, device, ages):
    url = "https://openapi.naver.com/v1/datalab/search"
    response_results_all = pd.DataFrame()

    # 성별과 나이대 반복
    for g in ['m', 'f']:
        for age in ages:
            body_dict = {
                "startDate": startDate,
                "endDate": endDate,
                "timeUnit": timeUnit,
                "keywordGroups": keywordGroups,
                "device": device,
                "gender": g,
                "ages": [age]
            }
            body = json.dumps(body_dict)
            request = urllib.request.Request(url, data=body.encode("utf-8"))
            request.add_header("X-Naver-Client-Id", client_id)
            request.add_header("X-Naver-Client-Secret", client_secret)
            request.add_header("Content-Type", "application/json")
            response = urllib.request.urlopen(request)
            rescode = response.getcode()
            if rescode != 200:
                print(f"Error Code: {rescode}")
                continue
            response_body = response.read()
            response_json = json.loads(response_body)

            # DataFrame으로 변환
            response_results = pd.DataFrame()
            for data in response_json['results']:
                result = pd.DataFrame(data['data'])
                result['title'] = data['title']
                result['age'] = age
                result['gender'] = g
                response_results = pd.concat([response_results, result])

            response_results_all = pd.concat([response_results_all, response_results])

    # 나이대별·성별 키워드 총 검색량 순위 출력
    for g in ['m', 'f']:
        print(f"\n===== 성별: {'남성' if g=='m' else '여성'} =====")
        for age in ages:
            data_sub = response_results_all[
                (response_results_all['gender']==g) & (response_results_all['age']==age)
            ]
            if data_sub.empty:
                continue
            group_sums = data_sub.groupby('title')['ratio'].sum().sort_values(ascending=False)
            print(f"\n[{age_conv[age]}] 키워드 순위:")
            for idx, (title, val) in enumerate(group_sums.items(), start=1):
                print(f"{idx}. {title}: {val:.2f}")

# 실행 예시
startDate = '2025-01-01'
endDate = '2025-10-30'
timeUnit = 'month'
keywordGroups = my_keywordGroups
device = 'pc'
ages = ['1','2','3','4','5','6','7','8','9','10','11']

getresult(startDate, endDate, timeUnit, keywordGroups, device, ages)


'''
둘중 하나의 키워드로 이제 검색해서 뉴스 세개만 고르기 
'''
class StringCleaner:
    @staticmethod
    def clean(txt):
        txt = txt.replace("&lt;/b&gt;0","")
        txt = txt.replace("&apos","")
        txt = txt.replace("&lt;/b&gt;","")
        txt = txt.replace("<b>","")
        txt = txt.replace("</b>","")
        txt = txt.replace("&quot;","")
        return txt
    
NAVER_CLIENT_ID = os.environ.get("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.environ.get("NAVER_CLIENT_SECRET")
if not client_id or not NAVER_CLIENT_SECRET:
    raise EnvironmentError("CLIENT_ID and SECRET environment variables must be set.")
# 위에서 선택한 키워드불러오기 
q = my_keywordGroups[0]['groupName']
q = quote(q)
# req header
h = {"X-Naver-Client-Id" : NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET}
hc = HTTPSConnection("openapi.naver.com")
# 요청 방식이 GET이라는 조건 
hc.request("GET", "/v1/search/news.xml?query=" + q, headers=h)
res = hc.getresponse() 
resBody = res.read() 
hc.close()

for n in fromstring(resBody).iter("item"):
    print(StringCleaner.clean(n.find("title").text))
    print(StringCleaner.clean(n.find("link").text))

    print("------------")
