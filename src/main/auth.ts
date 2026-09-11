import { BrowserWindow, shell } from './host'
import { createHash, randomBytes } from 'crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import type { UserSession } from '../shared/types'

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function emailsIn(text: string): string[] {
  const found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  return [...new Set(found.map((e) => e.toLowerCase()))].filter(
    (e) =>
      !e.endsWith('.gserviceaccount.com') &&
      !e.endsWith('.google.com') &&
      e !== 'noreply@google.com'
  )
}

function isChooserUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.hostname !== 'accounts.google.com') return false
    const p = `${u.pathname}${u.search}`.toLowerCase()
    return (
      p.includes('accountchooser') ||
      p.includes('signin') ||
      p.includes('servicelogin') ||
      p.includes('identifier') ||
      p.includes('challenge') ||
      p.includes('rejected') ||
      p.includes('speedbump') ||
      p.includes('webauthn') ||
      p.includes('lifecycle') ||
      p.includes('recovery') ||
      p.includes('info/sessionid')
    )
  } catch {
    return true
  }
}

type Identity = { email: string; name?: string; picture?: string }

function walkEmails(node: unknown, acc: Identity[]): void {
  if (typeof node === 'string') {
    const emails = emailsIn(node)
    if (emails[0]) acc.push({ email: emails[0] })
    return
  }
  if (Array.isArray(node)) {
    const strs = node.filter((x) => typeof x === 'string') as string[]
    const email = strs.find((s) => s.includes('@') && emailsIn(s)[0])
    if (email) {
      const name = strs.find((s) => s && !s.includes('@') && !s.startsWith('http') && s.length < 80)
      const picture = strs.find((s) => s.startsWith('http') && /googleusercontent|ggpht/i.test(s))
      acc.push({ email: emailsIn(email)[0], name, picture })
    }
    for (const x of node) walkEmails(x, acc)
  }
}

function parseListAccounts(raw: string): Identity[] {
  const acc: Identity[] = []
  const cleaned = raw.replace(/^\)\]\}'\s*/, '')
  try {
    walkEmails(JSON.parse(cleaned), acc)
  } catch {
    for (const email of emailsIn(raw)) acc.push({ email })
  }
  const seen = new Set<string>()
  return acc.filter((x) => {
    if (!x.email || seen.has(x.email)) return false
    seen.add(x.email)
    return true
  })
}

async function extractIdentity(win: BrowserWindow): Promise<Identity | null> {
  const wc = win.webContents
  try {
    const raw = await wc.executeJavaScript(
      `fetch('https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&mo=1',{credentials:'include',cache:'no-store'}).then(r=>r.text()).catch(()=> '')`,
      true
    )
    const listed = parseListAccounts(String(raw ?? ''))
    if (listed[0]) return listed[0]
  } catch {
    /* page may not be ready */
  }

  try {
    const info = (await wc.executeJavaScript(
      `(() => {
        const html = document.documentElement ? document.documentElement.innerHTML : ''
        const m = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i)
        const img = document.querySelector('img[src*="googleusercontent.com"]')
        const nameEl = document.querySelector('h1')
        return {
          email: m ? m[0] : '',
          name: nameEl && nameEl.textContent ? nameEl.textContent.trim() : '',
          picture: img && img.src ? img.src : ''
        }
      })()`,
      true
    )) as { email?: string; name?: string; picture?: string }
    const email = info?.email ? emailsIn(info.email)[0] : ''
    if (email) {
      return {
        email,
        name: info.name || undefined,
        picture: info.picture || undefined
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function maskHostUa(win: BrowserWindow): void {
  try {
    const ua = win.webContents.getUserAgent().replace(/\sElec\u0074ron\/\S+/g, '')
    win.webContents.setUserAgent(ua)
  } catch {
    /* ignore */
  }
}

export async function signInWithGoogleAccount(parent?: BrowserWindow | null): Promise<UserSession> {
  const child = new BrowserWindow({
    parent: parent ?? undefined,
    modal: Boolean(parent),
    width: 520,
    height: 740,
    backgroundColor: '#07080a',
    autoHideMenuBar: true,
    title: 'pq — Google',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:pq-google'
    }
  })
  maskHostUa(child)
  child.webContents.setWindowOpenHandler(({ url }) => {
    child.loadURL(url)
    return { action: 'deny' }
  })

  const continueTo = encodeURIComponent('https://myaccount.google.com/')
  const loginUrl = `https://accounts.google.com/AccountChooser?hl=pl&continue=${continueTo}`

  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setInterval(() => {
      void tick()
    }, 900)
    const timeout = setTimeout(() => {
      finish(new Error('logowanie Google wygasło (5 min)'))
    }, 300000)

    const finish = (err: Error | null, user?: UserSession) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      clearTimeout(timeout)
      if (!child.isDestroyed()) child.close()
      if (err) reject(err)
      else if (user) resolve(user)
      else reject(new Error('nie udało się odczytać konta Google'))
    }

    const tick = async () => {
      if (settled || child.isDestroyed()) return
      const url = child.webContents.getURL()
      if (!url || isChooserUrl(url)) return
      const id = await extractIdentity(child)
      if (!id?.email) return
      finish(null, {
        email: id.email,
        name: id.name || id.email.split('@')[0],
        picture: id.picture,
        provider: 'google',
        signedInAt: Date.now()
      })
    }

    child.on('closed', () => {
      if (!settled) finish(new Error('okno logowania Google zostało zamknięte'))
    })
    child.webContents.on('did-finish-load', () => {
      void tick()
    })
    child.webContents.on('did-navigate', () => {
      void tick()
    })
    child.webContents.on('did-redirect-navigation', () => {
      void tick()
    })
    child.loadURL(loginUrl)
  })
}

