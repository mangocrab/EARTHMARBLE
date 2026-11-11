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
