# 웹사이트 삽입과 계정 연동

아래 코드를 HTTPS 웹페이지(로컬 개발은 localhost)에 넣으면 배포된 게임을 바로 삽입합니다. 방 생성·목록에서 방 선택·매칭·방장 강퇴·AI 싱글플레이·카드·효과음은 삽입된 게임 안에서 같은 규칙과 화면으로 실행됩니다.

```html
<div id="earth-marble"></div>
<script src="https://mangocrab.github.io/EARTHMARBLE/embed.js"></script>
<script>
  const game = EarthMarble.mount("#earth-marble", { height: "100dvh" });
  // 페이지에서 게임을 제거할 때: game.destroy();
</script>
```

실행 예제: https://mangocrab.github.io/EARTHMARBLE/embed-example.html

스크립트가 배포된 경로를 자동으로 사용하므로 저장소 이름이 달라져도 동작합니다. `height`는 CSS 길이, `title`은 iframe의 접근성 이름입니다. `url`을 지정하면 자체 배포한 게임 서버를 사용할 수 있습니다.

```js
EarthMarble.mount("#earth-marble", {
  url: "https://game.your-site.example/", // 실제로 배포한 게임 주소로 교체
  height: "100dvh",
  title: "우리 사이트 지구마블",
});
```

효과음은 게임 안에서 사용자가 처음 누르거나 키를 입력한 뒤 활성화됩니다. 음량과 싱글플레이 저장은 게임 출처의 브라우저 저장소를 사용합니다. 저장소 접근이 차단된 삽입 환경에서도 현재 AI 게임은 플레이할 수 있지만 새로고침 후 복구는 할 수 없습니다. 사이트 CSP가 있다면 게임 출처를 `frame-src`, 삽입 스크립트 출처를 `script-src`에 허용하세요. WebRTC의 연결 조건과 방장이 창을 유지해야 하는 조건은 독립 실행과 같습니다.

## 기존 사이트 로그인 사용

Pages 삽입은 게임 닉네임으로 바로 실행합니다. 기존 사이트의 회원 계정으로 자동 로그인하려면 Node 서버 빌드를 배포하고 [IdentityAdapter](../identity-adapter/index.ts)를 해당 사이트의 인증에 연결합니다. `IDENTITY_ADAPTER_MODULE`을 설정하면 게임은 사이트 인증 결과로 세션을 발급하고 이후 HTTP·WebSocket 명령도 같은 계정으로 검증합니다. 사용자 ID를 iframe URL에 전달하는 방식으로 인증하지 않습니다.

사이트 주소·로그인 프로토콜이 아직 정해지지 않아 특정 사이트의 회원 연동을 완료한 상태는 아닙니다. 현재 제공하는 것은 실행 가능한 삽입 스크립트, Pages 실행 예제, 검증된 인증 어댑터 인터페이스입니다. 서명된 사이트 계정으로 방을 만드는 기존 서버 브라우저 테스트와, iframe 안의 방장/외부 브라우저 손님 간 실제 WebRTC 참가·강퇴 테스트를 함께 실행합니다.

## 프로필·전적과 서버 이모티콘

`IdentityAdapter.profile(id)`를 선택적으로 구현하면 프로필 창의 이름·사진·사이트 프로필 링크를 공급할 수 있습니다. 반환값은 `{ name?, profile?, url? }`이며 사진과 링크는 HTTPS 또는 사이트 절대 경로를 사용합니다. 로그인 연동과 별도로 나중에 추가해도 됩니다. 설정하지 않으면 임시 프로필을 표시합니다.

인증된 `GET /api/profile/:id`는 서버가 집계한 `{ id, name, profile?, url?, stats, source: "server" }`를 반환합니다. `stats`는 `2`, `3`, `4` 키마다 `{ games, wins, losses }`입니다. 게임 종료 시 서버 SQLite `game_results`에 `(game_id,user_id)`당 한 번만 저장하며 클라이언트가 승패를 제출하는 API는 없습니다. 기존 사이트에서 집계하려면 이 조회 경로 또는 같은 DB의 결과 행을 연결하세요. Pages 기기 기록은 계정 서버 전적으로 자동 승격하지 않습니다.

서버 실행 환경에서 `EMOJI_CATALOG_FILE`에 JSON 목록 파일을 지정하세요. 항목은 `{ "id": "leaf", "label": "새싹", "url": "/site-emojis/leaf.webp" }` 또는 `{ "id": "earth", "label": "지구", "text": "🌍" }`입니다. 최대 100개이며 URL은 HTTPS 또는 사이트 절대 경로만 허용합니다. `EMOJI_STATIC_DIR`을 지정하면 해당 디렉터리를 `/site-emojis`로 제공합니다. 이미 사이트에서 제공하는 HTTPS 이미지 URL도 그대로 쓸 수 있습니다. 설정 변경 후 서버를 재시작하며 새로 만든 방부터 적용됩니다. 양이·지온 원본 20종은 기본 제공되며 기존 저장 방에도 추가됩니다. `yangi_01`~`yangi_10`, `jion_01`~`jion_10` ID는 원본 전용이므로 사이트 카탈로그로 덮어쓸 수 없습니다. 매칭 게임에서는 정해진 문구와 이 원본 이모티콘만 퀵채팅으로 허용하고 자유 입력·사이트 추가 이모티콘은 서버에서 거절합니다.
