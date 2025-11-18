#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from dataclasses import dataclass
from typing import List, Tuple, Optional, Dict

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
import networkx as nx
import kss

"""
TextRank 기반 뉴스 핵심 요약

- 전처리(clean_text) → 문장 분리(kss) → TF-IDF(문자 n-gram) 임베딩
- 코사인 유사도 행렬 → kNN 그래프 → PageRank 중심성
- 위치(리드)·문서 중심성·BM25(제목+리드 관련도) 신호 결합
- MMR로 중요도/비중복성 균형을 맞춰 k개 문장 선택

본 파일은 CLI로도 실행 가능하며, JSON 출력 옵션을 제공함.
"""

"""
[How to use]

# 가상환경 생성 및 활성화
    cd /Users/geonwoo/KHU_Dev/DataCapstone
    python3 -m venv .venv
    source .venv/bin/activate    # Windows: .venv\\Scripts\\activate
    python -m pip install -U pip setuptools wheel

# 의존성 설치
    python -m pip install numpy scikit-learn networkx kss
    
# CLI 실행 예시

    # 텍스트 입력, 3문장 요약, JSON 출력
    python BreezeRead/filename.py \\
        --text "some text..." \\
        --top-k 3 \\
        --json
        
    # 파일 입력, 5문장 요약, JSON 출력
        python BreezeRead/filename.py \\
        --file /path/to/input.txt \\
        --top-k 5\\
        --json
"""

# 제거 대상 패턴(캡션/저작권/광고 문구 등)
CAPTION_PATTERNS = [
    r"\(사진=[^)]+\)",
    r"\(영상=[^)]+\)",
    r"ⓒ[^\\n]+",
    r"무단전재\s*및\s*재배포\s*금지",
]

# -------------------------
# 전처리: 캡션/저작권/HTML/공백 정리
# -------------------------
def clean_text(text: str) -> str:
    """입력 텍스트에서 캡션/저작권/광고 성 문구와 HTML 태그, 과도한 공백/개행을 제거한다.

    Args:
        str: 원문 텍스트

    Returns:
        str: 전처리된 텍스트(불필요한 문구/태그/공백이 정리된 문자열)
    """
    t = text
    # 숨은 공백/분리자 정리
    t = t.replace("\u200b", " ").replace("\u200c", " ").replace("\u200d", " ")
    t = t.replace("\u00a0", " ")
    t = t.replace("\u2028", " ").replace("\u2029", " ")
    
    for pat in CAPTION_PATTERNS:
        t = re.sub(pat, " ", t)
    t = re.sub(r"<[^>]+>", " ", t)      # HTML 태그 제거
    t = re.sub(r"[ \t]+", " ", t)       # 과도한 공백 축소
    t = re.sub(r"\n{2,}", "\n", t)      # 과도한 개행 축소
    # 제어문자(\x00~\x1F) 제거(단, \n은 보존)
    t = re.sub(r"[\x00-\x09\x0B-\x1F]", " ", t)
    return t.strip()


# -------------------------
# 문장 분리: kss 사용, 짧거나 무의미한 문장 제거
# -------------------------
def split_sentences(text: str) -> List[str]:
    """kss로 한국어 문장을 분리한 뒤, 너무 짧거나 인용부호만 있는 문장을 제거한다.

    Args:
        str: 전처리된 텍스트

    Returns:
        List[str]: 필터링 완료된 문장 리스트
    """
    sents = [s.strip() for s in kss.split_sentences(text) if s.strip()]
    res = []
    for s in sents:
        if len(s) < 8:
            continue
        if re.match(r"^['\"“”‘’]+$", s):
            continue
        res.append(s)
    return res


