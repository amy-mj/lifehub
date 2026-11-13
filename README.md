# LifeHub — 파이썬(FastAPI) 버전

기존 Node/TypeScript 백엔드를 **Python 3.12 + FastAPI** 로 옮긴 버전입니다.
프론트엔드(`public/`)와 SQLite 데이터베이스 파일은 **원본과 100% 호환**됩니다.

## 왜 Docker 로 띄우나

cafe24 CentOS 7.9 의 glibc 는 **2.17** 입니다. 최신 Python/Node 공식 바이너리는
glibc 2.28 이상을 요구해서 호스트에 직접 설치하면 깨집니다.
컨테이너는 자체 glibc 를 들고 오므로 **호스트 OS 버전과 무관**하게 동작합니다.

## ⚠️ 이 서버(cafe24)에서 반드시 알아야 할 것

실제 서버 상태를 확인한 결과입니다.

| 확인 항목 | 실제 값 | 의미 |
|---|---|---|
| 메모리 | 990MB (여유 270MB) | |
| **swap** | **4GB (3.7GB 여유)** | 빌드 중 OOM 위험 없음 |
| 디스크 | 25GB 중 2.2GB 여유 (91%) | 300~400MB 필요 → 충분 |
| sudo | **불가** | `journalctl`/`yum` 정리 못 함 |
| **80 / 443 포트** | **cafe24 `common-nginx` 점유 중** | **우리 앱은 3000 사용** |
| 기존 컨테이너 | `common-nginx`, `common-php83/82/84`, `common-redis` | **cafe24 관리 — 건드리면 안 됨** |

### 🚫 절대 하지 말 것

```bash
# ❌ cafe24 의 PHP 사이트가 함께 죽습니다
docker system prune -a
docker volume prune
docker rmi <cafe24 이미지>

# ❌ 다른 디렉터리에서 down 을 실행하면 cafe24 스택까지 내려갈 수 있습니다
docker compose down        # (반드시 lifehub 디렉터리 안에서만)
```

이 compose 파일은 `name: lifehub` 로 프로젝트를 고정하고 컨테이너 이름을
`lifehub-py` 로 두어 cafe24 의 `common-*` 와 **절대 섞이지 않게** 했습니다.

```bash
# 안전한 정리 (우리 프로젝트만)
cd /home/mj/lifehub
docker compose down                    # 우리 것만 내림
docker builder prune -f                # 빌드 캐시만 회수 (이미지 유지)
docker system df                       # 현황 확인 (읽기 전용, 안전)
```

### 80 포트로 서비스하고 싶다면

80/443 은 이미 cafe24 nginx 가 쓰고 있어 **직접 점유할 수 없습니다.**
sudo 도 없어서 nginx 설정을 바꿀 수도 없습니다. 선택지는 셋입니다.

1. **3000 포트 그대로 쓰기 (권장, 가장 안전)**
   `http://<서버주소>:3000` 으로 접속. cafe24 방화벽에서 3000 인바운드만 허용되면 됩니다.
2. **cafe24 nginx 에 프록시 추가** — 설정 디렉터리가 쓰기 가능한지 먼저 확인:
   ```bash
   docker inspect common-nginx --format '{{json .Mounts}}'
   ```
   쓰기 가능한 conf 경로가 보이면 그 안에 `proxy_pass http://127.0.0.1:3000;` 을 넣고
   `docker exec common-nginx nginx -s reload`. root 소유라 쓰기 불가하면 불가능합니다.
3. **cafe24 고객센터에 문의** — 도메인/프록시 설정을 요청.

## 빠른 시작

```bash
# 0) 소유권 확인 (중요 — 아래 설명 참고)
id -u          # 예: 501
id -g          # 예: 501

# 1) 환경 파일 준비
cp .env.example .env
vi .env
#   JWT_SECRET  = openssl rand -hex 32 결과 붙여넣기
#   LIFEHUB_UID = 위에서 나온 id -u 값
#   LIFEHUB_GID = 위에서 나온 id -g 값
#   HOST_PORT   = 3000  (80 은 절대 넣지 마세요 — 바인딩 실패)

# 2) 데이터 디렉터리 준비
mkdir -p data

# 3) 빌드 + 실행
docker compose up -d --build

# 4) 확인
curl http://localhost:3000/api/health
docker compose logs -f --tail=50        # Ctrl+C 로 빠져나감
```

브라우저에서 `http://<서버주소>:3000` 접속 → 회원가입 또는 데모 로그인.

### 소유권 매핑이 왜 필요한가

컨테이너 안의 앱은 **uid 1000** 으로 돕니다. 그런데 `./data` 는 호스트 `mj` 소유입니다.
`mj` 의 uid 가 1000 이 아니면 SQLite 가 DB 파일을 만들지 못해
**`unable to open database file`** 로 죽습니다.

그래서 compose 의 `user:` 에 `.env` 의 `LIFEHUB_UID/GID` 를 넘깁니다.
확인 방법:

```bash
$ id -u
501
$ id -g
501
```

→ `.env` 에 `LIFEHUB_UID=501`, `LIFEHUB_GID=501`.

이미 컨테이너를 띄운 뒤라면 `./data` 소유권을 맞춰주세요:

```bash
sudo chown -R 501:501 data     # sudo 불가 시: 본인 소유면 그대로 두고 UID 만 맞추기
```

## 기존 데이터 그대로 쓰기 (중요)

