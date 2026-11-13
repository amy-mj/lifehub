-- LifeHub 데모 시드 데이터
-- 비밀번호 해시는 'demo1234' (PBKDF2-SHA256). ensureSchema 후 앱 로그인으로 대체 가능.

-- 데모 계정: demo@lifehub.app / demo1234
INSERT OR IGNORE INTO users (id, email, username, password_hash) VALUES
  (1, 'demo@lifehub.app', '데모유저',
   'pbkdf2$100000$-WWTG2mv0sN2vY_zvhY4aQ$HNvdnDGVCLFZC8reemwgSPDGkZzwqhlExK0Bv-3RvcM');

INSERT OR IGNORE INTO tags (id, user_id, name, color) VALUES
  (1, 1, 'work', '#6366f1'),
  (2, 1, '영어', '#10b981'),
  (3, 1, '운동', '#f59e0b'),
  (4, 1, 'reading', '#0ea5e9'),
  (5, 1, '개인', '#8b5cf6');

INSERT OR IGNORE INTO checklist_items (id, user_id, title, labels, is_completed, recurrence, completed_at) VALUES
  (1, 1, '영어 단어 30개 외우기', '["영어"]', 0, 'DAILY', NULL),
  (2, 1, '헬스장에서 운동하기', '["운동"]', 0, 'DAILY', NULL),
  (3, 1, '프로젝트 문서 작성', '["work"]', 0, 'NONE', NULL),
  (4, 1, '영어 회화 30분', '["영어"]', 1, 'DAILY', datetime('now','-1 day')),
  (5, 1, '달리기 3km', '["운동"]', 1, 'NONE', datetime('now','-2 day')),
  (6, 1, '주간 회의록 정리', '["work"]', 1, 'WEEKLY', datetime('now','-1 day'));

INSERT OR IGNORE INTO notes (id, user_id, title, content, note_type, link_url, og_title, tags, created_at) VALUES
  (1, 1, '영어 공부 계획', '매일 30분씩 단어와 회화를 병행. 주 1회 원어민 회화.', 'TEXT', NULL, NULL, '["영어"]', datetime('now','-1 day')),
  (2, 1, '추천 아티클', '생산성 향상에 관한 좋은 글', 'LINK', 'https://example.com/productivity', '생산성 향상 가이드', '["reading"]', datetime('now','-2 day')),
  (3, 1, '운동 루틴 메모', '월: 가슴, 화: 등, 수: 하체, 목: 어깨, 금: 유산소', 'TEXT', NULL, NULL, '["운동"]', datetime('now','-3 day'));

INSERT OR IGNORE INTO calendar_events (id, user_id, title, description, start_time, end_time, location, reminder_time, recurrence, tags) VALUES
  (1, 1, '팀 주간 회의', '스프린트 리뷰', datetime('now','start of day','+10 hours'), datetime('now','start of day','+11 hours'), '회의실 A', 60, 'WEEKLY', '["work"]'),
  (2, 1, '영어 회화 수업', '', datetime('now','start of day','+19 hours'), datetime('now','start of day','+20 hours'), '온라인', 15, 'WEEKLY', '["영어"]'),
  (3, 1, '헬스장', '', datetime('now','start of day','+20 hours'), datetime('now','start of day','+21 hours'), '동네 헬스장', 30, 'DAILY', '["운동"]');

INSERT OR IGNORE INTO goals (id, user_id, title, description, goal_level, target_value, measurement_type, measurement_unit, source, source_label, start_date, end_date, status, tags) VALUES
  (1, 1, '이번 달 영어 공부 20시간', '매일 꾸준히', 'MONTHLY', 20, 'DURATION', '시간', 'EVENT', '영어', date('now','start of month'), date('now','+1 month','start of month','-1 day'), 'IN_PROGRESS', '["영어"]'),
  (2, 1, '운동 습관 만들기', '주 5회 운동', 'WEEKLY', 20, 'COUNT', '회', 'CHECKLIST', '운동', date('now','-7 day'), date('now'), 'IN_PROGRESS', '["운동"]');

INSERT OR IGNORE INTO activity_log (user_id, action, entity, detail, created_at) VALUES
  (1, 'create', 'note', '영어 공부 계획', datetime('now','-1 day')),
  (1, 'complete', 'checklist', '영어 회화 30분', datetime('now','-1 day')),
  (1, 'complete', 'checklist', '달리기 3km', datetime('now','-2 day')),
  (1, 'create', 'goal', '이번 달 영어 공부 20시간', datetime('now','-3 day'));
