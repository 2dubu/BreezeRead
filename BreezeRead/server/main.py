from fastapi import FastAPI, HTTPException, Query 
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

# summarize.py, read_time.py, crawler.py로부터 함수 import
from recommend import recommend_news_from_url, recommend_news_with_age_gender
from summarize import (
    EnhancedTextRankConfig,
    EnhancedTextRankSummarizer,
)
from read_time import estimate_read_time_min
from crawler import crawl_article, CrawlError

app = FastAPI(title="BreezeRead Summarizer API")

# 네이버 뉴스에서만 호출 허용
origins = [
    "https://news.naver.com",
    "https://n.news.naver.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# URL request 모델
class UrlRequest(BaseModel):
    url: str

class UrlSummarizeRequest(UrlRequest):
    top_k: int = 3

class NewsResponse(BaseModel):
    title: str
    link: str
    thumbnail: str

class KeywordGroup(BaseModel):
    groupName: str
    keywords: List[str]

class RecommendResponse(BaseModel):
    keyword_groups: List[KeywordGroup]
    results: List[NewsResponse]

# 클라이언트가 보낼 JSON 본문의 구조 (URL만 포함)
class UrlRecommendRequest(BaseModel):
    url: str

# 클라이언트가 보낼 JSON 본문의 구조를 정의합니다.
class RecommendRequest(BaseModel):
    url: str
    gender: str # 'm' 또는 'f'
    agesList: list[str]

# 1) read_time
@app.post("/readtime/url")
def read_time_from_url(req: UrlRequest):
    try:
        content = crawl_article(req.url)
    except CrawlError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=500, detail="크롤링 중 오류가 발생했습니다.")

    read_time_result = estimate_read_time_min(content)
    return {"read_time_min": read_time_result}

# 2) summarize
@app.post("/summarize/url")
def summarize_from_url(req: UrlSummarizeRequest):
    # 1) 기사 본문 크롤링
    try:
        content = crawl_article(req.url)
    except CrawlError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=500, detail="크롤링 중 오류가 발생했습니다.")

    # 2) summarize 설정
    cfg = EnhancedTextRankConfig()
    summarizer = EnhancedTextRankSummarizer(cfg)

    # 3) summarize
    summarize_result = summarizer.summarize(content)

    return {
        "sentences": summarize_result.get("sentences", []),
        "indices": summarize_result.get("indices", []),
        "scores": summarize_result.get("scores", []),
        "abstract": summarize_result.get("abstract"),
    }

# --------------------------------------------
@app.post("/recommend/url", response_model=RecommendResponse)
def recommend(
    request: UrlRecommendRequest  # JSON 본문을 받도록 수정
):
    """
    URL을 입력하면 추천 뉴스 3개를 반환한다.

    Args:
        url: 추천 기반 뉴스 원문 URL

    Returns:
        results: NewsResponse 객체 리스트 + 키워드 객체 
    """
    news_objs = recommend_news_from_url(request.url)
    return RecommendResponse(
        keyword_groups=news_objs["keyword_groups"],
        results=[NewsResponse(
                title=n.title,
                link=n.link,
                thumbnail=n.thumbnail
                )
            for n in news_objs["news"]])

# --------------------------------------------
# 성별이랑 연령 input하면 선호도 반영해서 기사 추천하기 
@app.post("/recommend/age-gender", response_model=RecommendResponse)
def recommend_age_gender(
    request: RecommendRequest # 클라이언트의 본문을 받도록 수정
):
    """
    URL + 성별 + 나이대 입력 → 키워드 그룹 분석 → 데이터랩 검색량 비교 →
    groupName + 첫 키워드로 뉴스 검색 → 상위 3개 NewsArticle 반환
    """
    
    # request 객체에서 데이터를 추출하여 사용합니다.
    ages_list = request.agesList
    news_objs = recommend_news_with_age_gender(request.url, request.gender, ages_list)
        
    return RecommendResponse(
        keyword_groups=news_objs["keyword_groups"],
        results=[NewsResponse(
            title=n.title, 
            link=n.link, 
            thumbnail=n.thumbnail) 
            for n in news_objs["news"]]
    )
@app.get("/health")
def health():
    return {"status": "ok"}