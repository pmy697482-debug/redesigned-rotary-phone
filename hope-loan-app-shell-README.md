# 희망나누미론 앱 셸 (Capacitor)

기존에 만든 웹앱(`hope-loan-backend`)을 iOS/Android 네이티브 앱으로 감싸서 앱스토어·구글플레이에 올리기 위한 프로젝트예요. Capacitor는 웹앱을 네이티브 앱 껍데기(WebView) 안에 넣어주는 도구라서, 화면과 기능은 지금까지 만든 웹앱을 그대로 사용해요.

## 먼저 꼭 읽어주세요 — 중요한 제약

1. **여기서는 최종 설치 파일(.ipa, .aab)을 만들 수 없어요.** 이 프로젝트는 코드와 설정, 아이콘/스플래시 이미지까지 준비된 상태예요. 실제 빌드는 아래 도구가 있는 환경에서 진행하셔야 해요.
   - **Android**: Windows/Mac/Linux 아무 컴퓨터 + Android Studio (무료)
   - **iOS**: **반드시 Mac** + Xcode (무료) + Apple Developer Program 계정 (연 99달러) — Mac이 없으면 iOS 앱은 만들 수 없어요. Mac 클라우드 대여 서비스(MacStadium 등)나 지인의 Mac을 빌리는 방법도 있어요.
2. **먼저 백엔드를 실제 도메인(HTTPS)으로 배포해야 해요.** 이 앱은 `capacitor.config.json`에 적힌 주소(웹사이트)를 그대로 보여주는 방식이라, `hope-loan-backend`가 인터넷에 떠 있어야 앱이 동작해요. (Render, Railway 등에 먼저 배포해 주세요.)
3. **애플 심사 위험 요소**: 애플은 "웹사이트를 그대로 보여주기만 하는 앱"을 4.2(최소 기능) 위반으로 반려하는 경우가 있어요. 지금 상태로 바로 제출하면 반려될 가능성이 있고, 통과 확률을 높이려면 푸시 알림, 네이티브 화면 전환 같은 네이티브 기능을 추가하는 걸 권장해요. (다음 로드맵 단계인 "푸시 알림"이 여기에도 도움이 돼요.)
4. **대출 앱 심사 요건**: 애플/구글 모두 대출 앱에 최고금리(APR), 상환기간, 수수료 등을 앱 안에 명확히 표시하도록 요구해요. 구글은 Play Console에서 "금융 기능 신고서" 제출도 필요해요. 제출 전에 지금 앱 화면에 이 정보들이 들어가 있는지 확인해 주세요.

---

## 1. 준비물

- Node.js 18 이상
- Android: Android Studio 설치
- iOS: Mac + Xcode 설치 + Apple Developer Program 가입
- Google Play 개발자 계정 (최초 1회 25달러)
- 배포된 `hope-loan-backend`의 HTTPS 주소

## 2. 설정하기

```bash
cd hope-loan-app-shell
npm install
```

아래 두 파일에서 `YOUR-DEPLOYED-BACKEND-URL-여기에-실제-배포-주소-입력` 부분을 실제 배포 주소(예: `https://hope-loan.onrender.com`)로 바꿔주세요.

- `capacitor.config.json` → `server.url`
- `www/index.html` → `BACKEND_URL` 변수

`capacitor.config.json`의 `appId`(`com.hopenanumiron.app`)도 본인이 소유한 도메인 기반으로 바꾸는 걸 권장해요 (예: `kr.co.hopenanumiron.app`). **이 값은 스토어에 처음 등록한 뒤에는 바꿀 수 없으니 신중하게 정해주세요.**

## 3. 아이콘 · 스플래시 이미지

`resources/icon.png`(1024×1024)와 `resources/splash.png`(2732×2732)를 미리 만들어 뒀어요. 아래 명령으로 iOS/Android에 필요한 모든 크기를 자동 생성할 수 있어요.

```bash
npm run assets
```

원하시면 이 이미지를 다른 디자인으로 교체하고 같은 크기로 다시 저장한 뒤 같은 명령을 실행하면 돼요.

## 4. 플랫폼 추가 및 열기

```bash
npm run add:android   # android/ 폴더 생성
npm run add:ios        # ios/ 폴더 생성 (Mac에서만)
npm run sync            # 설정을 네이티브 프로젝트에 반영 (설정 바꿀 때마다 실행)
```

### Android 빌드 → Google Play

```bash
npm run open:android
```

