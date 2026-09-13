import { ENGINE_LOGO_FILES } from './engineLogoMeta'

/**
 * Bundled brand assets (`src/renderer/src/assets/engines/*`) keyed by engine id.
 * Vite inlines tiny SVGs as data-URIs and emits PNGs next to the bundle,
 * so the URLs work both in dev and in the packaged (`file://`) app.
 */
const modules = import.meta.glob<string>('../assets/engines/*', {
  eager: true,
  query: '?url',
  import: 'default'
})

const byFile = new Map<string, string>(
  Object.entries(modules).map(([path, url]) => [path.split('/').pop() ?? path, url])
)

export function engineLogoFile(id: string): string | undefined {
  const file = (ENGINE_LOGO_FILES as Record<string, string>)[id]
  return file ? byFile.get(file) : undefined
}

export function hasEngineLogoFile(id: string): boolean {
  return engineLogoFile(id) !== undefined
}
