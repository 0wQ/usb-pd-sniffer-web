import { useEffect } from 'react'
import useDeviceStore from '@/stores/deviceStore'

/**
 * 页面刷新时的数据丢失警告 Hook
 * 当有数据记录时，用户刷新或关闭页面会收到提示
 */
export function useBeforeUnloadWarning() {
  const captureCount = useDeviceStore((state) => state.captureCount)

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // 只有当有数据记录时才显示警告
      if (captureCount > 0) {
        // 标准方式
        event.preventDefault()

        // Chrome 需要设置 returnValue
        event.returnValue = ''

        // 某些浏览器支持自定义消息（虽然现代浏览器通常忽略它）
        return ''
      }
    }

    // 添加事件监听器
    window.addEventListener('beforeunload', handleBeforeUnload)

    // 清理函数
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [captureCount])
}

export default useBeforeUnloadWarning
