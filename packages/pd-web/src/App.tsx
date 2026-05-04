import { Toaster } from 'sonner'
import DeviceWorkspace from '@/components/app/DeviceWorkspace'
import { useBeforeUnloadWarning } from '@/hooks/useBeforeUnloadWarning'
import useAppStore from '@/stores/appStore'

function App() {
  const currentView = useAppStore((state) => state.currentView)
  const setCurrentView = useAppStore((state) => state.setCurrentView)
  // 数据丢失警告
  useBeforeUnloadWarning()

  return (
    <div className="app bg-base-200 w-full h-screen min-h-200 flex flex-col">
      <Toaster
        position="top-right"
        duration={10000}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: 'bg-base-100 text-base-content/80 text-sm font-mono rounded-lg shadow-xl p-3 flex items-center gap-2 select-none',
          },
        }}
      />
      <DeviceWorkspace currentView={currentView} onViewChange={setCurrentView} />
    </div>
  )
}

export default App