# -------------------------
# 벡터화 및 유사도 계산
# - 문자 n-gram TF-IDF(기본 2~5)로 문장 임베딩
# -------------------------
def char_ngram_vectorize(
    sentences: List[str],
    ngram_range: Tuple[int, int] = (2, 5),
    max_features: Optional[int] = None,
) -> Tuple[TfidfVectorizer, "np.ndarray"]:
    """문자 n-gram TF-IDF로 문장 임베딩을 생성한다.

    Args:
        sentences: 문장 리스트
        ngram_range: 문자 n-gram 범위(기본 2~5)
        max_features: TF-IDF 차원 상한(None이면 제한 없음)

    Returns:
        (학습된 TfidfVectorizer, 희소 행렬 X[n_sent x dim])
    """
    vectorizer = TfidfVectorizer(
        analyzer="char",
        ngram_range=ngram_range,
        sublinear_tf=True,
        lowercase=False,
        max_features=max_features,
        norm="l2",
    )
    X = vectorizer.fit_transform(sentences)
    return vectorizer, X


def cosine_sim_matrix_from_tfidf(X) -> "np.ndarray":
    """L2 정규화된 TF-IDF 행렬로부터 코사인 유사도 행렬을 계산한다.

    Notes:
        - 희소 행렬 X를 사용하면 (X * X^T)로 빠르게 계산 가능
        - 대각선(자기 유사도)은 0으로 설정

    Args:
        X: TF-IDF 행렬(문장 x 특성)

    Returns:
        코사인 유사도 행렬(ndarray, 대각 0)
    """
    sim = (X * X.T).toarray()
    np.fill_diagonal(sim, 0.0)
    sim[sim < 0] = 0  # 수치적 안전장치
    return sim


def build_knn_graph(sim: "np.ndarray", top_k: int = 8, symmetrize: bool = True) -> "np.ndarray":
    """코사인 유사도 행렬을 kNN 방식으로 희소화한 인접 행렬을 만든다.

    Args:
        sim: 문장 간 코사인 유사도 행렬
        top_k: 각 문장에서 유지할 상위 이웃 수(k)
        symmetrize: True면 max(A, A^T)로 대칭화

    Returns:
        kNN 인접 행렬(가중치 = 유사도)
    """
    n = sim.shape[0]
    if n == 0:
        return sim
    A = np.zeros_like(sim, dtype=float)
    k = max(1, min(top_k, n - 1))
    for i in range(n):
        # 자기 자신 포함 상위 (k+1) 선택 후 자기 자신 제외
        idxs = np.argpartition(sim[i], -k-1)[-k-1:]
        for j in idxs:
            if j == i:
                continue
            A[i, j] = sim[i, j]
    if symmetrize:
        A = np.maximum(A, A.T)
    return A


# -------------------------
# BM25 점수 측정 객체
# -------------------------
@dataclass
class BM25Okapi:
    """문장 토큰화 결과를 이용한 간단 BM25 점수 계산"""

    docs: List[List[str]]
    k1: float = 1.5
    b: float = 0.75

    def __post_init__(self):
        """문서(문장) 길이, DF, 평균 길이 등을 미리 계산한다."""
        self.doc_freq: Dict[str, int] = {}
        self.doc_len = [len(d) for d in self.docs]
        self.avgdl = (sum(self.doc_len) / len(self.doc_len)) if self.doc_len else 0.0
        for d in self.docs:
            uniq = set(d)
            for t in uniq:
                self.doc_freq[t] = self.doc_freq.get(t, 0) + 1
        self.N = len(self.docs)

    def idf(self, term: str) -> float:
        """smoothing을 적용한 IDF(BM25+ 형태)를 계산한다."""
        df = self.doc_freq.get(term, 0)
        return math.log(1 + (self.N - df + 0.5) / (df + 0.5))

    def score(self, query: List[str], index: int) -> float:
        """단일 문장(index)에 대한 BM25 점수를 계산한다.

        Args:
            query: 질의 토큰 리스트(제목+리드문 파생)
            index: 점수를 구할 문장 인덱스

        Returns:
            BM25 점수(부동소수)
        """
        d = self.docs[index]
        if not d:
            return 0.0
        score = 0.0
        dl = self.doc_len[index]
        K = self.k1 * (1.0 - self.b + self.b * (dl / (self.avgdl + 1e-9)))
        tf_counts: Dict[str, int] = {}
        for t in d:
            tf_counts[t] = tf_counts.get(t, 0) + 1
        for q in query:
            if q not in tf_counts:
                continue
            tf = tf_counts[q]
            idf = self.idf(q)
            score += idf * ((tf * (self.k1 + 1.0)) / (tf + K))
        return score

    def get_scores(self, query: List[str]) -> List[float]:
        """모든 문장에 대한 BM25 점수 리스트를 반환한다."""
        return [self.score(query, i) for i in range(self.N)]


