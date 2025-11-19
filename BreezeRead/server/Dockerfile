# 1. Python 3.11 slim 이미지 사용
FROM python:3.11-slim

# 2. 기본 환경 설정
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 3. 작업 디렉토리 설정
WORKDIR /app

# 4. 의존성 먼저 설치 (캐시 활용)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. 애플리케이션 코드 복사
COPY . .

# 6. Cloud Run / 로컬 공통 실행 커맨드
# - Cloud Run: 환경변수 PORT를 내려줌 → 그 포트로 uvicorn 실행
# - 로컬 Docker: PORT가 없으면 기본 8080으로 실행
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
