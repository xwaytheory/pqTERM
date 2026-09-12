package app.pq.remote

import android.Manifest
import android.annotation.SuppressLint
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.PermissionRequest
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
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var prefs: SharedPreferences
    private var web: WebView? = null
    private var retryOverlay: LinearLayout? = null
    private var pendingPermission: PermissionRequest? = null
    private val io = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.parseColor("#07080a")),
            navigationBarStyle = SystemBarStyle.dark(Color.parseColor("#07080a"))
        )
        prefs = getSharedPreferences("pq", MODE_PRIVATE)
        onBackPressedDispatcher.addCallback(this, backHandler)
        val url = prefs.getString("url", null)
        val token = prefs.getString("token", null)
        if (!url.isNullOrBlank() && !token.isNullOrBlank()) showWeb(url, token)
        else showPair()
    }

    private val backHandler = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            val w = web
            if (w != null && w.canGoBack()) {
                w.goBack()
                return
            }
            // keep the session alive — user returns without re-pairing/reloading
            moveTaskToBack(true)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC) {
            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            pendingPermission?.let {
                if (granted) it.grant(it.resources) else it.deny()
            }
            pendingPermission = null
        }
    }

    private fun showPair(prefill: String? = null, err: String? = null) {
        web = null
        retryOverlay = null
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
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val wantsAudio = request.resources.any { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                if (!wantsAudio) {
                    request.deny()
                    return
                }
                if (ContextCompat.checkSelfPermission(
                        this@MainActivity,
                        Manifest.permission.RECORD_AUDIO
                    ) == PackageManager.PERMISSION_GRANTED
                ) {
                    request.grant(request.resources)
                } else {
                    pendingPermission = request
                    ActivityCompat.requestPermissions(
                        this@MainActivity,
                        arrayOf(Manifest.permission.RECORD_AUDIO),
                        REQ_MIC
                    )
                }
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                hideRetry()
                injectInsets(view)
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
                // transient WAN/LAN blip — keep the pairing, offer a retry
                if (request.isForMainFrame) showRetry(base)
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
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#ed0c0e12"))
                cornerRadius = dp(7).toFloat()
            }
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
        retryOverlay = retryView(base).apply {
            visibility = View.GONE
        }
        root.addView(
            retryOverlay,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        setContentView(root)
        webView.loadUrl("$base/?token=${java.net.URLEncoder.encode(token, "UTF-8")}")
    }

    private fun retryView(base: String): LinearLayout {
        val title = label("pq nie łączy", 15f, Color.parseColor("#d6deea"))
        val msg = label("laptop/Internet niedostępny. Sprawdź, czy pq na laptopie jest włączone — połączenie wróci bez ponownego parowania.", 13f, Color.parseColor("#7a8494")).apply {
            setLineSpacing(0f, 1.15f)
        }
        val retry = Button(this).apply {
            text = "spróbuj znowu"
            setTextColor(Color.parseColor("#07080a"))
            setBackgroundColor(Color.parseColor("#39ffb6"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46))
            setOnClickListener {
                hideRetry()
                web?.reload()
            }
        }
        val other = Button(this).apply {
            text = "inne pq"
            setTextColor(Color.parseColor("#d6deea"))
            setBackgroundColor(Color.parseColor("#0c0e12"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46))
            setOnClickListener {
                prefs.edit().remove("token").apply()
                showPair(base)
            }
        }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(22), dp(22), dp(22))
            setBackgroundColor(Color.parseColor("#ed07080a"))
            addView(title)
            addView(spaceDp(10))
            addView(msg, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(spaceDp(18))
            addView(retry)
            addView(spaceDp(10))
            addView(other)
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            addView(
                col,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            )
        }
    }

    private fun showRetry(base: String) {
        val o = retryOverlay
        if (o == null) {
            retryOverlay = retryView(base)
            val root = findContentView() ?: return
            (root as? FrameLayout)?.addView(
                retryOverlay,
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            )
        }
        retryOverlay?.visibility = View.VISIBLE
    }

    private fun hideRetry() {
        retryOverlay?.visibility = View.GONE
    }

    /**
     * Android WebView only feeds display-cutout areas into env(safe-area-inset-*);
     * system-bar insets are not reported. Pass the real status/nav bars to the page
     * as --sat/--sab CSS vars so the phone UI pads punch-holes and gesture navs exactly.
     */
    private fun injectInsets(view: WebView) {
        val top: Int
        val bottom: Int
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val insets = view.rootWindowInsets
            top = insets?.getInsets(WindowInsets.Type.statusBars())?.top ?: 0
            bottom = insets?.getInsets(WindowInsets.Type.systemBars())?.bottom ?: 0
        } else {
            val insets = ViewCompat.getRootWindowInsets(view)
            top = insets?.getInsets(WindowInsetsCompat.Type.statusBars())?.top ?: 0
            bottom = insets?.getInsets(WindowInsetsCompat.Type.navigationBars())?.bottom ?: 0
        }
        view.evaluateJavascript(
            "try{document.documentElement.style.setProperty('--sat','${top}px');" +
                "document.documentElement.style.setProperty('--sab','${bottom}px')}catch(e){}",
            null
        )
    }

    private fun findContentView(): View? {
        val d = window.decorView as? ViewGroup
        return d?.getChildAt(0)
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

    companion object {
        private const val REQ_MIC = 401
    }
}