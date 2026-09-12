# Android STT — SpeechRecognizer bridge (no Whisper on phone)

**INTENT (not a runtime lock):** Phone/Android target path is system `android.speech.SpeechRecognizer`.  
Desktop **INTENT** for `pq-voice` is Whisper Large v3; **CURRENT Electron** still uses `Xenova/whisper-tiny`. Do **not** download GGML / run Whisper on the phone.

**Status 2026-09-13 overnight:** `PqSttBridge` wired into `MainActivity.showWeb` with **origin lock** on every `@JavascriptInterface` entry. Phone JS glue still optional (bridge `ping()` / events ready).

Related: `docs/BACKLOG-NIGHT.md` item 8, `docs/MIGRATION-RUST.md` night additions,  
`android/app/src/main/java/app/pq/remote/MainActivity.kt`, `PqSttBridge.kt`.

## Goal

Mic button on phone UI → native STT (`pl-PL`) → text into the same remote WS command path as typed input.

## Design choices

1. **One mic path on Android:** native `SpeechRecognizer` only. WebView `getUserMedia` mic grant remains for legacy pages; prefer `PqStt.*` once phone UI adopts it.
2. **Locale:** `pl-PL`, `RecognizerIntent.LANGUAGE_MODEL_FREE_FORM`.
3. **Partial results:** stream to JS for UI; send **final** hypothesis over remote WS as a command string.
4. **Errors (PL copy):** map `ERROR_INSUFFICIENT_PERMISSIONS`, `ERROR_NETWORK`, `ERROR_NO_MATCH`, `ERROR_CLIENT`, etc.
5. **Offline:** only if OEM/Google offline speech pack installed — surface “wymaga usług Google / pakietu mowy”.
6. **Origin lock:** `PqSttBridge(allowedBase)` — `startListen` / `stopListen` / `cancel` / `ping` refuse unless `webView.url` is the paired base (or path/query/hash under it). Blocks `about:blank` and foreign origins.

## Integration (live)

- Class: `app.pq.remote.PqSttBridge`
- Injected in `showWeb`: `webView.addJavascriptInterface(bridge, "PqStt")`
- API: `startListen()` / `stopListen()` / `cancel()` / `ping()` → `"ok"` | `"denied"`
- Events: `window.pqStt.onPartial` / `onFinal` / `onError` / `onStatus`
- Manifest: `RECORD_AUDIO` already present; bridge requests runtime permission (`REQ_MIC_STT = 402`)

Sketch retained for reference: `android/sketch/SpeechRecognizerBridge.kt` (superseded).

## Phone JS glue

```js
window.pqStt = {
  onPartial(t) { /* hypothesis */ },
  onFinal(t)   { /* send over remote WS like typed command */ },
  onError(e)   { /* toast e.message */ },
  onStatus(s)  { /* UI phase */ },
};
// mic down / up:
PqStt.startListen();
PqStt.stopListen(); // or PqStt.cancel();
```

## Out of scope

- Changing remote WS protocol
- Any on-device Whisper / transformers.js path on Android
- Full phone UI mic button (JS still to call the bridge)