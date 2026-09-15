/** Scheme + authority match — mirrors Android PqSttBridge.originsMatch (docs/ANDROID-STT.md). */
export function originsMatch(pageUrl: string, allowedBase: string): boolean {
  try {
    const page = pageUrl.trim()
    const base = allowedBase.trim().replace(/\/+$/, '')
    // First check for about:blank to reject internal pages
    if (!page || page === 'about:blank' || page.startsWith('about:')) return false
    const pu = new URL(page)
    const bu = new URL(base)
    return (
      pu.protocol.toLowerCase() === bu.protocol.toLowerCase() &&
      pu.host.toLowerCase() === bu.host.toLowerCase()
    )
  } catch {
    return false
  }
}
