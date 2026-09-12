# Android STT — SpeechRecognizer bridge (no Whisper on phone)

**INTENT (not a runtime lock):** Phone/Android target path is system `android.speech.SpeechRecognizer`.  
Desktop **INTENT** for `pq-voice` is Whisper Large v3; **CURRENT Electron** still uses `Xenova/whisper-tiny`. Do **not** download GGML / run Whisper on the phone.
Sketch + docs landed; MainActivity / phone JS wiring is still TODO.

Related: `docs/BACKLOG-NIGHT.md` item 8, `docs/MIGRATION-RUST.md` night additions,  
`android/app/src/main/java/app/pq/remote/MainActivity.kt` (today: WebView `RECORD_AUDIO` for `getUserMedia` only).

## Goal

Mic button on phone UI → native STT (`pl-PL`) → text into the same remote WS command path as typed input.

## Design choices

1. **One mic path on Android:** native `SpeechRecognizer` only. Deny / avoid browser `getUserMedia` STT in the WebView once the bridge is live (prevents fighting over `RECORD_AUDIO`).
2. **Locale:** `pl-PL`, `RecognizerIntent.LANGUAGE_MODEL_FREE_FORM`.
3. **Partial results:** stream to JS for UI; send **final** hypothesis over remote WS as a command string.
4. **Errors (PL copy):** map `ERROR_INSUFFICIENT_PERMISSIONS`, `ERROR_NETWORK`, `ERROR_NO_MATCH`, `ERROR_CLIENT`, etc.
5. **Offline:** only if OEM/Google offline speech pack installed — surface “wymaga usług Google / pakietu mowy”.

## Integration sketch

Prefer a `@JavascriptInterface` bridge (`PqStt`) injected in `showWeb`, callable from the phone page:

- `startListen()` / `stopListen()` / `cancel()`
- Events back via `evaluateJavascript` → `window.pqStt.onPartial(text)` / `onFinal(text)` / `onError(code, message)` / `onStatus(state)`

Paste-ready Kotlin lives in:

- `android/sketch/SpeechRecognizerBridge.kt` (standalone sketch; not wired into the APK yet)

## Manifest

Already present:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

No extra STT permission beyond `RECORD_AUDIO`.

## Out of scope tonight

- Wiring into `MainActivity` / phone frontend
- Changing remote WS protocol
- Any on-device Whisper / transformers.js path on Android
