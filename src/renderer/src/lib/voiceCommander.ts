import { env, pipeline } from '@huggingface/transformers'
import type { AppSnapshot, EngineId, LayoutId } from '../../../shared/types'
import wasmAsyncify from '@ort-wasm/ort-wasm-simd-threaded.asyncify.wasm?url'
import wasmSimd from '@ort-wasm/ort-wasm-simd-threaded.wasm?url'
import wasmJsep from '@ort-wasm/ort-wasm-simd-threaded.jsep.wasm?url'
import wasmJspi from '@ort-wasm/ort-wasm-simd-threaded.jspi.wasm?url'

type ASR = Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>>

const WASM_MAP: Record<string, string> = {
  'ort-wasm-simd-threaded.asyncify.wasm': wasmAsyncify,
  'ort-wasm-simd-threaded.wasm': wasmSimd,
  'ort-wasm-simd-threaded.jsep.wasm': wasmJsep,
  'ort-wasm-simd-threaded.jspi.wasm': wasmJspi
}

export type VoiceLogKind = 'status' | 'transcript' | 'run' | 'ok' | 'error' | 'clarify'
export interface VoiceLogLine {
  id: number
  kind: VoiceLogKind
  text: string
  sub?: string
}
export type VoicePhase = 'idle' | 'listen' | 'transcribe' | 'run'
export type VoiceEvent =
  | { t: 'phase'; phase: VoicePhase }
  | { t: 'level'; v: number }
  | { t: 'log'; line: VoiceLogLine }
  | { t: 'result'; text: string }

type VoiceListener = (e: VoiceEvent) => void

const listeners: VoiceListener[] = []
let lastId = 0
function emit(e: VoiceEvent): void {
  for (const l of listeners) l(e)
}
function log(kind: VoiceLogKind, text: string, sub?: string): void {
  emit({ t: 'log', line: { id: ++lastId, kind, text, sub } })
}

export function onVoice(fn: VoiceListener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i >= 0) listeners.splice(i, 1)
  }
}

// ---------- audio capture + VAD ----------

interface HomeState {
  resolve: (r: { status: 'stopped' | 'cancelled'; audio: Float32Array | null }) => void
  audio: Float32Array[]
  ctx: AudioContext | null
  node: ScriptProcessorNode | null
  source: MediaStreamAudioSourceNode | null
  stream: MediaStream | null
  stopped: boolean
  startMs: number
  lastPeakMs: number
}

let home: HomeState | null = null

function finishRecording(status: 'stopped' | 'cancelled'): void {
  const st = home
  if (!st || st.stopped) return
  st.stopped = true
  st.stream?.getTracks().forEach((tr) => tr.stop())
  st.node?.disconnect()
  st.source?.disconnect()
  void st.ctx?.close().catch(() => {})
  home = null
  const audio =
    status === 'stopped' ? resample16k(st.audio, st.ctx?.sampleRate ?? 48000) : null
  st.resolve({ status, audio })
}

export function isListening(): boolean {
  return home !== null && !home.stopped
}

export function stopListening(): void {
  finishRecording('stopped')
}

function energy(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]
    sum += v * v
  }
  return Math.sqrt(sum / Math.max(buf.length, 1))
}

function resample16k(pcm: Float32Array[], sampleRate: number): Float32Array {
  if (!pcm.length) return new Float32Array(0)
  const total = pcm.reduce((n, b) => n + b.length, 0)
  const out = new Float32Array(total)
  let o = 0
  for (const b of pcm) {
    out.set(b, o)
    o += b.length
  }
  const factor = sampleRate / 16000
  if (Math.abs(factor - 1) < 0.001) return out
  const n = Math.floor(out.length / factor)
  const res = new Float32Array(n)
  for (let i = 0; i < n; i++) res[i] = out[Math.floor(i * factor)] ?? 0
  return res
}