# -------------------------
# 질의 구성 및 BM25 점수 벡터 생성
# -------------------------
def whitespace_tokenize(s: str) -> List[str]:
    """공백 기준의 아주 단순한 토크나이저(언어 불문)."""
    return [w for w in re.split(r"\s+", s.strip()) if w]


def build_bm25_scores(
    sentences: List[str],
    title: Optional[str] = None,
    lede_count: int = 3
) -> "np.ndarray":
    """제목과 리드문을 질의로 삼아 각 문장에 대한 BM25 점수를 계산한다.

    Args:
        sentences: 문장 리스트
        title: 기사 제목(있으면 질의에 포함)
        lede_count: 리드 문장 개수(기본 3개)를 질의에 포함

    Returns:
        BM25 점수 벡터(ndarray)
    """
    docs = [whitespace_tokenize(s) for s in sentences]
    bm25 = BM25Okapi(docs)
    query_tokens: List[str] = []
    if title:
        query_tokens += whitespace_tokenize(title)
    for s in sentences[: max(0, lede_count)]:
        query_tokens += whitespace_tokenize(s)
    # 너무 긴 질의 방지: 중복 제거 후 상한 128 토큰
    query_tokens = list(dict.fromkeys(query_tokens))[:128]
    scores = bm25.get_scores(query_tokens)
    return np.array(scores, dtype=float)


# -------------------------
# 점수 정규화/결합 및 선택
# -------------------------
def zscore(x: "np.ndarray") -> "np.ndarray":
    """z-score 정규화(평균 0, 표준편차 1)로 스케일을 맞춘다."""
    if x.size == 0:
        return x
    mu = x.mean()
    sd = x.std()
    if sd < 1e-12:
        return np.zeros_like(x)
    return (x - mu) / (sd + 1e-12)


def sentence_to_doc_similarity(X) -> "np.ndarray":
    """문서 센트로이드(평균 벡터)와 각 문장의 코사인 유사도를 계산한다.

    Notes:
        - X가 L2 정규화된 TF-IDF라면 평균 후 노멀라이즈하여 점곱이 코사인이 된다.

    Args:
        X: TF-IDF 행렬(문장 x 특성)

    Returns:
        각 문장 대비 문서 중심 벡터와의 유사도(0~1)
    """
    doc_vec = X.mean(axis=0)
    if hasattr(doc_vec, "A1"):  # 희소 → 1D 배열
        doc_vec = doc_vec.A1
    doc_norm = np.linalg.norm(doc_vec) + 1e-12
    doc_vec = doc_vec / doc_norm
    if hasattr(X, "toarray"):
        X_dense = X.toarray()
    else:
        X_dense = X
    sims = X_dense.dot(doc_vec)
    return np.maximum(sims, 0.0)


