# 클라우드 환경 재사용

작업마다 클라우드 환경은 이미 격리되어 있습니다. `/workspace/EARTHMARBLE`의 기존 체크아웃을 사용하며 사용자가 요청하지 않는 한 Git worktree를 새로 만들지 않습니다.

Node.js 24 이상이 필요합니다. `bash scripts/setup.sh`는 고정된 lockfile로 의존성을 설치하고 타입 검사 및 클라이언트 빌드를 실행합니다. SQLite는 Node 내장 모듈이며 별도 서비스나 API 키가 필요하지 않습니다.

파일과 `.data/earth.sqlite`는 보관할 수 있지만 실행 중인 프로세스는 다음 작업에서 다시 시작해야 합니다.

```sh
cd /workspace/EARTHMARBLE
npm run dev
```

개발 서버를 지속되는 터미널에서 실행합니다. 기본 포트는 3000입니다. 이미 같은 포트에 서버가 있으면 본 작업에서 시작한 프로세스인지 확인하고 불필요한 중복 실행을 피합니다. 운영 확인은 `npm run build` 후 `npm start`를 대신 사용합니다.

```sh
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/
```

첫 번째는 `{"ok":true}`, 두 번째는 React 진입 HTML을 반환해야 합니다. 기능 확인은 닉네임 → 방 만들기 → AI 초대 → 준비 완료 → 탐사 시작으로 진행합니다. 자동 검증은 `npm test`, `npm run build`, `npm run test:e2e`입니다. 브라우저 검증에는 이 환경의 `/usr/bin/chromium`을 사용합니다. 테스트는 다른 포트와 DB를 사용합니다.

사용자 변경과 `.data`를 보존합니다. 외부 사이트 연동 및 운영 범위는 [README](../README.md)와 [검증 기록](VALIDATION.md)을 참고하세요. 환경 게시나 외부 배포는 사용자 지시 없이 수행하지 않습니다.

환경 설정 도구가 초안 조회와 저장에 모두 `INVALID_ARGUMENT`를 반환하여 `install_script`/`start_skill`의 플랫폼 저장은 확인하지 못했습니다. 이 문서와 `scripts/setup.sh`는 저장소에서 검토·재사용할 수 있는 동일 목적의 지침입니다. 플랫폼 초안 저장 성공 또는 새 작업에서의 복원 성공을 의미하지 않습니다.
