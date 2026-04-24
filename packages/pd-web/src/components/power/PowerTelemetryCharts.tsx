import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import './PowerTelemetryCharts.css'
import type { PowerSample } from '@/types/pd'

type SeriesKey = 'vbus' | 'ibus'

type SeriesConfig = {
  key: SeriesKey
  label: string
  color: string
  unit: string
  scale: string
  getValue: (sample: PowerSample) => number
  formatValue: (value: number) => string
}

type Range = {
  min: number
  max: number
}

type YRanges = Partial<Record<SeriesKey, Range>>

type PreparedData = {
  xValues: Float64Array
  yValues: Record<SeriesKey, Float64Array>
  fullRange: Range
  minSpan: number
}

const CHART_HEIGHT = 680

const SERIES: readonly SeriesConfig[] = [
  {
    key: 'vbus',
    label: 'VBUS',
    color: '#5cc8ff',
    unit: 'mV',
    scale: 'vbus',
    getValue: (sample) => sample.vbus_mv,
    formatValue: (value) => `${Math.round(value)} mV`,
  },
  {
    key: 'ibus',
    label: 'IBUS',
    color: '#7ee787',
    unit: 'mA',
    scale: 'ibus',
    getValue: (sample) => sample.ibus_ma,
    formatValue: (value) => `${Math.round(value)} mA`,
  },
] as const

function formatTimestampUs(timestampUs: number): string {
  const totalMicroseconds = Math.max(0, Math.floor(timestampUs))
  const minutes = Math.floor(totalMicroseconds / 60_000_000)
  const remainingAfterMinutes = totalMicroseconds % 60_000_000
  const seconds = Math.floor(remainingAfterMinutes / 1_000_000)
  const remainingAfterSeconds = remainingAfterMinutes % 1_000_000
  const milliseconds = Math.floor(remainingAfterSeconds / 1_000)

  return [
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0'),
    milliseconds.toString().padStart(3, '0'),
  ].join(':')
}

function formatAxisTime(valueSeconds: number): string {
  return formatTimestampUs(valueSeconds * 1_000_000)
}

