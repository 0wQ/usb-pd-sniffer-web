import type { CaptureRecord } from '@usb-pd-sniffer/pd-device-types'
import { CAPTURE_EVENT } from '@usb-pd-sniffer/pd-device-types'

type PyodideInterface = {
  FS: {
    mkdirTree(path: string): void
    writeFile(path: string, data: string): void
  }
  runPython(code: string): unknown
  runPythonAsync(code: string): Promise<unknown>
  globals: {
    set(name: string, value: unknown): void
    get(name: string): unknown
  }
  toPy(value: unknown): unknown
}

type PyodideLoader = (options?: { indexURL?: string }) => Promise<PyodideInterface>

type PythonRenderResult = {
  ok: boolean
  text: string
  engine: 'python'
  sop: string | null
}

const PYODIDE_SCRIPT_URL =
  'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js'
const PYODIDE_INDEX_URL =
  'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/'
const USBPDPARSER_CDN_BASE_URL =
  'https://cdn.jsdelivr.net/gh/JohnScotttt/USB_PD_Parser_API_Py@latest/usbpdparser'

const USBPDPARSER_FILES = {
  core: `${USBPDPARSER_CDN_BASE_URL}/core.py`,
  packageInit: `${USBPDPARSER_CDN_BASE_URL}/__init__.py`,
  render: `${USBPDPARSER_CDN_BASE_URL}/tools/render.py`,
  toolsInit: `${USBPDPARSER_CDN_BASE_URL}/tools/__init__.py`,
  vendorIds: `${USBPDPARSER_CDN_BASE_URL}/tools/vendor_ids_dict.py`,
} as const

let pyodidePromise: Promise<PyodideInterface> | null = null
let usbPdParserSourcePromise: Promise<{
  core: string
  packageInit: string
  render: string
  toolsInit: string
  vendorIds: string
}> | null = null

function recordToPythonSop(eventType: CaptureRecord['event_type']): string | null {
  switch (eventType) {
    case CAPTURE_EVENT.PD_SOP0:
      return 'SOP'
    case CAPTURE_EVENT.PD_SOP1:
      return "SOP'"
    case CAPTURE_EVENT.PD_SOP2:
      return "SOP''"
    case CAPTURE_EVENT.PD_SOP1_DEBUG:
      return "SOP'_DEBUG"
    case CAPTURE_EVENT.PD_SOP2_DEBUG:
      return "SOP''_DEBUG"
    case CAPTURE_EVENT.PD_HARD_RESET:
      return 'Hard_Reset'
    case CAPTURE_EVENT.PD_CABLE_RESET:
      return 'Cable_Reset'
    default:
      return null
  }
}

function ensurePyodideScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Pyodide requires a browser environment.'))
  }

  if ('loadPyodide' in window) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-pyodide-loader="true"]',
    )
    if (existing !== null) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Pyodide loader script.')),
        { once: true },
      )
      return
    }

    const script = document.createElement('script')
    script.src = PYODIDE_SCRIPT_URL
    script.async = true
    script.dataset.pyodideLoader = 'true'
    script.onload = () => resolve()
    script.onerror = () =>
      reject(new Error('Failed to load Pyodide loader script.'))
    document.head.appendChild(script)
  })
}

async function fetchTextOrThrow(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) {
    throw new Error(`Failed to download Python decoder asset: ${url}`)
  }

  return response.text()
}

async function getUsbPdParserSources() {
  if (usbPdParserSourcePromise !== null) {
    return usbPdParserSourcePromise
  }

  usbPdParserSourcePromise = Promise.all([
    fetchTextOrThrow(USBPDPARSER_FILES.core),
    fetchTextOrThrow(USBPDPARSER_FILES.packageInit),
    fetchTextOrThrow(USBPDPARSER_FILES.render),
    fetchTextOrThrow(USBPDPARSER_FILES.toolsInit),
    fetchTextOrThrow(USBPDPARSER_FILES.vendorIds),
  ]).then(([core, packageInit, render, toolsInit, vendorIds]) => ({
    core,
    packageInit,
    render,
    toolsInit,
    vendorIds,
  }))

  return usbPdParserSourcePromise
}