export async function startListening(): Promise<{
  status: 'stopped' | 'cancelled'
  audio: Float32Array | null
}> {
  if (home) return { status: 'cancelled', audio: null }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
  } catch (err) {
    log(
      'error',
      'brak dostępu do mikrofonu — ' +
        (err instanceof Error ? err.message.replace(/electron/gi, 'pq') : String(err))
    )
    return { status: 'cancelled', audio: null }
  }

  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  const node = ctx.createScriptProcessor(4096, 1, 1)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  const levelData = new Uint8Array(analyser.frequencyBinCount)

  const st: HomeState = {
    resolve: () => {},
    audio: [],
    ctx,
    node,
    source,
    stream,
    stopped: false,
    startMs: performance.now(),
    lastPeakMs: 0
  }

  node.onaudioprocess = (ev) => {
    const ch = ev.inputBuffer.getChannelData(0)
    st.audio.push(new Float32Array(ch))
    if (st.stopped) return
    const e = energy(ch)
    if (e > 0.012) st.lastPeakMs = performance.now()
    const elapsed = performance.now() - st.startMs
    const spoken = st.lastPeakMs ? st.lastPeakMs - st.startMs : 0
    if ((spoken >= 500 && elapsed - st.lastPeakMs >= 1500) || elapsed >= 25000) {
      finishRecording('stopped')
      return
    }
    analyser.getByteTimeDomainData(levelData)
    let peak = 0
    for (let i = 0; i < levelData.length; i++) {
      const d = Math.abs(levelData[i] - 128) / 128
      if (d > peak) peak = d
    }
    emit({ t: 'level', v: Math.min(1, peak * 3) })
  }

  source.connect(analyser)
  analyser.connect(node)
  node.connect(ctx.destination)

  home = st
  emit({ t: 'phase', phase: 'listen' })
  log('status', 'słucham… (pauza 1,5 s kończy nagranie)')
  return new Promise((resolve) => {
    st.resolve = resolve
  })
}

// ---------- whisper STT (lazy, cached) ----------

let asr: ASR | null = null
let asrKey = ''

async function loadASR(model: string, dtype: 'fp32'): Promise<ASR> {
  const key = model + '|' + dtype
  if (asr && asrKey === key) return asr
  log('status', 'pobieram model mowy (' + model + ', ' + dtype + ')…')
  env.allowLocalModels = false
  env.useBrowserCache = true
  const wasm = env.backends.onnx?.wasm
  if (wasm) {
    wasm.wasmPaths = WASM_MAP
  }
  const m = (await pipeline('automatic-speech-recognition', model, {
    dtype
  })) as ASR
  asr = m
  asrKey = key
  log('status', 'model mowy gotowy')
  return m
}

export const WHISPER = {
  model: 'Xenova/whisper-tiny',
  dtype: 'fp32' as const
}

export async function recognize(
  audio: Float32Array,
  model = WHISPER.model,
  dtype: typeof WHISPER.dtype = WHISPER.dtype
): Promise<string> {
  if (!audio.length) throw new Error('pusty zapis głosu')
  const m = await loadASR(model, dtype)
  const out = (await m(audio, {
    language: 'polish',
    task: 'transcribe'
  })) as { text: string }
  return String(out?.text ?? '').trim()
}

export async function transcribe(audio: Float32Array): Promise<string> {
  return recognize(audio)
}

// ---------- intent routing + execution ----------

const ENGINE_WORDS: Array<[EngineId, RegExp]> = [
  ['opencode', /\bopens?[ -]?code\b|opencode|koder/i],
  ['omp', /\bomp\b/i],
  ['grok', /\bgrok\b/i],
  ['hermes', /\bhermes\b/i],
  ['codex', /\bcodex\b/i],
  ['claude', /\bclaude\b|anthropic/i],
  ['qwen', /\bqwen\b/i],
  ['dsh', /\bdeepseek\b|\bdsh\b/i],
  ['gemini', /\bgemini\b/i],
  ['crush', /\bcrush\b/i]
]