function formatDurationSeconds(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds)
  if (safeSeconds < 1) {
    return `${Math.round(safeSeconds * 1000)} ms`
  }
  if (safeSeconds < 60) {
    return `${safeSeconds.toFixed(2)} s`
  }

  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds - minutes * 60
  if (minutes < 60) {
    return `${minutes}m ${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
  }

  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return `${hours}h ${remMinutes}m`
}

function padRange(min: number, max: number): Range {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 }
  }

  if (min === max) {
    const padding = min === 0 ? 1 : Math.abs(min) * 0.05
    return { min: min - padding, max: max + padding }
  }

  const padding = (max - min) * 0.08
  return { min: min - padding, max: max + padding }
}

function getFullRange(xValues: Float64Array): Range {
  if (xValues.length === 0) {
    return { min: 0, max: 1 }
  }

  const min = xValues[0] ?? 0
  const max = xValues[xValues.length - 1] ?? min
  return min === max ? { min, max: min + 0.001 } : { min, max }
}

function getMinSpan(xValues: Float64Array): number {
  if (xValues.length < 2) return 0.001

  let minStep = Number.POSITIVE_INFINITY
  for (let index = 1; index < xValues.length; index += 1) {
    const step = xValues[index]! - xValues[index - 1]!
    if (step > 0 && step < minStep) {
      minStep = step
    }
  }

  return Number.isFinite(minStep) ? Math.max(minStep, 0.001) : 0.001
}

function clampXRange(range: Range, fullRange: Range, minSpan: number): Range {
  const fullSpan = Math.max(fullRange.max - fullRange.min, minSpan)
  let span = Math.max(range.max - range.min, minSpan)
  span = Math.min(span, fullSpan)

  let min = range.min
  let max = min + span

  if (min < fullRange.min) {
    min = fullRange.min
    max = min + span
  }

  if (max > fullRange.max) {
    max = fullRange.max
    min = max - span
  }

  if (min < fullRange.min) {
    min = fullRange.min
  }

  if (max <= min) {
    max = min + minSpan
  }

  return { min, max }
}

function rangesClose(a: Range, b: Range): boolean {
  const epsilon = 1e-9
  return Math.abs(a.min - b.min) < epsilon && Math.abs(a.max - b.max) < epsilon
}

function getAxisDecimals(foundIncr: number): number {
  if (!Number.isFinite(foundIncr) || foundIncr <= 0) return 2

  const exponent = Math.floor(Math.log10(foundIncr))
  if (exponent >= 0) return 0

  return Math.min(6, Math.max(0, -exponent + 1))
}

function trimTrailingZeros(text: string): string {
  if (!text.includes('.')) return text
  return text.replace(/\.?0+$/, '')
}

function formatYAxisValue(key: SeriesKey, value: number, foundIncr: number): string {
  if (!Number.isFinite(value)) return '-'

  if (Object.is(value, -0)) {
    value = 0
  }

  const absValue = Math.abs(value)
  const absIncr = Math.abs(foundIncr)

  let decimals = getAxisDecimals(foundIncr)
  if (absValue > 0 && absValue < 0.01) {
    decimals = Math.max(decimals, 6)
  } else if (absValue > 0 && absValue < 0.1) {
    decimals = Math.max(decimals, 4)
  }

  if (absIncr > 0 && absIncr < 0.001) {
    decimals = Math.max(decimals, 6)
  }

  decimals = Math.min(decimals, 8)
  const text = trimTrailingZeros(value.toFixed(decimals))

  if (key === 'ibus') return text
  return text
}

function formatYAxisTick(key: SeriesKey, value: number, foundIncr: number): string {
  return `${formatYAxisValue(key, value, foundIncr)} ${key === 'vbus' ? 'mV' : 'mA'}`
}

function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setWidth(Math.round(entry.contentRect.width))
    })

    observer.observe(element)
    setWidth(Math.round(element.getBoundingClientRect().width))

    return () => observer.disconnect()
  }, [])

  return [ref, width]
}

function prepareData(samples: PowerSample[]): PreparedData {
  const xValues = new Float64Array(samples.length)
  const yValues = {
    vbus: new Float64Array(samples.length),
    ibus: new Float64Array(samples.length),
  }

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!
    xValues[index] = sample.timestamp_us / 1_000_000
    yValues.vbus[index] = sample.vbus_mv
    yValues.ibus[index] = sample.ibus_ma
  }

  return {
    xValues,
    yValues,
    fullRange: getFullRange(xValues),
    minSpan: getMinSpan(xValues),
  }
}

function captureYRanges(plot: uPlot): YRanges | null {
  const nextRanges = {} as YRanges

  for (const config of SERIES) {
    const scale = plot.scales[config.scale]
    if (scale.min == null || scale.max == null) {
      return null
    }
    nextRanges[config.key] = { min: scale.min, max: scale.max }
  }

  return nextRanges
}

function createPlotOptions(
  width: number,
  onCursor: (plot: uPlot) => void,
  onScale: (plot: uPlot, scaleKey: string) => void,
  lockedYRangesRef: RefObject<YRanges | null>
): uPlot.Options {
  return {
    width,
    height: CHART_HEIGHT,
    class: 'power-uplot',
    legend: { show: false },
    scales: {
      x: { time: false },
      vbus: {
        auto: true,
        range: (_self, min, max) => {
          const locked = lockedYRangesRef.current?.vbus
          if (locked) return [locked.min, locked.max]
          const padded = padRange(min, max)
          return [padded.min, padded.max]
        },
      },
      ibus: {
        auto: true,
        range: (_self, min, max) => {
          const locked = lockedYRangesRef.current?.ibus
          if (locked) return [locked.min, locked.max]
          const padded = padRange(min, max)
          return [padded.min, padded.max]
        },
      },
    },
    axes: [
      {
        scale: 'x',
        size: 42,
        gap: 8,
        space: 96,
        stroke: 'rgba(148, 163, 184, 0.82)',
        grid: { stroke: 'rgba(148, 163, 184, 0.12)' },
        ticks: { stroke: 'rgba(148, 163, 184, 0.18)', size: 4 },
        values: (_self, splits) => splits.map((value) => formatAxisTime(Number(value))),
      },
      {
        scale: 'vbus',
        side: 3,
        size: 104,
        gap: 8,
        stroke: SERIES[0].color,
        grid: { stroke: 'rgba(148, 163, 184, 0.10)' },
        ticks: { stroke: 'rgba(148, 163, 184, 0.18)', size: 4 },
        values: (_self, splits, _axisIdx, _foundSpace, foundIncr) =>
          splits.map((value) => formatYAxisTick('vbus', Number(value), foundIncr)),
      },
      {
        scale: 'ibus',
        side: 1,
        size: 104,
        gap: 8,
        stroke: SERIES[1].color,
        grid: { show: false },
        ticks: { stroke: 'rgba(148, 163, 184, 0.18)', size: 4 },
        values: (_self, splits, _axisIdx, _foundSpace, foundIncr) =>
          splits.map((value) => formatYAxisTick('ibus', Number(value), foundIncr)),
      },
    ],
    cursor: {
      x: true,
      y: true,
      lock: true,
      drag: {
        x: true,
        y: false,
        dist: 4,
        setScale: true,
      },
      points: {
        size: 6,
        width: 2,
        fill: '#0b1220',
        stroke: '#cbd5e1',
      },
    },
    hooks: {
      setCursor: [onCursor],
      setScale: [onScale],
    },
    series: [
      {},
      {
        label: SERIES[0].label,
        scale: SERIES[0].scale,
        width: 2,
        stroke: SERIES[0].color,
        points: { show: false },
      },
      {
        label: SERIES[1].label,
        scale: SERIES[1].scale,
        width: 2,
        stroke: SERIES[1].color,
        points: { show: false },
      },
    ],
  }
}

type Props = {
  samples: PowerSample[]
  windowSize: number
}

const PowerTelemetryCharts = ({ samples, windowSize }: Props) => {
  const [containerRef, width] = useElementWidth<HTMLDivElement>()
  const plotHostRef = useRef<HTMLDivElement | null>(null)
  const plotRef = useRef<uPlot | null>(null)
  const fullRangeRef = useRef<Range>({ min: 0, max: 1 })
  const minSpanRef = useRef(0.001)
  const lockedYRangesRef = useRef<YRanges | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [viewRange, setViewRange] = useState<Range | null>(null)
  const [yLocked, setYLocked] = useState(false)

  const prepared = useMemo(() => prepareData(samples), [samples])
  const hoveredSample = hoveredIndex === null ? null : samples[hoveredIndex] ?? null

  const liveStats = useMemo(() => {
    return SERIES.map((config) => {
      const source = hoveredSample ?? samples[samples.length - 1] ?? null
      const value = source ? config.getValue(source) : 0
      return {
        key: config.key,
        label: config.label,
        color: config.color,
        value: config.formatValue(value),
      }
    })
  }, [hoveredSample, samples])

  const currentRange = viewRange ?? prepared.fullRange
  const visibleDuration = currentRange.max - currentRange.min
  const totalDuration = prepared.fullRange.max - prepared.fullRange.min
  const isFollowingLatest = rangesClose(
    clampXRange(currentRange, prepared.fullRange, prepared.minSpan),
    prepared.fullRange
  )

  useEffect(() => {
    return () => {
      plotRef.current?.destroy()
      plotRef.current = null
    }
  }, [])

  useEffect(() => {
    const host = plotHostRef.current
    if (!host || width <= 0) return

    const previousFullRange = fullRangeRef.current
    const previousScale = plotRef.current?.scales.x
    const previousRange = previousScale?.min != null && previousScale.max != null
      ? { min: previousScale.min, max: previousScale.max }
      : previousFullRange
    const followLatest = rangesClose(previousRange, previousFullRange)

    fullRangeRef.current = prepared.fullRange
    minSpanRef.current = prepared.minSpan

    const data: uPlot.AlignedData = [
      prepared.xValues,
      prepared.yValues.vbus,
      prepared.yValues.ibus,
    ]

    if (!plotRef.current) {
      const plot = new uPlot(
        createPlotOptions(width, (self) => {
          const nextIndex = self.cursor.idx ?? null
          setHoveredIndex((current) => (current === nextIndex ? current : nextIndex))
        }, (self, scaleKey) => {
          if (scaleKey !== 'x') return
          const scale = self.scales.x
          if (scale.min == null || scale.max == null) return
          setViewRange({ min: scale.min, max: scale.max })
        }, lockedYRangesRef),
        data,
        host
      )

      const handleReset = () => {
        plot.setScale('x', fullRangeRef.current)
        setViewRange(fullRangeRef.current)
      }

      const handleWheel = (event: WheelEvent) => {
        event.preventDefault()

        const scale = plot.scales.x
        if (scale.min == null || scale.max == null) return

        const fullRange = fullRangeRef.current
        const minSpan = minSpanRef.current
        const current = { min: scale.min, max: scale.max }
        const currentSpan = current.max - current.min
        if (currentSpan <= 0) return

        if (event.shiftKey) {
          const panRatio = event.deltaY / Math.max(plot.over.clientWidth, 1)
          const delta = currentSpan * panRatio * 0.9
          plot.setScale('x', clampXRange({
            min: current.min + delta,
            max: current.max + delta,
          }, fullRange, minSpan))
          setViewRange(clampXRange({
            min: current.min + delta,
            max: current.max + delta,
          }, fullRange, minSpan))
          return
        }

        const anchorPixel = plot.cursor.left ?? plot.over.clientWidth / 2
        const anchorValue = plot.posToVal(anchorPixel, 'x')
        const anchorRatio = (anchorValue - current.min) / currentSpan
        const zoomFactor = Math.exp(event.deltaY * 0.0015)
        const targetSpan = Math.max(minSpan, Math.min(currentSpan * zoomFactor, fullRange.max - fullRange.min))
        const unclampedMin = anchorValue - targetSpan * anchorRatio
        const nextRange = clampXRange({
          min: unclampedMin,
          max: unclampedMin + targetSpan,
        }, fullRange, minSpan)

        plot.setScale('x', nextRange)
        setViewRange(nextRange)
      }

      plot.over.addEventListener('wheel', handleWheel, { passive: false })
      plot.over.addEventListener('dblclick', handleReset)
      plotRef.current = plot
    } else {
      plotRef.current.setSize({ width, height: CHART_HEIGHT })
      plotRef.current.setData(data, false)
    }

    const nextRange = followLatest
      ? prepared.fullRange
      : clampXRange(previousRange, prepared.fullRange, prepared.minSpan)

    plotRef.current.setScale('x', nextRange)
    setViewRange(nextRange)
  }, [prepared, width])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return

    const xScale = plot.scales.x
    const currentXRange = xScale.min != null && xScale.max != null
      ? { min: xScale.min, max: xScale.max }
      : fullRangeRef.current

    if (yLocked) {
      lockedYRangesRef.current = captureYRanges(plot)
    } else {
      lockedYRangesRef.current = null
    }

    plot.setData(plot.data, true)
    plot.setScale('x', currentXRange)
  }, [yLocked])

  const handleResetZoom = () => {
    plotRef.current?.setScale('x', fullRangeRef.current)
    setViewRange(fullRangeRef.current)
  }

  return (
    <div className="mt-3 rounded-xl border border-base-300 bg-base-100/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-base-content/45">
          <span>Interactive Curves</span>
          <span className="rounded-full border border-base-300 px-2 py-0.5 font-mono text-[10px] normal-case tracking-normal text-base-content/55">
            {isFollowingLatest ? 'live edge' : 'inspection'}
          </span>
          <span className="rounded-full border border-base-300 px-2 py-0.5 font-mono text-[10px] normal-case tracking-normal text-base-content/55">
            {yLocked ? 'y locked' : 'y auto'}
          </span>
          <span className="rounded-full border border-base-300 px-2 py-0.5 font-mono text-[10px] normal-case tracking-normal text-base-content/55">
            drag to zoom
          </span>
          <span className="rounded-full border border-base-300 px-2 py-0.5 font-mono text-[10px] normal-case tracking-normal text-base-content/55">
            wheel to zoom
          </span>
          <span className="rounded-full border border-base-300 px-2 py-0.5 font-mono text-[10px] normal-case tracking-normal text-base-content/55">
            shift + wheel to pan
          </span>
          <span className="rounded-full border border-base-300 px-2 py-0.5 font-mono text-[10px] normal-case tracking-normal text-base-content/55">
            double click to reset
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-[11px] font-mono text-base-content/55">
            {samples.length.toLocaleString()} visible / window {windowSize.toLocaleString()}
          </div>
          <button
            className={`btn btn-xs ${yLocked ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setYLocked((current) => !current)}
          >
            {yLocked ? 'Y Locked' : 'Y Auto'}
          </button>
          <button className="btn btn-xs btn-ghost" onClick={handleResetZoom}>
            Reset Zoom
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        {liveStats.map((stat) => (
          <div
            key={stat.key}
            className="min-w-0 rounded-xl border border-base-300/80 bg-base-200/60 px-2.5 py-2"
          >
            <div className="text-[10px] uppercase tracking-[0.16em] text-base-content/45">
              {stat.label}
            </div>
            <div className="mt-1 truncate font-mono text-sm" style={{ color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}

        <div className="min-w-0 rounded-xl border border-base-300/80 bg-base-200/60 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-[0.16em] text-base-content/45">
            Cursor
          </div>
          <div className="mt-1 truncate font-mono text-sm text-base-content/80">
            {hoveredSample ? formatTimestampUs(hoveredSample.timestamp_us) : '-'}
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-base-300/80 bg-base-200/60 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-[0.16em] text-base-content/45">
            View Span
          </div>
          <div className="mt-1 truncate font-mono text-sm text-base-content/80">
            {formatDurationSeconds(visibleDuration)}
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-base-300/80 bg-base-200/60 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-[0.16em] text-base-content/45">
            Window Span
          </div>
          <div className="mt-1 truncate font-mono text-sm text-base-content/80">
            {formatDurationSeconds(totalDuration)}
          </div>
        </div>
      </div>

      <div ref={containerRef} className="mt-3">
        <div className="rounded-xl border border-base-300/80 bg-base-200/40 p-2">
          <div ref={plotHostRef} className="power-uplot-shell overflow-hidden rounded-lg" />
        </div>
      </div>
    </div>
  )
}

export default PowerTelemetryCharts
