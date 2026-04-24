import clsx from 'clsx'
import { lazy, Suspense, useMemo, useState } from 'react'
import useDeviceStore from '@/stores/deviceStore'
import ViewTabs, { type AppView } from '@/components/common/ViewTabs'

const PowerTelemetryCharts = lazy(() => import('@/components/power/PowerTelemetryCharts'))

const POWER_WINDOW_OPTIONS = [2000, 5000, 10000, 20000, 50000] as const
const TOOLBAR_ICON_BUTTON_CLASS = 'btn btn-sm btn-square btn-ghost'

function formatVoltageMv(mv: number): string {
  return `${(mv / 1000).toFixed(2)} V`
}

function formatCurrentMa(ma: number): string {
  return `${(ma / 1000).toFixed(3)} A`
}


function formatActiveCc(activeCc: number): string {
  if (activeCc === 1) return 'CC1'
  if (activeCc === 2) return 'CC2'
  return '-'
}

function formatTimestampUs(timestampUs: number): string {
  const totalMicroseconds = Math.max(0, Math.floor(timestampUs))
  const minutes = Math.floor(totalMicroseconds / 60_000_000)
  const remainingAfterMinutes = totalMicroseconds % 60_000_000
  const seconds = Math.floor(remainingAfterMinutes / 1_000_000)
  const remainingAfterSeconds = remainingAfterMinutes % 1_000_000
  const milliseconds = Math.floor(remainingAfterSeconds / 1_000)
  const microseconds = remainingAfterSeconds % 1_000

  return [
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0'),
    milliseconds.toString().padStart(3, '0'),
    microseconds.toString().padStart(3, '0'),
  ].join(':')
}

type Props = {
  isConnected: boolean
  isConnecting: boolean
  onConnectBtnClick: () => void
  isWebHidSupported: boolean
  currentView: AppView
  onViewChange: (view: AppView) => void
}

