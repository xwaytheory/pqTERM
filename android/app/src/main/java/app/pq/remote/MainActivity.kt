package app.pq.remote

import android.annotation.SuppressLint
import android.content.SharedPreferences
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var prefs: SharedPreferences
    private var web: WebView? = null
    private val io = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#07080a")
        window.navigationBarColor = Color.parseColor("#07080a")
        prefs = getSharedPreferences("pq", MODE_PRIVATE)
        val url = prefs.getString("url", null)
        val token = prefs.getString("token", null)
        if (!url.isNullOrBlank() && !token.isNullOrBlank()) showWeb(url, token)
        else showPair()
    }

    private fun showPair(prefill: String? = null, err: String? = null) {
        web = null
        val host = EditText(this).apply {
            hint = "https://….trycloudflare.com"
            setText(
                prefill
                    ?: prefs.getString("url", "")?.removePrefix("http://")?.removePrefix("https://")
                    ?: ""
            )
            setTextColor(Color.parseColor("#d6deea"))
            setHintTextColor(Color.parseColor("#4e5868"))
            setBackgroundColor(Color.parseColor("#0c0e12"))
            setPadding(28, 28, 28, 28)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
        }
        val pin = EditText(this).apply {
            hint = "PIN"
            setTextColor(Color.parseColor("#d6deea"))
            setHintTextColor(Color.parseColor("#4e5868"))
            setBackgroundColor(Color.parseColor("#0c0e12"))
            setPadding(28, 28, 28, 28)
            gravity = Gravity.CENTER
            letterSpacing = 0.3f
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(android.text.InputFilter.LengthFilter(6))
        }
        val status = TextView(this).apply {
            setTextColor(Color.parseColor(if (err != null) "#ff5c7a" else "#7a8494"))
            textSize = 13f
            text = err ?: "adres i PIN z pq na laptopie: ◯ → TELEFON."
        }
        val go = Button(this).apply {
            text = "połącz"
            setTextColor(Color.parseColor("#07080a"))
            setBackgroundColor(Color.parseColor("#39ffb6"))
        }
        go.setOnClickListener {
            val base = normalizeHost(host.text.toString())
            val p = pin.text.toString().trim()
            if (base == null) {
                status.setTextColor(Color.parseColor("#ff5c7a"))
                status.text = "wklej adres z panelu TELEFON"
                return@setOnClickListener
            }
            if (p.length != 6) {
                status.setTextColor(Color.parseColor("#ff5c7a"))
                status.text = "PIN ma 6 cyfr"
                return@setOnClickListener
            }
            go.isEnabled = false
            status.setTextColor(Color.parseColor("#7a8494"))
            status.text = "łączę…"
            io.execute {
                val result = pair(base, p)
                runOnUiThread {
                    go.isEnabled = true
                    result.fold(
                        onSuccess = { token ->
                            prefs.edit().putString("url", base).putString("token", token).apply()
                            showWeb(base, token)
                        },
                        onFailure = { e ->
                            status.setTextColor(Color.parseColor("#ff5c7a"))
                            status.text = e.message
                        }
                    )
                }
            }
        }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#07080a"))
            setPadding(dp(24), dp(64), dp(24), dp(24))
            addView(label("pq", 26f, Color.parseColor("#39ffb6")).apply { letterSpacing = 0.28f })
            addView(spaceDp(10))
            addView(
                label(
                    "Te same workspace’y co na laptopie. Wybierasz okno, piszesz — wykonuje się tam.",
                    14f,
                    Color.parseColor("#7a8494")
                )
            )
            addView(spaceDp(20))
            addView(label("adres", 12f, Color.parseColor("#4e5868")))
            addView(spaceDp(8))
            addView(host, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(spaceDp(14))
            addView(label("PIN", 12f, Color.parseColor("#4e5868")))
            addView(spaceDp(8))
            addView(pin, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(spaceDp(20))
            addView(go, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
            addView(spaceDp(14))
            addView(status)
        }
        setContentView(
            ScrollView(this).apply {
                setBackgroundColor(Color.parseColor("#07080a"))
                addView(col)
            }
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showWeb(base: String, token: String) {
        val webView = WebView(this)
        web = webView
        webView.setBackgroundColor(Color.parseColor("#07080a"))
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript(
                    "try{localStorage.setItem('pq-token', ${JSONObject.quote(token)})}catch(e){}",
                    null
                )
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: android.webkit.WebResourceError
            ) {
                if (request.isForMainFrame) {
                    prefs.edit().remove("token").apply()
                    showPair(base, "nie widzę laptopa. pq włączone? ten sam adres z panelu TELEFON.")
                }
            }
        }
        val s = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.userAgentString = s.userAgentString + " pq-android"
        val unpair = TextView(this).apply {
            text = "inne pq"
            setTextColor(Color.parseColor("#39ffb6"))
            textSize = 12f
            setPadding(dp(10), dp(8), dp(10), dp(8))
            setOnClickListener {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("rozłączyć?")
                    .setMessage("Wrócisz do ekranu adresu i PIN.")
                    .setPositiveButton("rozłącz") { _, _ ->
                        prefs.edit().remove("token").apply()
                        showPair(base)
                    }
                    .setNegativeButton("zostań", null)
                    .show()
            }
        }
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#07080a"))
            addView(
                webView,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            )
            addView(
                unpair,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.END
                ).apply {
                    topMargin = dp(6)
                    rightMargin = dp(6)
                }
            )
        }
        setContentView(root)
        webView.loadUrl("$base/?token=${java.net.URLEncoder.encode(token, "UTF-8")}")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val w = web
        if (w != null && w.canGoBack()) {
            w.goBack()
            return
        }
        super.onBackPressed()
    }

    private fun pair(base: String, pin: String): Result<String> {
        return try {
            val conn = URL("$base/pair").openConnection() as HttpURLConnection
            conn.connectTimeout = 20000
            conn.readTimeout = 20000
            conn.instanceFollowRedirects = true
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.outputStream.use { it.write(JSONObject().put("pin", pin).toString().toByteArray()) }
            val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader()?.readText() ?: ""
            val json = runCatching { JSONObject(body) }.getOrElse { JSONObject() }
            if (conn.responseCode in 200..299) {
                val token = json.optString("token")
                if (token.isBlank()) Result.failure(IllegalStateException("laptop nie oddał tokenu"))
                else Result.success(token)
            } else {
                Result.failure(IllegalStateException(json.optString("error").ifBlank { "HTTP ${conn.responseCode}" }))
            }
        } catch (e: Exception) {
            Result.failure(IllegalStateException("nie widzę laptopa. ${e.message}"))
        }
    }

    private fun normalizeHost(raw: String): String? {
        var s = raw.trim()
        if (s.isBlank()) return null
        s = s.replace('\\', '/').trimEnd('/')
        if (!s.startsWith("http://") && !s.startsWith("https://")) {
            val host = s.substringBefore('/').substringBefore(':').lowercase()
            val lan =
                host == "localhost" ||
                    host.endsWith(".local") ||
                    host.matches(Regex("""^\d{1,3}(\.\d{1,3}){3}$"""))
            s = (if (lan) "http://" else "https://") + s
        }
        return s
    }

    private fun label(text: String, size: Float, color: Int): TextView {
        return TextView(this).apply {
            this.text = text
            textSize = size
            setTextColor(color)
        }
    }

    private fun spaceDp(v: Int): View {
        return View(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(v))
        }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
