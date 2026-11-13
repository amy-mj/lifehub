# syntax=docker/dockerfile:1
#
# LifeHub — 파이썬(FastAPI) 이미지 (디스크 절약형)
#
# 왜 Docker 인가:
#   cafe24 CentOS 7.9 의 glibc 는 2.17 입니다. 최신 Python 공식 바이너리는
#   glibc 2.28 이상을 요구해 호스트 직접 설치 시 깨집니다.
#   컨테이너는 자체 glibc 를 들고 오므로 호스트 버전과 무관합니다.
#
# 디스크 절약 설계 (2.2GB 여유 환경 대응):
#   1) 단일 스테이지 — 2단계 빌드는 중간 레이어가 캐시에 남습니다.
#   2) build-essential 설치 안 함 — 의존성 전부 manylinux2014 휠이라
#      컴파일이 필요 없습니다. (검증: sdist 0개, 전부 manylinux_2_17/manylinux2014)
#      → 빌드 피크에서 gcc/헤더 약 150MB 절감
#   3) pip --no-cache-dir — 휠 캐시를 이미지에 남기지 않습니다.
#   4) 런타임 의존성 최소화 — uvicorn extras(uvloop/httptools/watchfiles/
#      pyyaml/websockets) 미사용으로 약 26MB 절감.

FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=3000 \
    DB_PATH=/data/lifehub.db \
    APP_NAME="LifeHub 개인 관리"

# 의존성 먼저 복사 → 소스 변경 시 이 레이어는 캐시로 재사용됩니다.
COPY requirements.txt ./
RUN pip install -r requirements.txt

# 애플리케이션 + 정적 파일 + 시드
COPY app ./app
COPY public ./public
COPY seed.sql ./seed.sql

# 비루트 사용자 (uid 1000) — 컨테이너 탈취 시 피해 최소화
RUN useradd --create-home --uid 1000 lifehub \
 && mkdir -p /data \
 && chown -R lifehub:lifehub /app /data

USER lifehub

EXPOSE 3000
VOLUME ["/data"]

# 컨테이너 헬스체크 (docker ps 에 healthy 표시)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,os,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','3000')+'/api/health',timeout=4).status==200 else 1)"

# --app-dir 을 app/ 으로 주어 `from db import ...` 평면 임포트가 동작하게 합니다.
# --workers 1: 1GB RAM / 1 vCPU 환경에서 워커를 늘리면 OOM 위험이 커집니다.
# ⚠️ --forwarded-allow-ips='*' 의 * 는 반드시 따옴표로 감싸야 합니다.
#    sh -c 안에서 따옴표가 없으면 셸 글롭이 /app 디렉터리 파일명으로 확장됩니다.
CMD ["sh", "-c", "exec uvicorn main:app --app-dir /app/app --host 0.0.0.0 --port ${PORT:-3000} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