Android Studio가 열리면: `Build` → `Generate Signed Bundle / APK` → `Android App Bundle(.aab)` 선택 → 서명 키 생성(최초 1회, **꼭 안전한 곳에 백업**) → 빌드. 생성된 `.aab` 파일을 [Google Play Console](https://play.google.com/console)에 업로드하면 돼요.

### iOS 빌드 → App Store

```bash
npm run open:ios
```

Xcode가 열리면: 상단에서 `Any iOS Device` 선택 → `Product` → `Archive` → Organizer 창에서 `Distribute App` → App Store Connect로 업로드. 이후 [App Store Connect](https://appstoreconnect.apple.com)에서 심사 제출.

## 5. 푸시 알림 설정하기 (앱이 꺼져 있어도 담당자에게 알림)

이번에 백엔드(`hope-loan-backend`)와 이 앱 셸에 푸시 알림 기능을 추가했어요. Android/iOS 모두 Firebase Cloud Messaging(FCM) 하나로 처리해요 (iOS도 Firebase가 내부적으로 APNs와 연결해줘요). 아래 순서대로 진행해 주세요.

### 5-1. Firebase 프로젝트 만들기
1. [Firebase 콘솔](https://console.firebase.google.com)에서 새 프로젝트 생성
2. **Android 앱 추가**: 패키지 이름에 `capacitor.config.json`의 `appId`와 **똑같은 값**을 입력 → `google-services.json` 다운로드 → `npx cap add android` 실행 후 생긴 `android/app/` 폴더 안에 넣기
3. **iOS 앱 추가**: 번들 ID에 역시 같은 `appId` 입력 → `GoogleService-Info.plist` 다운로드 → `npx cap add ios` 실행 후 생긴 `ios/App/App/` 폴더 안에 넣기
4. iOS는 추가로 Apple Developer 계정에서 **APNs 인증 키**를 만들어(Certificates, Identifiers & Profiles → Keys → 새 키, "Apple Push Notifications service" 체크) Firebase 콘솔의 프로젝트 설정 → Cloud Messaging 탭에 업로드해야 해요.
5. Xcode에서 앱 타깃 선택 → `Signing & Capabilities` → `+ Capability` → **Push Notifications**, **Background Modes**(Remote notifications 체크) 추가

### 5-2. 백엔드에 연결하기
1. Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → **새 비공개 키 생성** → JSON 파일 다운로드
2. 이 JSON 내용을 한 줄로 만들어 `hope-loan-backend`의 `.env` 파일 `FIREBASE_SERVICE_ACCOUNT_JSON` 값으로 붙여넣기 (백엔드 서버를 재시작해야 적용돼요)
3. 배포 환경(Render 등)에도 같은 환경변수를 등록해 주세요

### 5-3. 동기화
```bash
npm install
npm run sync
```

설정이 끝나면: 담당자가 앱에 로그인 → 자동으로 알림 권한을 요청하고 기기 토큰을 서버에 등록 → 이후 새 상담이 배정되거나 고객이 메시지를 보내면, 앱이 꺱져 있어도 휴대폰 알림이 와요. 알림을 탭하면 해당 상담 채팅방으로 바로 이동해요.

> 참고: 고객(신청자) 쪽은 로그인 계정이 없어서 이번 단계에서는 푸시 알림 대상에서 제외했어요. 필요하시면 고객용 알림도 추가로 만들어드릴 수 있어요.

## 6. 스토어 등록 전 체크리스트

- [ ] 백엔드가 HTTPS로 안정적으로 배포되어 있는가
- [ ] 개인정보처리방침(privacy policy) 페이지 URL 준비 (양쪽 스토어 필수)
- [ ] 앱 스크린샷 (기기별 규격은 각 스토어 가이드 참고)
- [ ] 대출 관련 필수 고지사항(최고금리, 상환기간, 수수료)이 앱 화면에 표시되는지 확인
- [ ] 대부중개업 등록 등 국내 법적 요건 확인
- [ ] Google Play Console에서 "금융 기능 선언" 양식 작성
- [ ] Apple/Google 심사용 테스트 계정 정보 준비 (담당자 로그인 아이디/비밀번호)

## 프로젝트 구조

```
hope-loan-app-shell/
  package.json
  capacitor.config.json     앱 이름/ID, 백엔드 주소 설정
  www/index.html            폴백 화면 (오프라인 시 또는 설정 전 표시)
  resources/
    icon.png                1024x1024 원본 아이콘
    splash.png               2732x2732 원본 스플래시
```