const PowerPage = ({
  isConnected,
  isConnecting,
  onConnectBtnClick,
  isWebHidSupported,
  currentView,
  onViewChange,
}: Props) => {
  const [windowSize, setWindowSize] = useState<number>(10000)
  const reportsCount = useDeviceStore((state) => state.reportsCount)
  const powerBuffer = useDeviceStore((state) => state.powerBuffer)
  const powerVersion = useDeviceStore((state) => state.powerVersion)
  const powerCount = useDeviceStore((state) => state.powerCount)
  const powerCaptureEnabled = useDeviceStore((state) => state.powerCaptureEnabled)
  const setPowerCaptureEnabled = useDeviceStore((state) => state.setPowerCaptureEnabled)
  const clearPowerSamples = useDeviceStore((state) => state.clearPowerSamples)

  const latestSample = useMemo(() => {
    void powerVersion
    return powerBuffer.getLatest()
  }, [powerBuffer, powerVersion])

  const recentSamples = useMemo(() => {
    void powerVersion
    return powerBuffer.getRecent(windowSize)
  }, [powerBuffer, powerVersion, windowSize])

  return (
    <main className="flex-1 min-h-0 z-10 p-5 overflow-visible">
      <section className="card bg-base-100 h-full min-h-0 min-w-0">
        <div className="relative z-20 shrink-0 overflow-visible p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <h2 className="card-title select-none">
                <span className="text-primary">USB PD Sniffer</span>
              </h2>
              <ViewTabs currentView={currentView} onViewChange={onViewChange} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isWebHidSupported && (
                <button
                  className="btn btn-sm rounded-full gap-2"
                  onClick={onConnectBtnClick}
                  disabled={isConnecting}
                >
                  {isConnected ? (
                    <>
                      <span className="inline-block h-2 w-2 rounded-full bg-success" />
                      DISCONNECT
                    </>
                  ) : (
                    <>
                      <span className={clsx('inline-block h-2 w-2 rounded-full', {
                        'bg-warning animate-pulse': isConnecting,
                        'bg-base-content/25': !isConnecting,
                      })} />
                      {isConnecting ? 'CONNECTING' : 'CONNECT'}
                    </>
                  )}
                </button>
              )}

              <div className="btn btn-sm rounded-full gap-1.5 border-base-300 bg-base-100 px-3 font-mono font-normal normal-case text-base-content/65 pointer-events-none cursor-default hover:bg-base-100">
                <span className="font-semibold text-base-content/80">{reportsCount.toLocaleString()}</span>
                <span>protocol records</span>
              </div>
              <div className="btn btn-sm rounded-full gap-1.5 border-base-300 bg-base-100 px-3 font-mono font-normal normal-case text-base-content/65 pointer-events-none cursor-default hover:bg-base-100">
                <span className="font-semibold text-base-content/80">{powerCount.toLocaleString()}</span>
                <span>telemetry samples</span>
              </div>
              <div className="inline-flex items-center rounded-full border border-base-300/80 bg-base-200/70 p-1">
                {POWER_WINDOW_OPTIONS.map((option) => (
                  <button
                    key={option}
                    className={clsx(
                      'rounded-full px-2.5 py-1 text-[11px] font-medium tracking-[0.06em] transition-all duration-150',
                      {
                        'bg-base-100 text-primary shadow-sm': windowSize === option,
                        'text-base-content/55 hover:bg-base-100/70 hover:text-base-content/80': windowSize !== option,
                      }
                    )}
                    onClick={() => setWindowSize(option)}
                    type="button"
                  >
                    {option >= 1000 ? `${option / 1000}k` : option}
                  </button>
                ))}
              </div>
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={() => setPowerCaptureEnabled(!powerCaptureEnabled)}
                type="button"
                aria-label={powerCaptureEnabled ? 'Pause power capture' : 'Start power capture'}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  {powerCaptureEnabled ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  )}
                </svg>
              </button>

              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={clearPowerSamples}
                disabled={powerCount === 0}
                type="button"
                aria-label="Clear power samples"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 px-5 pb-5">
          <div className="flex h-full min-h-0 flex-col gap-4">
            <div className="rounded-2xl border border-base-300 bg-base-200/70 p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-base-content/45">
                Current Status
              </div>
              <div className="mt-3 grid gap-3 font-mono md:grid-cols-2 2xl:grid-cols-4">
                <div className="rounded-xl border border-base-300 bg-base-100/80 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">
                    HID Session
                  </div>
                  <div className="mt-1 text-sm text-base-content">
                    {isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}
                  </div>
                </div>
                <div className="rounded-xl border border-base-300 bg-base-100/80 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">
                    Telemetry Stream
                  </div>
                  <div className="mt-1 text-sm text-base-content">
                    {!powerCaptureEnabled
                      ? 'Capture disabled'
                      : powerCount === 0
                        ? 'Waiting for telemetry'
                        : 'Streaming to powerBuffer'}
                  </div>
                </div>
                <div className="rounded-xl border border-base-300 bg-base-100/80 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">
                    Capture Policy
                  </div>
                  <div className="mt-1 text-sm text-base-content/75">
                    Idle-gap telemetry after protocol traffic quiets down.
                  </div>
                </div>
                <div className="rounded-xl border border-base-300 bg-base-100/80 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">
                    Latest Sample
                  </div>
                  <div className="mt-1 space-y-1 text-sm text-base-content/75">
                    <div>{latestSample ? formatTimestampUs(latestSample.timestamp_us) : '-'}</div>
                    <div>{latestSample ? `${formatVoltageMv(latestSample.vbus_mv)} / ${formatCurrentMa(latestSample.ibus_ma)}` : 'No data'}</div>
                    <div>{latestSample ? formatActiveCc(latestSample.active_cc) : '-'}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-base-300 bg-base-200/70 p-4 flex-1 min-h-0">
              <div className="text-[11px] uppercase tracking-[0.2em] text-base-content/45">
                Telemetry Curves
              </div>
              {recentSamples.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-base-300 bg-base-100/50 p-6 text-sm text-base-content/55">
                  {powerCaptureEnabled
                    ? 'No `POWER_TELEMETRY` samples yet. Connect the device and wait for the telemetry side-channel to go idle-gap active.'
                    : 'Power capture is off. Turn on `Record Power` to start buffering telemetry samples.'}
                </div>
              ) : (
                <Suspense
                  fallback={
                    <div className="mt-3 grid gap-4 xl:grid-cols-3">
                      <div className="h-[320px] rounded-xl border border-base-300 bg-base-100/70 xl:col-span-2" />
                      <div className="h-[320px] rounded-xl border border-base-300 bg-base-100/70" />
                    </div>
                  }
                >
                  <PowerTelemetryCharts samples={recentSamples} windowSize={windowSize} />
                </Suspense>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

export default PowerPage
