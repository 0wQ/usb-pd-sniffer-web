import type { ImportResult, ValidationError } from '@/types/import'
import {
  AtkC2BmcDecoder,
  mapAtkC2DecodedEventToCaptureEvent,
  type AtkC2DecodedEvent,
} from '@usb-pd-sniffer/pd-device-atk-c2'
import type { CaptureRecord } from '@usb-pd-sniffer/pd-device-types'
import { unzipEntries } from './zip'

type BusSnapshot = {
  timeMs: number
  vbusMv: number
  ibusMa: number
}

function pushFileError(errors: ValidationError[], reason: string): ImportResult {
  errors.push({
    row: 0,
    field: 'file',
    value: '',
    reason,
  })
  return { records: [], errors }
}

function decodeText(data: Uint8Array): string {
  return new TextDecoder('utf-8').decode(data).replace(/^\uFEFF/, '')
}

function parseInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return parsed
}

function parseSampleRateHz(content: string): number {
  const match = content.match(/SamplingFrequency\s*=\s*(\d+)/)
  if (match === null) {
    throw new Error('Missing SamplingFrequency in channel.ini')
  }

  const rawValue = Number.parseInt(match[1] ?? '', 10)
  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    throw new Error(`Invalid SamplingFrequency: ${match[1] ?? ''}`)
  }

  return rawValue < 100_000 ? rawValue * 1000 : rawValue
}

function parseTimelineMs(raw: string): number {
  if (/^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10)
  }

  const match = raw.match(/^(\d+):(\d{2}):(\d{2})\.(\d{3})$/)
  if (match === null) {
    throw new Error(`Invalid timeline value: ${raw}`)
  }

  const hours = Number.parseInt(match[1] ?? '0', 10)
  const minutes = Number.parseInt(match[2] ?? '0', 10)
  const seconds = Number.parseInt(match[3] ?? '0', 10)
  const milliseconds = Number.parseInt(match[4] ?? '0', 10)

  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds
}

function parseBusSnapshots(content: string): BusSnapshot[] {
  const snapshots: BusSnapshot[] = []

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue

    const match = line.match(
      /^([^,]+),([+-]?\d+(?:\.\d+)?)V\/([+-]?\d+(?:\.\d+)?)A$/,
    )
    if (match === null) {
      continue
    }

    snapshots.push({
      timeMs: parseTimelineMs(match[1] ?? ''),
      vbusMv: Math.round(Number.parseFloat(match[2] ?? '0') * 1000),
      ibusMa: Math.round(Number.parseFloat(match[3] ?? '0') * 1000),
    })
  }

  return snapshots.sort((left, right) => left.timeMs - right.timeMs)
}

function sortChunkPath(left: string, right: string): number {
  const leftMatch = left.match(/(\d+)-(\d+)\.bin$/)
  const rightMatch = right.match(/(\d+)-(\d+)\.bin$/)
  if (leftMatch === null || rightMatch === null) {
    return left.localeCompare(right)
  }

  const leftChannel = Number.parseInt(leftMatch[1] ?? '0', 10)
  const rightChannel = Number.parseInt(rightMatch[1] ?? '0', 10)
  if (leftChannel !== rightChannel) {
    return leftChannel - rightChannel
  }

  const leftChunk = Number.parseInt(leftMatch[2] ?? '0', 10)
  const rightChunk = Number.parseInt(rightMatch[2] ?? '0', 10)
  return leftChunk - rightChunk
}

function concatBytes(chunks: readonly Uint8Array[], totalLength: number): Uint8Array {
  const merged = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  return merged
}

function trimWaveBytes(data: Uint8Array, totalSamples: number): Uint8Array {
  const expectedBytes = Math.ceil(totalSamples / 8)
  return data.length > expectedBytes ? data.slice(0, expectedBytes) : data
}

