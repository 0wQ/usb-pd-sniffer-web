import { useEffect, useState } from 'react'

type MaskProps = {
  hide: boolean
}

const Mask = ({ hide }: MaskProps) => {
  // 先修改背景模糊 none，然后延迟 hidden 掉
  const [isHiddenMask, setHiddenMask] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    if (hide) {
      timer = setTimeout(() => setHiddenMask(true), 1100)
    } else {
      setHiddenMask(false)
    }
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [hide])

  return (
    <div
      className={`absolute z-20 inset-0 w-full h-[calc(100%+1.25rem-1px)] sm:h-[calc(100%+2.5rem-1px)] rounded-b-2xl transition-all duration-1000 ${hide ? 'backdrop-blur-none' : 'backdrop-blur'} ${isHiddenMask ? 'hidden' : ''}`}
    ></div>
  )
}

export default Mask
