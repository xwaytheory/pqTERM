# Android STT — SpeechRecognizer bridge (no Whisper on phone)

**INTENT (not a runtime lock):** Phone/Android target path is system `android.speech.SpeechRecognizer`.  
Desktop **INTENT** for `pq-voice` is Whisper Large v3; the desktop product has **no STT path today** (`36d083c` removed the Electron in-renderer Whisper). Do **not** download GGML / run Whisper on the phone.

**Status 2026-09-13 (gauntlet B):** `PqSttBridge` wired into `MainActivity.showWeb` with **scheme+authority origin lock**, mic permission auto-retry, WebView `getUserMedia` audio **denied** when native bridge is present, mixed-content tightened (https → NEVER_ALLOW).

Related: `docs/BACKLOG-NIGHT.md` item 8, `MainActivity.kt`, `PqSttBridge.kt`.

## Goal

Mic button on phone UI → native STT (`pl-PL`) → text into the same remote WS command path as typed input.

## Design choices

1. **One mic path on Android:** native `SpeechRecognizer` only. WebChromeClient **denies** `RESOURCE_AUDIO_CAPTURE` while `PqSttBridge` is installed (prefer native; also origin-gated).
2. **Locale:** `pl-PL`, `RecognizerIntent.LANGUAGE_MODEL_FREE_FORM`.
3. **Partial results:** stream to JS for UI; send **final** hypothesis over remote WS as a command string (**JS glue still optional** — `onFinal` → WS not auto-wired).
4. **Errors (PL copy):** map `ERROR_INSUFFICIENT_PERMISSIONS`, `ERROR_NETWORK`, `ERROR_NO_MATCH`, `ERROR_CLIENT`, etc.
5. **Offline:** only if OEM/Google offline speech pack installed — surface “wymaga usług Google / pakietu mowy”.
6. **Origin lock:** `PqSttBridge.originsMatch` compares **scheme + authority** (not string prefix). Blocks `about:blank` and foreign hosts (incl. prefix tricks). Contract mirrored in `src/phone/src/originsMatch.ts` + `originsMatch.test.ts` (Node URL API; not a JVM harness).
7. **Mic permission:** `REQ_MIC_STT` → `onMicPermissionResult` auto-retries `startListen` after grant (no empty handler / forced double-tap).
8. **Mixed content:** `MIXED_CONTENT_NEVER_ALLOW` on https pairings; `COMPATIBILITY_MODE` only for http LAN.

## Security notes

- **XSS on an allowed origin can still call `PqStt.*`** — origin lock is not page integrity. Token-in-page / CSP remain Electron/remote concerns.
- Unpair / UI strings are UTF-8 Polish (mojibake fixed in this revise).

## Integration (live)

- Class: `app.pq.remote.PqSttBridge`
- Injected in `showWeb`: `webView.addJavascriptInterface(bridge, "PqStt")`
- API: `startListen()` / `stopListen()` / `cancel()` / `ping()` → `"ok"` | `"denied"`
- Events: `window.pqStt.onPartial` / `onFinal` / `onError` / `onStatus`
- Manifest: `RECORD_AUDIO` already present; bridge requests runtime permission (`REQ_MIC_STT = 402`)

## Phone JS glue (landed 2026-09-13)

Module: `src/phone/src/pqSttGlue.ts` — wired from `App.tsx` PaneView mic button.

- `attachPqSttGlue({ sendCommand })` sets `window.pqStt.onFinal` → same path as typed compose: `RemoteClient.write(paneId, text + "\r")`
- Partials → UI hint only (never WS)
- `isNativePqStt()` probes `PqStt.ping() === "ok"`; **no** Web Speech fallback when bridge missing
- Mic button shown only when native bridge present and pane has an engine

### Gauntlet (UX/Android)

**Propose:** thin glue + mic in existing PaneView compose bar.  
**Critics:** must not invent UI; finals = typed path; desktop without bridge stays silent.  
**Revise:** gate on `ping()`; stop/cancel on dispose; placeholder shows partial.  
**Verdict:** WARUNKOWO OK — not a full voice UX redesign.

```js
import { attachPqSttGlue, startPqSttListen } from './pqSttGlue'
attachPqSttGlue({ sendCommand: (t) => client.write(paneId, t + '\r') })
PqStt.startListen()
```

## Out of scope

- Changing remote WS protocol
- Any on-device Whisper / transformers.js path on Android
- Full voice UX redesign / continuous dictation mode
