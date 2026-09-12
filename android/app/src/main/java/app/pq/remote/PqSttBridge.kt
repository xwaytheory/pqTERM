package app.pq.remote

/**
 * Native SpeechRecognizer bridge for the phone WebView (`PqStt` JS interface).
 *
 * INTENT: Android SpeechRecognizer only — do NOT use Whisper / GGML on phone.
 * Security: every @JavascriptInterface entry checks [originAllowed] (scheme+authority).
 *
 * Note: XSS on an *allowed* origin can still call PqStt — origin lock ≠ page integrity.
 * Phone JS glue for onFinal → remote WS is optional; see docs/ANDROID-STT.md.
 */

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

class PqSttBridge(
    private val activity: Activity,
    private val webView: WebView,
    /** Paired remote base, e.g. https://xxx.trycloudflare.com — origin lock root. */
    private val allowedBase: String,
) {
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    /** True after we requested mic and are waiting to auto-retry startListen. */
    private var pendingStartAfterPermission = false

    /** scheme + authority (host[:port]) match — not a string prefix (avoids evil.com matching evil.com.attacker). */
    fun originAllowed(): Boolean {
        val url = webView.url ?: return false
        if (url == "about:blank" || url.startsWith("about:")) return false
        return originsMatch(url, allowedBase)
    }

    private fun rejectIfBadOrigin(action: String): Boolean {
        if (originAllowed()) return false
        emitError("origin", "zablokowano $action — niedozwolone źródło strony")
        return true
    }

    @JavascriptInterface
    fun startListen() {
        main.post { startListenInternal() }
    }

    /** Called from Activity after REQ_MIC_STT grant (avoids empty handler / double-tap). */
    fun onMicPermissionResult(granted: Boolean) {
        main.post {
            if (!granted) {
                pendingStartAfterPermission = false
                emitError("permission", "brak zgody na mikrofon")
                return@post
            }
            if (pendingStartAfterPermission) {
                pendingStartAfterPermission = false
                startListenInternal()
            }
        }
    }

    private fun startListenInternal() {
        if (rejectIfBadOrigin("startListen")) return
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            emitError("unavailable", "wymaga usług Google / pakietu mowy")
            return
        }
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            pendingStartAfterPermission = true
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                REQ_MIC_STT,
            )
            // Do not emit error yet — Activity will call onMicPermissionResult.
            return
        }
        stopInternal(cancel = true)
        val sr = SpeechRecognizer.createSpeechRecognizer(activity)
        recognizer = sr
        sr.setRecognitionListener(listener)
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pl-PL")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        }
        listening = true
        emitStatus("listening")
        sr.startListening(intent)
    }

    @JavascriptInterface
    fun stopListen() {
        main.post {
            if (rejectIfBadOrigin("stopListen")) return@post
            stopInternal(cancel = false)
        }
    }

    @JavascriptInterface
    fun cancel() {
        main.post {
            if (rejectIfBadOrigin("cancel")) return@post
            stopInternal(cancel = true)
        }
    }

    /** JS can probe whether the native bridge is present and origin-locked. */
    @JavascriptInterface
    fun ping(): String {
        if (!originAllowed()) return "denied"
        return "ok"
    }

    fun destroy() {
        main.post {
            pendingStartAfterPermission = false
            stopInternal(cancel = true)
        }
    }

    private fun stopInternal(cancel: Boolean) {
        val sr = recognizer ?: return
        try {
            if (cancel) sr.cancel() else sr.stopListening()
        } catch (_: Exception) {
        }
        try {
            sr.destroy()
        } catch (_: Exception) {
        }
        recognizer = null
        if (listening) {
            listening = false
            emitStatus(if (cancel) "cancelled" else "idle")
        }
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = emitStatus("ready")
        override fun onBeginningOfSpeech() = emitStatus("speech")
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() = emitStatus("processing")
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onError(error: Int) {
            listening = false
            val (code, msg) = when (error) {
                SpeechRecognizer.ERROR_AUDIO -> "audio" to "błąd audio"
                SpeechRecognizer.ERROR_CLIENT -> "client" to "błąd klienta STT"
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                    "permission" to "brak zgody na mikrofon"
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
                    "network" to "wymaga usług Google / sieci (lub pakietu mowy offline)"
                SpeechRecognizer.ERROR_NO_MATCH -> "no_match" to "nie rozpoznano mowy"
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy" to "STT zajęty"
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "timeout" to "brak mowy"
                else -> "error_$error" to "błąd STT ($error)"
            }
            emitError(code, msg)
            emitStatus("idle")
            stopInternal(cancel = true)
        }

        override fun onPartialResults(partialResults: Bundle?) {
            val text = firstResult(partialResults) ?: return
            emitJs("onPartial", text)
        }

        override fun onResults(results: Bundle?) {
            listening = false
            val text = firstResult(results).orEmpty()
            if (text.isNotBlank()) emitJs("onFinal", text)
            emitStatus("idle")
            stopInternal(cancel = false)
        }
    }

    private fun firstResult(bundle: Bundle?): String? {
        val list = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return null
        return list.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
    }

    private fun emitStatus(state: String) {
        val payload = JSONObject().put("state", state).toString()
        eval("try{window.pqStt&&window.pqStt.onStatus&&window.pqStt.onStatus($payload)}catch(e){}")
    }

    private fun emitError(code: String, message: String) {
        val payload = JSONObject().put("code", code).put("message", message).toString()
        eval("try{window.pqStt&&window.pqStt.onError&&window.pqStt.onError($payload)}catch(e){}")
    }

    private fun emitJs(fn: String, text: String) {
        val q = JSONObject.quote(text)
        eval("try{window.pqStt&&window.pqStt.$fn&&window.pqStt.$fn($q)}catch(e){}")
    }

    private fun eval(js: String) {
        main.post { webView.evaluateJavascript(js, null) }
    }

    companion object {
        const val REQ_MIC_STT = 402

        /** Compare scheme + authority only (path/query/hash ignored). */
        fun originsMatch(pageUrl: String, allowedBase: String): Boolean {
            return try {
                val page = Uri.parse(pageUrl.trim())
                val base = Uri.parse(allowedBase.trim().trimEnd('/'))
                val ps = page.scheme?.lowercase() ?: return false
                val bs = base.scheme?.lowercase() ?: return false
                val pa = page.authority?.lowercase() ?: return false
                val ba = base.authority?.lowercase() ?: return false
                ps == bs && pa == ba
            } catch (_: Exception) {
                false
            }
        }
    }
}
