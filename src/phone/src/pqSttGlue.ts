/**
 * Phone JS glue: native `PqStt` bridge → remote WS command path (same as typed).
 *
 * Android WebView injects `PqStt` (see PqSttBridge.kt). Desktop / browser without
 * the bridge: `isNativePqStt()` is false — no Web Speech fallback (honest).
 *
 * Final hypotheses go through `sendCommand(text)` which should call
 * `RemoteClient.write(paneId, text + "\r")` — identical to the compose form.
 *
 * Partials are UI-only; never sent over WS.
 */
export type PqSttHandlers = {
  onPartial?: (text: string) => void
  onFinal?: (text: string) => void
  onError?: (err: { code: string; message: string }) => void
  onStatus?: (status: { state: string }) => void
}

declare global {
  interface Window {
    pqStt?: PqSttHandlers
    PqStt?: {
      startListen: () => void
      stopListen: () => void
      cancel: () => void
      ping: () => string
    }
  }
}

export function isNativePqStt(): boolean {
  try {
    return typeof window.PqStt?.ping === 'function' && window.PqStt.ping() === 'ok'
  } catch {
    return false
  }
}

export type AttachPqSttOptions = {
  /** Send final text the same way typed input does (caller supplies RemoteClient.write). */
  sendCommand: (text: string) => void
  onPartial?: (text: string) => void
  onError?: (message: string) => void
  onStatus?: (state: string) => void
}

/**
 * Wire `window.pqStt` callbacks. Returns a dispose function that clears handlers
 * and cancels an in-flight listen when native bridge is present.
 */
export function attachPqSttGlue(opts: AttachPqSttOptions): () => void {
  const prev = window.pqStt
  window.pqStt = {
    onPartial(t: string) {
      const text = String(t || '').trim()
      if (text) opts.onPartial?.(text)
    },
    onFinal(t: string) {
      const text = String(t || '').trim()
      if (!text) return
      // Same path as typed compose: caller writes paneId + "\r"
      opts.sendCommand(text)
    },
    onError(e: { code: string; message: string }) {
      opts.onError?.(e?.message || e?.code || 'STT error')
    },
    onStatus(s: { state: string }) {
      opts.onStatus?.(s?.state || '')
    }
  }
  return () => {
    try {
      window.PqStt?.cancel?.()
    } catch {
      /* ignore */
    }
    window.pqStt = prev
  }
}

export function startPqSttListen(): boolean {
  if (!isNativePqStt()) return false
  try {
    window.PqStt!.startListen()
    return true
  } catch {
    return false
  }
}

export function stopPqSttListen(): void {
  try {
    window.PqStt?.stopListen?.()
  } catch {
    /* ignore */
  }
}