function flatten(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

function detectEngines(text: string): EngineId[] {
  const flat = flatten(text)
  const found: EngineId[] = []
  for (const [id, re] of ENGINE_WORDS) if (re.test(flat)) found.push(id)
  return found
}

const LAYOUTS: number[] = [1, 2, 3, 4, 6, 9]
function nearestLayout(n: number): LayoutId {
  return LAYOUTS.reduce((best, cur) =>
    Math.abs(cur - n) < Math.abs(best - n) ? cur : best
  ) as LayoutId
}

const FILL_PHRASES =
  /(?:pozosta(?:łych|łe)|wszystk(?:ich|ie)|wszystkimi|w każdym|każdemu|każdego|\bdwóch|\btrzech|\bczterech|\bpięciu|\bsześciu|\bdziesięciu|\bdziewięciu|innych)\s(?:oknach|okien|okna|terminalach|terminali|terminalom|oknom|panelach|pane)\b/gi

function pickTitle(orig: string): string | null {
  const q = orig.match(/"([^"]{2,40})"/)
  if (q) return q[1]
  const flat = flatten(orig)
  const m = flat.match(/\bworkspace\w*\s+([a-z0-9][a-z0-9 _\-]{1,40})/i)
  if (!m) return null
  let t = m[1].trim()
  t = t
    .split(
      /\s+(?:w\b|z\b|do\b|dla\b|o\b|na\b|przy\b|wszystk|pozosta|oknach?|terminali|\d+\s*(?:okien|okna|terminali))+/i
    )[0]
    .replace(/[.,!?"-]+$/g, '')
    .trim()
  if (t.length < 2 || /^(w|z|do|dla|o|na|przy|mi)$/i.test(t)) return null
  return t
}

function pickCwd(orig: string): string | null {
  const m = orig.match(
    /(?:katalog(?:u)?|ścieżk(?:a|ę|i)|folder(?:u)?|w katalogu|w ścieżce|w folderze|przy)\s*:?\s*(?:"?([A-Za-z]:[\\/][^\s,";]*|~[^\s,";]*|\/[^\s,";]*)"?)/i
  )
  if (m && m[1]) return m[1].replace(/[";]+$/, '')
  const drive = orig.match(/(?:"?([A-Za-z]:))(?:[\\/])?(?=[\s.,;!?"]|$)/)
  if (drive && drive[1]) return drive[1] + '\\'
  return null
}

function pickPrompt(orig: string, multi: boolean): string | null {
  let s = orig
  if (multi) {
    s = s
      .replace(FILL_PHRASES, ' ')
      .replace(
        /^\s*(?:zadaj|wyślij|wpisz|przekaż|uruchom|napisz|powiedz|daj)(?:\s+(?:im|mu|każdemu|wszystkim|terminalom|oknom))?[:,\s]+/i,
        ' '
      )
      .replace(/(?:prompt|treść)\s*:\s*/gi, ' ')
  }
  s = s.replace(/\s+/g, ' ').replace(/^[.:,;!?\- ]+/g, '').replace(/[.,;!?]+$/g, '').trim()
  return s || null
}

export interface RouteResult {
  ok: boolean
  kind: 'create' | 'fill' | 'prompt' | 'clarify'
  label: string
  detail?: string
  action?: () => Promise<string>
}

export function routeTranscript(
  text: string,
  snap: AppSnapshot,
  focus: string | null
): RouteResult {
  const orig = text.replace(/\s+/g, ' ').trim()
  const flat = flatten(orig)
  const ws = snap.workspaces.find((w) => w.id === snap.activeWorkspaceId) ?? null
  const engines = detectEngines(flat)

  if (/\bworkspace\b/i.test(flat)) {
    const title = pickTitle(orig)
    const cwd = pickCwd(orig)
    if (!cwd) {
      return {
        ok: false,
        kind: 'clarify',
        label: 'brakuje ścieżki katalogu',
        detail: `powiedz np. „utwórz workspace ${title ?? 'dziennik'} w katalogu C:\\x”`
      }
    }
    const layoutNum = flat.match(
      /(\d+)\s*(?:okien|okna|oknach|terminali|terminalach|paneli?|windows)/
    )
    const layout: LayoutId = layoutNum
      ? nearestLayout(Number(layoutNum[1]))
      : flat.includes('kwadrat')
        ? 4
        : 2
    const finalTitle = title ?? cwd.split(/[\\/]/).filter(Boolean).pop() ?? 'workspace'
    return {
      ok: true,
      kind: 'create',
      label: `tworzę workspace „${finalTitle}”`,
      detail: `${layout}-grid · ${engines.length ? engines.join(', ') : 'opencode'} · ${cwd}`,
      action: async () => {
        const w = await window.pq.workspaces.create({
          title: finalTitle,
          cwd,
          layout,
          engines: engines.length ? engines : ['opencode']
        })
        await window.pq.workspaces.select(w.id)
        return `utworzono „${w.title}” (${layout}-grid)`
      }
    }
  }

  const wantsOthers = FILL_PHRASES.test(flat)
  if (wantsOthers) {
    const prompt = pickPrompt(orig, true)
    if (!prompt) {
      return {
        ok: false,
        kind: 'clarify',
        label: 'nie wiem, co wysłać do pozostałych okien',
        detail: 'dopowiedz treść, np. „… i wyślij w pozostałych oknach: uruchom testy”'
      }
    }
    const engine: EngineId = engines[0] ?? ws?.panes.find((p) => p.engine)?.engine ?? 'grok'
    return {
      ok: true,
      kind: 'fill',
      label: `wysyłam do ${engine}: „${prompt}”`,
      detail: `wszystkie okna ${engine}`,
      action: async () => {
        const spawned = await window.pq.panes.fill({ engine, prompt })
        return spawned.length
          ? `odpalono ${spawned.join(',')} + zapisano do okien ${engine}`
          : `zapisano do wszystkich okien ${engine}`
      }
    }
  }

  const pane =
    (focus ? ws?.panes.find((p) => p.id === focus) : null) ??
    ws?.panes.find((p) => p.engine) ??
    ws?.panes[0] ??
    null
  const prompt = pickPrompt(orig, false)
  if (!pane || !prompt) {
    return {
      ok: false,
      kind: 'clarify',
      label: pane ? 'pusta wypowiedź' : 'brak aktywnego workspace',
      detail: pane
        ? 'powiedz coś, np. „napisz funkcję auth do projektu”'
        : 'utwórz najpierw workspace przyciskiem +'
    }
  }
  if (!pane.engine) {
    const engine: EngineId = engines[0] ?? 'opencode'
    return {
      ok: true,
      kind: 'fill',
      label: `odpalam ${engine} i piszę „${prompt}”`,
      detail: 'brak żywego okna — wypełniam siatkę',
      action: async () => {
        const spawned = await window.pq.panes.fill({ engine, prompt })
        return spawned.length
          ? `odpalono ${spawned.join(',')} + wysłano prompt`
          : `wysłano prompt do ${engine}`
      }
    }
  }
  const paneTitle = pane.title
  return {
    ok: true,
    kind: 'prompt',
    label: `piszę do okna „${paneTitle}”`,
    detail: prompt,
    action: async () => {
      const payload = /[\r\n]$/.test(prompt) ? prompt : `${prompt}\r`
      window.pq.terminals.write(pane.id, payload)
      return `wysłano: «${prompt}»`
    }
  }
}

export async function runText(
  text: string,
  snap: AppSnapshot,
  focus: string | null
): Promise<RouteResult> {
  const r = routeTranscript(text, snap, focus)
  emit({ t: 'result', text })
  log(r.kind === 'clarify' ? 'clarify' : 'run', r.label, r.detail)
  if (!r.ok || !r.action) return r
  emit({ t: 'phase', phase: 'run' })
  try {
    const res = await r.action()
    log('ok', res)
    return r
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('error', msg)
    return { ...r, ok: false }
  } finally {
    emit({ t: 'phase', phase: 'idle' })
  }
}