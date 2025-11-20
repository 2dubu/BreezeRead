from fastapi import FastAPI, HTTPException,Query 
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

# summarize.py, read_time.py, crawler.py로부터 함수 import
from BreezeRead.server.recommend import create_keyword_groups, extract_keywords_textrank, extract_keywords_tfidf, get_naver_news_content, getresult, recommend_news_from_url
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

class RecommendResponse(BaseModel):
    results: List[NewsResponse]

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
@app.get("/recommend/url", response_model=RecommendResponse)
def recommend(url: str = Query(..., description="추천 기반 원문 뉴스 URL")):
    """
    URL을 입력하면 추천 뉴스 3개를 반환한다.

    Args:
        url: 추천 기반 뉴스 원문 URL

    Returns:
        results: NewsResponse 객체 리스트
    """
    news_objs = recommend_news_from_url(url)
    return RecommendResponse(
        results=[NewsResponse(title=n.title, link=n.link, thumbnail=n.thumbnail) for n in news_objs]
    )

@app.get("/health")
def health():
    return {"status": "ok"}