package app.pq.remote.sketch

/**
 * PASTE-READY SKETCH — not compiled into the APK yet.
 *
 * Wire from MainActivity.showWeb:
 *   webView.addJavascriptInterface(PqSttBridge(this, webView), "PqStt")
 * And call from phone JS: PqStt.startListen() / stopListen() / cancel()
 *
 * LOCKED: Android SpeechRecognizer only. Do NOT use Whisper / GGML on phone.
 */

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.ContextCompat
import org.json.JSONObject

class PqSttBridge(
    private val context: Context,
    private val webView: WebView,
) {
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var listening = false

    @JavascriptInterface
    fun startListen() {
        main.post {
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                emitError("unavailable", "wymaga usług Google / pakietu mowy")
                return@post
            }
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED
            ) {
                emitError("permission", "brak zgody na mikrofon")
                return@post
            }
            stopInternal(cancel = true)
            val sr = SpeechRecognizer.createSpeechRecognizer(context)
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
    }

    @JavascriptInterface
    fun stopListen() {
        main.post { stopInternal(cancel = false) }
    }

    @JavascriptInterface
    fun cancel() {
        main.post { stopInternal(cancel = true) }
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
}

/*
Phone JS glue (sketch):

window.pqStt = {
  onPartial(t) { /* show hypothesis */ },
  onFinal(t)   { /* send over remote WS like a typed command */ },
  onError(e)   { /* toast e.message */ },
  onStatus(s)  { /* UI phase */ },
};
// mic down:
PqStt.startListen();
// mic up / cancel:
PqStt.stopListen(); // or PqStt.cancel();
*/