def compute_final_scores(
    sentences: List[str],
    title: Optional[str],
    X,
    sim_knn: "np.ndarray",
    pr_damping: float = 0.85,
    lead_bias: float = 0.15,
    content_weight: float = 0.35,
    bm25_weight: float = 0.30
) -> "np.ndarray":
    """PageRank/위치/내용중심/BM25 신호를 z-score로 정규화 후 가중합하여 최종 점수를 만든다.

    Args:
        sentences: 문장 리스트
        title: 제목(있으면 BM25 질의에 활용)
        X: TF-IDF 행렬
        sim_knn: kNN 인접 행렬
        pr_damping: PageRank 감쇠 계수
        lead_bias: 위치(앞 문장 우대) 가중
        content_weight: 문서 중심 유사도 가중
        bm25_weight: BM25(제목/리드 관련도) 가중

    Returns:
        최종 중요도 점수 벡터
    """
    n = len(sentences)
    if n == 0:
        return np.array([])

    # 1) 그래프 중심성(PageRank)
    G = nx.from_numpy_array(sim_knn)
    pr_dict = nx.pagerank(G, alpha=pr_damping, tol=1e-6, max_iter=100, weight="weight")
    pr = np.array([pr_dict[i] for i in range(n)], dtype=float)
    pr = zscore(pr)

    # 2) 위치(리드) 우대: 앞쪽 문장일수록 큰 값
    pos_prior = np.array([(n - i) / n for i in range(n)], dtype=float)
    pos_prior = zscore(pos_prior)

    # 3) 내용 중심성(문서 센트로이드와의 유사도)
    content_sim = sentence_to_doc_similarity(X)
    content_sim = zscore(content_sim)

    # 4) 제목/리드 관련도(BM25)
    bm25 = build_bm25_scores(sentences, title=title, lede_count=3)
    bm25 = zscore(bm25)

    # 가중 합산(합이 1을 넘지 않도록; 남은 비율은 PageRank로)
    alpha = max(0.0, min(1.0, lead_bias))
    beta = max(0.0, min(1.0, content_weight))
    gamma = max(0.0, min(1.0, bm25_weight))
    residual = max(0.0, 1.0 - (alpha + beta + gamma))
    final = residual * pr + alpha * pos_prior + beta * content_sim + gamma * bm25
    return final


def mmr_select(
    k: int,
    scores: "np.ndarray",
    sim_full: "np.ndarray",
    lambda_: float = 0.70
) -> List[int]:
    """MMR(Maximal Marginal Relevance)로 중요도와 비중복성을 균형 있게 선택한다.

    Args:
        k: 선택할 문장 수
        scores: 각 문장의 중요도 점수
        sim_full: 문장 간 코사인 유사도(전체 행렬)
        lambda_: 중요도(λ)–신정보(1-λ) 트레이드오프

    Returns:
        선택된 문장 인덱스 리스트(원문 순서 정렬은 호출부에서 처리)
    """
    n = len(scores)
    candidates = set(range(n))
    selected: List[int] = []

    while len(selected) < min(k, n) and candidates:
        best_i = None
        best_val = -1e12
        for i in candidates:
            if selected:
                max_sim_to_selected = max(sim_full[i, j] for j in selected)
            else:
                max_sim_to_selected = 0.0
            val = lambda_ * scores[i] - (1.0 - lambda_) * max_sim_to_selected
            if val > best_val:
                best_val = val
                best_i = i
        selected.append(best_i)  # type: ignore
        candidates.remove(best_i)  # type: ignore
    return selected


# -------------------------
# Summarizer 객체
# -------------------------
@dataclass
class EnhancedTextRankConfig:
    """Summarizer 동작 관련 파라미터 모음"""
    top_k: int = 5
    max_sentences: int = 400         # 대규모 문서 방어(문장 수 상한)
    min_char_len: int = 8            # 너무 짧은 문장 제거 기준
    ngram_range: Tuple[int, int] = (2, 5)
    max_features: Optional[int] = 40000  # TF-IDF 차원 상한(None이면 무제한)
    edge_top_k: int = 8              # kNN 그래프의 k
    mmr_lambda: float = 0.70
    dedup_threshold: float = 0.85    # (추가 중복 제어 필요 시 사용 가능)
    lead_bias: float = 0.10
    content_weight: float = 0.35
    bm25_weight: float = 0.30
    pr_damping: float = 0.85
    title: Optional[str] = None
    language: str = "ko"


