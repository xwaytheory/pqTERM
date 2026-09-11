package app.pq.remote

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("pq", MODE_PRIVATE)
        val url = prefs.getString("url", null)
        val web = WebView(this)
        setContentView(web)
        web.webViewClient = WebViewClient()
        web.webChromeClient = WebChromeClient()
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        if (url.isNullOrBlank()) {
            web.loadDataWithBaseURL(
                null,
                """
                <html><body style="background:#07080a;color:#39ffb6;font-family:monospace;padding:24px">
                <h1>pq</h1>
                <p>W pq na laptopie: przycisk ◯ → włącz remote. Na telefonie Chrome otwórz ten URL i PIN.</p>
                <p>Potem wklej URL tutaj (SharedPreferences key url) albo użyj Chrome jako klienta — to ten sam UI.</p>
                </body></html>
                """.trimIndent(),
                "text/html",
                "utf-8",
                null
            )
        } else {
            web.loadUrl(url)
        }
    }
}