원본 Node 버전이 쓰던 SQLite 파일을 **그대로** 쓸 수 있습니다.
비밀번호 해시(PBKDF2-SHA256)와 JWT(HS256) 형식이 동일하므로
**기존 사용자는 비밀번호 재설정 없이 로그인**됩니다.

```bash
# 기존 DB 백업 (필수)
cp /원본경로/lifehub.db ./lifehub.db.bak

# pyserver/data/ 에 놓으면 컨테이너의 /data 로 마운트됩니다
cp /원본경로/lifehub.db ./data/lifehub.db

docker compose up -d
```

스키마는 서버 시작 시 자동으로 보완됩니다(`ensure_schema`) — 없는 컬럼만 추가하며
기존 데이터를 지우지 않습니다. 그래도 **먼저 백업하세요**.

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `JWT_SECRET` | (필수) | 토큰 서명 키. **반드시 교체** |
| `HOST_PORT` | `3000` | 호스트 노출 포트. **80/443 은 사용 불가** (cafe24 nginx 점유) |
| `LIFEHUB_UID` | `1000` | 컨테이너 실행 uid. `id -u` 값으로 맞춰야 함 |
| `LIFEHUB_GID` | `1000` | 컨테이너 실행 gid. `id -g` 값으로 맞춰야 함 |
| `APP_NAME` | `LifeHub 개인 관리` | 헬스체크/화면에 표시될 이름 |
| `DB_PATH` | `/data/lifehub.db` | 컨테이너 내부 DB 경로 |
| `SEED_DEMO` | `0` | `1` 이면 데모 데이터 주입 (계정 없을 때만) |
| `TZ` | `UTC` | 날짜 계산이 UTC 기준이므로 UTC 유지 권장 |

## API

프론트엔드가 쓰는 경로와 완전히 동일합니다.

| 메서드 | 경로 | 인증 |
|---|---|---|
| GET | `/api/health` | 불필요 |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | 불필요 |
| GET/POST/PUT/DELETE | `/api/tags` | JWT |
| GET/POST/PUT/DELETE | `/api/notes` | JWT |
| GET/POST/PATCH/PUT/DELETE | `/api/checklist` | JWT |
| GET/POST/PUT/DELETE | `/api/calendar/events` | JWT |
| GET | `/api/calendar/lunar`, `/lunar-month`, `/holidays` | JWT |
| GET/POST/PUT/DELETE | `/api/goals`, `/api/goals/{id}/progress` | JWT |
| GET | `/api/dashboard/stats`, `/heatmap` | JWT |
| GET/PUT | `/api/settings` | JWT |

인증은 `Authorization: Bearer <token>` 헤더입니다.

## 검증 상태

원본 TypeScript 서버와 **응답을 1:1로 대조**했습니다.

| 구분 | 결과 |
|---|---|
| 조회 API (`tests/diff_test.py`) | **40/40 일치** |
| 쓰기 API (`tests/write_test.py`) | **34/34 일치** |

포함 범위: 반복 일정 전개(DAILY/WEEKLY/MONTHLY/YEARLY, 음력 기준 포함),
음력↔양력 변환(1900~2050), 대체공휴일, 공과금 휴일 보정, 목표 진척도,
대시보드 집계, 체크리스트 반복 재생성, 에러 응답 코드.

두 서버를 **동일한 DB 스냅샷**에 물려 비교하므로 `created_at` 같은
휘발성 필드만 제외하고 나머지는 완전 일치를 요구합니다.

### 직접 돌려보기

```bash
# 원본 TS 서버(3600) + 파이썬 서버(3500)를 같은 DB 스냅샷으로 띄운 뒤
python3 tests/diff_test.py  --ts http://localhost:3600 --py http://localhost:3500
python3 tests/write_test.py --ts http://localhost:3600 --py http://localhost:3500
```

## 구조

```
pyserver/
├── app/
│   ├── main.py           FastAPI 앱, 정적 파일, SPA 셸
│   ├── db.py             SQLite 계층 (스키마·마이그레이션·헬퍼)
│   ├── deps.py           JWT 인증 의존성
│   ├── helpers.py        요청 파싱/응답 헬퍼
│   ├── lunar.py          음력↔양력 (KARI 한국 테이블 1900~2050)
│   ├── holidays.py       공휴일 + 대체공휴일 + 공과금 보정
│   ├── crypto_util.py    PBKDF2-SHA256 (원본과 바이트 호환)
│   ├── jwt_util.py       JWT HS256
│   └── routes/           auth, tags, notes, checklist, calendar, goals,
│                         dashboard, settings
├── public/               프론트엔드 (원본 그대로)
├── seed.sql              데모 데이터
├── tests/                TS↔Python 차등 테스트
├── Dockerfile
├── docker-compose.yml
└── requirements.txt      fastapi, uvicorn
```

## 알아두실 점

- **`/api/dashboard/*` 는 컨테이너 시간대에 의존**합니다. 날짜 계산이 UTC 기준이므로
  `TZ=UTC` 를 유지하세요. 한국 시간 기준으로 보려면 별도 보정이 필요합니다.
- **음력 테이블은 1900~2050년**만 지원합니다. 범위 밖 날짜는 음력 정보 없이
  처리되며 크래시하지 않습니다(원본 JS는 조용히 틀린 값을 냈습니다).
- 원본 TS 의 `datePart()` 버그(공백 구분자 미처리)도 함께 수정했으므로,
  Node 버전을 계속 쓰셔도 달력이 정상 동작합니다.