class EnhancedTextRankSummarizer:
    """Enhanced TextRank 파이프라인 구현체."""

    def __init__(self, config: EnhancedTextRankConfig):
        """설정(config)을 받아 요약기를 초기화한다."""
        self.cfg = config

    def _preprocess(self, text: str) -> List[str]:
        """전처리 → 문장 분리 → 짧은 문장 제거 → 문장 수 상한 적용까지 수행한다.

        Args:
            text: 원문 텍스트

        Returns:
            요약 입력으로 사용할 문장 리스트
        """
        text = clean_text(text)
        sents = split_sentences(text)  # kss 필수 사용
        sents = [s for s in sents if len(s) >= self.cfg.min_char_len]
        if len(sents) > self.cfg.max_sentences:
            sents = sents[: self.cfg.max_sentences]
        return sents

    def summarize(self, text: str) -> Dict:
        """주요 문장 요약(추출 요약)을 수행한다.

        Args:
            text: 원문 텍스트

        Returns:
            {
              "sentences": [선택된 문장들],
              "indices": [선택된 문장 인덱스(원문 기준, 오름차순)],
              "scores": [각 문장의 최종 점수]
            }
        """
        sents = self._preprocess(text)
        if not sents:
            return {"sentences": [], "indices": [], "scores": []}
        if len(sents) <= self.cfg.top_k:
            indices = list(range(len(sents)))
            res = {"sentences": sents, "indices": indices, "scores": [1.0] * len(sents)}
            return res

        # 1) TF-IDF 임베딩
        vectorizer, X = char_ngram_vectorize(
            sents, ngram_range=self.cfg.ngram_range, max_features=self.cfg.max_features
        )
        # 2) 유사도 행렬 및 kNN 그래프
        sim_full = cosine_sim_matrix_from_tfidf(X)
        sim_knn = build_knn_graph(sim_full, top_k=self.cfg.edge_top_k, symmetrize=True)

        # 3) 다중 신호 결합 점수
        scores = compute_final_scores(
            sentences=sents,
            title=self.cfg.title,
            X=X,
            sim_knn=sim_knn,
            pr_damping=self.cfg.pr_damping,
            lead_bias=self.cfg.lead_bias,
            content_weight=self.cfg.content_weight,
            bm25_weight=self.cfg.bm25_weight,
        )

        # 4) MMR로 중복 억제하며 k개 선택
        selected = mmr_select(self.cfg.top_k, scores, sim_full, lambda_=self.cfg.mmr_lambda)

        # 5) 가독성을 위해 원문 순서로 정렬
        selected_sorted = sorted(selected)
        summary_sents = [sents[i] for i in selected_sorted]
        summary_scores = [float(scores[i]) for i in selected_sorted]

        result = {
            "sentences": summary_sents,
            "indices": selected_sorted,
            "scores": summary_scores,
        }
        return result


# -------------------------
# CLI 유틸
# -------------------------
def estimate_read_time_min(text: str, chars_per_min: int = 350) -> int:
    """대략적인 읽기 시간(분)을 추정한다.

    단순히 문자 수 / 분당 문자 처리량(기본 350자/분)으로 계산하며,
    최소 1분을 반환한다.

    Args:
        text: 원문 텍스트
        chars_per_min: 분당 읽는 문자 수 가정

    Returns:
        분 단위 정수(ceil)
    """
    return max(1, math.ceil(len(text) / max(1, chars_per_min)))


def main():
    """CLI Entry: 파일/문자열/STDIN 입력을 받아 요약 결과를 출력한다."""
    ap = argparse.ArgumentParser(description="TextRank_Summarizer")
    ap.add_argument("-f", "--file", type=str, help="입력 텍스트 파일 경로(선택)")
    ap.add_argument("--text", type=str, default=None, help="파일 대신 직접 본문 문자열을 전달")
    ap.add_argument("--top-k", type=int, default=5, help="선택할 요약 문장 수")
    ap.add_argument("--title", type=str, default=None, help="기사 제목(있으면 BM25 관련도 개선)")
    ap.add_argument("--json", action="store_true", help="JSON 형식으로 출력")
    args = ap.parse_args()

    # 입력 우선순위: --text > --file > STDIN
    if args.text is not None:
        text = args.text
    elif args.file:
        with open(args.file, "r", encoding="utf-8") as rf:
            text = rf.read()
    else:
        text = sys.stdin.read()

    cfg = EnhancedTextRankConfig(
        top_k=args.top_k,
        title=args.title,
    )
    etr = EnhancedTextRankSummarizer(cfg)
    res = etr.summarize(text)

    if args.json:
        meta = {
            "top_k": args.top_k,
            "title": args.title,
            "read_time_min": estimate_read_time_min(text),
        }
        out = {"meta": meta, "result": res}
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        for s in res.get("sentences", []):
            print(s)

if __name__ == "__main__":
    main()