function findChannelDirectory(paths: readonly string[]): string {
  const channelDirs = new Set<string>()

  for (const path of paths) {
    const match = path.match(/^(\d+)\//)
    if (match !== null) {
      channelDirs.add(match[1] ?? '')
    }
  }

  const sorted = Array.from(channelDirs).sort(
    (left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10),
  )
  if (sorted.length === 0) {
    throw new Error('atkcc archive does not contain channel waveform data')
  }

  return sorted[0] ?? '0'
}

function decodeWaveformEvents(waveBytes: Uint8Array): AtkC2DecodedEvent[] {
  const decoder = new AtkC2BmcDecoder()
  const paddedWaveBytes = new Uint8Array(waveBytes.length + 5)

  paddedWaveBytes.set(waveBytes, 0)
  paddedWaveBytes.set([0x00, 0x00, 0x00, 0x00, 0xff], waveBytes.length)

  return decoder.pushSampleBlock(paddedWaveBytes)
}

function findSnapshotAtTime(
  snapshots: readonly BusSnapshot[],
  indexRef: { value: number },
  timeMs: number,
): BusSnapshot | null {
  while (
    indexRef.value + 1 < snapshots.length &&
    (snapshots[indexRef.value + 1]?.timeMs ?? Number.POSITIVE_INFINITY) <=
      timeMs
  ) {
    indexRef.value++
  }

  return snapshots[indexRef.value] ?? null
}

function decodedEventToRecord(
  event: AtkC2DecodedEvent,
  seq: number,
  sampleRateHz: number,
  snapshot: BusSnapshot | null,
): CaptureRecord {
  const data = 'bytes' in event ? Array.from(event.bytes) : []

  return {
    timestamp_us: Math.floor((event.sampleIndex * 1_000_000) / sampleRateHz),
    seq,
    vbus_mv: snapshot?.vbusMv ?? 0,
    ibus_ma: snapshot?.ibusMa ?? 0,
    cc1_mv: 0,
    cc2_mv: 0,
    dp_mv: 0,
    dm_mv: 0,
    event_type: mapAtkC2DecodedEventToCaptureEvent(event),
    active_cc: 0,
    data_len: data.length,
    data,
  }
}

export async function importFromAtkcc(buffer: ArrayBuffer): Promise<ImportResult> {
  const errors: ValidationError[] = []

  try {
    const entries = await unzipEntries(buffer)
    const entryMap = new Map(entries.map((entry) => [entry.filename, entry.data]))
    const entryPaths = entries.map((entry) => entry.filename)
    const rootChannelIni = entryMap.get('channel.ini')
    const busIni = entryMap.get('bus.ini')

    if (!rootChannelIni || !busIni) {
      return pushFileError(errors, 'atkcc archive is missing root metadata files')
    }

    const sampleRateHz = parseSampleRateHz(decodeText(rootChannelIni))
    const channelDir = findChannelDirectory(entryPaths)
    const channelInfo = entryMap.get(`${channelDir}/channel.ini`)
    if (!channelInfo) {
      return pushFileError(errors, 'atkcc archive is missing channel.ini')
    }

    const channelLines = decodeText(channelInfo)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    if (channelLines.length < 2) {
      return pushFileError(errors, 'atkcc channel metadata is incomplete')
    }

    const totalSamples = parseInteger(
      channelLines[1] ?? '',
      'channel sample count',
    )
    const chunkPaths = entryPaths
      .filter(
        (path) =>
          path.startsWith(`${channelDir}/`) && /\/\d+-\d+\.bin$/.test(path),
      )
      .sort(sortChunkPath)

    if (chunkPaths.length === 0) {
      return pushFileError(errors, 'atkcc archive does not contain waveform chunks')
    }

    const chunks = chunkPaths.map((path) => entryMap.get(path) ?? new Uint8Array(0))
    const waveBytes = trimWaveBytes(
      concatBytes(
        chunks,
        chunks.reduce((total, chunk) => total + chunk.length, 0),
      ),
      totalSamples,
    )
    const snapshots = parseBusSnapshots(decodeText(busIni))
    const decodedEvents = decodeWaveformEvents(waveBytes)

    if (decodedEvents.length === 0) {
      return pushFileError(
        errors,
        'atkcc waveform decode produced no protocol events',
      )
    }

    const snapshotIndex = { value: 0 }
    const records = decodedEvents.map((event, index) => {
      const timeMs = (event.sampleIndex * 1000) / sampleRateHz
      const snapshot = findSnapshotAtTime(snapshots, snapshotIndex, timeMs)
      return decodedEventToRecord(event, index + 1, sampleRateHz, snapshot)
    })

    return { records, errors }
  } catch (error) {
    return pushFileError(
      errors,
      error instanceof Error ? error.message : 'Failed to decode atkcc file',
    )
  }
}
