import type { PqAPI } from './index'

declare global {
  interface Window {
    pq: PqAPI
  }
}

export {}
