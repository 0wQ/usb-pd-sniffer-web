import clsx from 'clsx'
import ViewTabs from '@/components/app/ViewTabs'
import { useDeviceWorkspaceContext } from '@/components/app/DeviceWorkspaceContext'

const PowerPage = () => {
  const {
    isConnected,
    isConnecting,
    isDeviceSupported,
    currentView,
    onViewChange,
    connectDevice,
  } = useDeviceWorkspaceContext()

  return (
    <main className="flex-1 min-h-0 z-10 p-5 overflow-visible">
      <section className="card bg-base-100 h-full min-h-0 min-w-0">
        <div className="relative z-20 shrink-0 overflow-visible p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <h2 className="card-title select-none">
                <span className="text-primary">PD & UFCS Sniffer</span>
              </h2>
              <ViewTabs currentView={currentView} onViewChange={onViewChange} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isDeviceSupported && (
                <button
                  className="btn btn-sm rounded-full gap-2"
                  onClick={() => void connectDevice()}
                  disabled={isConnecting}
                >
                  {isConnected ? (
                    <>
                      <span className="inline-block h-2 w-2 rounded-full bg-success" />
                      DISCONNECT
                    </>
                  ) : (
                    <>
                      <span
                        className={clsx('inline-block h-2 w-2 rounded-full', {
                          'bg-warning animate-pulse': isConnecting,
                          'bg-base-content/25': !isConnecting,
                        })}
                      />
                      {isConnecting ? 'CONNECTING' : 'CONNECT'}
                    </>
                  )}
                </button>
              )}
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
                    Device Session
                  </div>
                  <div className="mt-1 text-sm text-base-content">
                    {isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}
                  </div>
                </div>
                <div className="rounded-xl border border-base-300 bg-base-100/80 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">
                    Status
                  </div>
                  <div className="mt-1 text-sm text-base-content">
                    Power view paused for adapter refactor.
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-base-300 bg-base-200/70 p-4 flex-1 min-h-0">
              <div className="text-[11px] uppercase tracking-[0.2em] text-base-content/45">
                Power Curves
              </div>
              <div className="mt-3 rounded-xl border border-dashed border-base-300 bg-base-100/50 p-6 text-sm text-base-content/55">
                Chart temporarily removed. This page is kept as a layout placeholder for the later refactor.
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

export default PowerPage
