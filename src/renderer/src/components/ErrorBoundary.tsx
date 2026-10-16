import { Component, type ReactNode } from 'react'

/** Classic ErrorBoundary: a render throw in one subtree does not unload the
 *  whole UI. Mounted globally (main.tsx) and per pane (DeckScreen, with its
 *  own fallback card). Error details go to the console, not on screen. */
export default class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('[pqTERM] renderer caught:', error)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div
            style={{
              padding: 40,
              background: '#07080a',
              color: '#39ffb6',
              fontFamily: 'Consolas, monospace'
            }}
          >
            <h1>pqTERM</h1>
            <p>Renderer napotkał błąd renderowania — szczegóły w konsoli (F12).</p>
          </div>
        )
      )
    }
    return this.props.children
  }
}