async function getPyodide(): Promise<PyodideInterface> {
  if (pyodidePromise !== null) {
    return pyodidePromise
  }

  pyodidePromise = (async () => {
    await ensurePyodideScript()

    const loader = (window as Window & { loadPyodide?: PyodideLoader })
      .loadPyodide
    if (loader === undefined) {
      throw new Error('Pyodide loader is not available.')
    }

    const sources = await getUsbPdParserSources()
    const pyodide = await loader({ indexURL: PYODIDE_INDEX_URL })
    pyodide.FS.mkdirTree('/app/usbpdparser/tools')
    pyodide.FS.writeFile('/app/usbpdparser/core.py', sources.core)
    pyodide.FS.writeFile('/app/usbpdparser/__init__.py', sources.packageInit)
    pyodide.FS.writeFile('/app/usbpdparser/tools/render.py', sources.render)
    pyodide.FS.writeFile('/app/usbpdparser/tools/__init__.py', sources.toolsInit)
    pyodide.FS.writeFile(
      '/app/usbpdparser/tools/vendor_ids_dict.py',
      sources.vendorIds,
    )
    pyodide.runPython(`
import sys
if "/app" not in sys.path:
    sys.path.insert(0, "/app")
from usbpdparser import Parser, is_pdo, is_rdo, provide_ext
from usbpdparser.tools import renderer
`)
    return pyodide
  })()

  return pyodidePromise
}

function normalizeRenderedText(lines: unknown): string {
  if (!Array.isArray(lines)) {
    return ''
  }

  return lines
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) {
        return ''
      }
      return typeof entry[1] === 'string' ? entry[1] : String(entry[1] ?? '')
    })
    .join('')
    .trim()
}

type PythonBridgePayload = {
  rendered?: unknown
  sop?: unknown
}

export async function renderPythonPdRecord(
  records: readonly CaptureRecord[],
  targetIndex: number,
): Promise<PythonRenderResult> {
  const targetRecord = records[targetIndex]
  if (targetRecord === undefined) {
    throw new Error('Selected record is out of range.')
  }

  const pyodide = await getPyodide()
  const serializedRecords = records.map((record) => ({
    eventType: record.event_type,
    data: record.data.slice(0, record.data_len),
  }))
  pyodide.globals.set('capture_records_json', JSON.stringify(serializedRecords))
  pyodide.globals.set('target_index_js', targetIndex)

  const result = await pyodide.runPythonAsync(`
import json

records = json.loads(capture_records_json)
parser = Parser()
rendered = []
selected_sop = None

for index, item in enumerate(records):
    sop = None
    event_type = item.get("eventType", None)
    if event_type == "PD_SOP0":
        sop = "SOP"
    elif event_type == "PD_SOP1":
        sop = "SOP'"
    elif event_type == "PD_SOP2":
        sop = "SOP''"
    elif event_type == "PD_SOP1_DEBUG":
        sop = "SOP'_DEBUG"
    elif event_type == "PD_SOP2_DEBUG":
        sop = "SOP''_DEBUG"
    elif event_type == "PD_HARD_RESET":
        sop = "Hard_Reset"
    elif event_type == "PD_CABLE_RESET":
        sop = "Cable_Reset"

    if sop is None:
        if index == int(target_index_js):
            rendered = [("plain", "Selected row is not a PD message frame.")]
        continue

    raw = [int(byte) for byte in item.get("data", [])]
    msg = parser.parse(sop=sop, raw=raw, verify_crc=False, prop_protocol=True)
    if index == int(target_index_js):
        selected_sop = sop
        rendered = renderer(msg, 1)

json.dumps({"rendered": rendered, "sop": selected_sop})
`)

  const payload: PythonBridgePayload =
    typeof result === 'string'
      ? (JSON.parse(result) as PythonBridgePayload)
      : {}
  const text = normalizeRenderedText(payload.rendered)
  const sop =
    typeof payload.sop === 'string'
      ? payload.sop
      : recordToPythonSop(targetRecord.event_type)

  return {
    ok: true,
    text:
      text === ''
        ? 'Python renderer returned no text for this record.'
        : text,
    engine: 'python',
    sop,
  }
}
