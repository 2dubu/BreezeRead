from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# summarize.py, read_time.py로부터 함수 import
from summarize import (
    EnhancedTextRankConfig,
    EnhancedTextRankSummarizer,
)
from read_time import estimate_read_time_min

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

class SummarizeRequest(BaseModel):
    title: str | None = None
    content: str
    top_k: int = 3
    abstract: bool = False

@app.post("/summarize")
def summarize(req: SummarizeRequest):
    # 요약기 설정
    cfg = EnhancedTextRankConfig(
        top_k=req.top_k,
        title=req.title,
        abstract=req.abstract,
    )
    summarizer = EnhancedTextRankSummarizer(cfg)

    # summarize
    summarize_result = summarizer.summarize(req.content)

    # read_time
    read_time_result = estimate_read_time_min(req.content)

    return {
        "read_time_min": read_time_result,
        "sentences": summarize_result.get("sentences", []),
        "indices": summarize_result.get("indices", []),
        "scores": summarize_result.get("scores", []),
        "abstract": summarize_result.get("abstract"),
    }

@app.get("/health")
def health():
    return {"status": "ok"}