function pickPort(): Promise<{ port: number; wait: Promise<string> }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('nie udało się otworzyć portu OAuth'))
        return
      }
      let done: (code: string) => void
      let fail: (err: Error) => void
      const wait = new Promise<string>((res, rej) => {
        done = res
        fail = rej
      })
      const timer = setTimeout(() => {
        fail(new Error('logowanie Google wygasło (2 min)'))
        try {
          server.close()
        } catch {
          /* ignore */
        }
      }, 120000)

      server.on('request', (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/callback') {
          res.statusCode = 404
          res.end('not found')
          return
        }
        const err = url.searchParams.get('error')
        const code = url.searchParams.get('code')
        res.setHeader('content-type', 'text/html; charset=utf-8')
        if (err || !code) {
          res.end(
            `<html><body style="background:#07080a;color:#c8d0dc;font-family:Cascadia Mono,Consolas,monospace;padding:40px">
             <h2>pq</h2><p>logowanie przerwane.</p></body></html>`
          )
          clearTimeout(timer)
          fail(new Error(err || 'brak kodu OAuth'))
          server.close()
          return
        }
        res.end(
          `<html><body style="background:#07080a;color:#39ffb6;font-family:Cascadia Mono,Consolas,monospace;padding:40px">
           <h2>pq</h2><p>zalogowano. możesz wrócić do aplikacji.</p>
           <script>setTimeout(()=>window.close(),800)</script></body></html>`
        )
        clearTimeout(timer)
        done(code)
        setTimeout(() => server.close(), 300)
      })

      resolve({ port: addr.port, wait })
    })
    server.on('error', reject)
  })
}

async function fetchJson(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init)
  const text = await res.text()
  let body: any = null
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text }
  }
  if (!res.ok) {
    const msg = body?.error_description || body?.error || text.slice(0, 200)
    throw new Error(`Google OAuth: ${msg}`)
  }
  return body
}

async function signInWithGoogleOAuth(
  clientId: string,
  clientSecret: string,
  parent?: BrowserWindow | null
): Promise<UserSession> {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const { port, wait } = await pickPort()
  const redirectUri = `http://127.0.0.1:${port}/callback`

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.searchParams.set('client_id', clientId.trim())
  auth.searchParams.set('redirect_uri', redirectUri)
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('scope', 'openid email profile')
  auth.searchParams.set('code_challenge', challenge)
  auth.searchParams.set('code_challenge_method', 'S256')
  auth.searchParams.set('access_type', 'offline')
  auth.searchParams.set('prompt', 'select_account')

  const child = new BrowserWindow({
    parent: parent ?? undefined,
    modal: Boolean(parent),
    width: 520,
    height: 740,
    backgroundColor: '#07080a',
    autoHideMenuBar: true,
    title: 'pq — Google',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  maskHostUa(child)
  child.loadURL(auth.toString())
  const closedEarly = new Promise<string>((_, rej) => {
    child.on('closed', () => rej(new Error('okno logowania Google zostało zamknięte')))
  })

  let code: string
  try {
    code = await Promise.race([wait, closedEarly])
  } finally {
    if (!child.isDestroyed()) child.close()
  }

  const body = new URLSearchParams({
    client_id: clientId.trim(),
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  })
  if (clientSecret.trim()) body.set('client_secret', clientSecret.trim())

  const tokens = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })

  const info = await fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${tokens.access_token}` }
  })

  if (!info.email) throw new Error('Google nie zwrócił adresu e-mail')

  return {
    email: String(info.email),
    name: String(info.name || info.email),
    picture: info.picture ? String(info.picture) : undefined,
    provider: 'google',
    signedInAt: Date.now()
  }
}

export async function signInWithGoogle(
  clientId: string,
  clientSecret: string,
  parent?: BrowserWindow | null
): Promise<UserSession> {
  if (clientId.trim()) {
    return signInWithGoogleOAuth(clientId, clientSecret, parent)
  }
  return signInWithGoogleAccount(parent)
}

export async function openGoogleConsole(): Promise<void> {
  await shell.openExternal('https://console.cloud.google.com/apis/credentials')
}
