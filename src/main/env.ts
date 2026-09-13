export function runningDev(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL) || process.env.PQ_MODE === 'dev'
}

export function productName(): 'pqTERM-dev' | 'pqTERM-pr' {
  return runningDev() ? 'pqTERM-dev' : 'pqTERM-pr'
}
