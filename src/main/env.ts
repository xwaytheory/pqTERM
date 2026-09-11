export function runningDev(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL) || process.env.PQ_MODE === 'dev'
}

export function productName(): 'pq-dev' | 'pq' {
  return runningDev() ? 'pq-dev' : 'pq'
}
