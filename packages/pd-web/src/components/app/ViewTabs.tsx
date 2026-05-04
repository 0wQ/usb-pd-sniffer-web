import clsx from 'clsx'

export type AppView = 'protocol' | 'power'

const VIEW_OPTIONS: Array<{ key: AppView; label: string }> = [
  { key: 'protocol', label: 'Protocol' },
  { key: 'power', label: 'Power' },
]

type Props = {
  className?: string
  currentView: AppView
  onViewChange: (view: AppView) => void
}

const ViewTabs = ({ className, currentView, onViewChange }: Props) => (
  <div
    className={clsx(
      'inline-flex h-8 items-stretch gap-px rounded-full border border-base-300/80 bg-base-200/70 p-[3px]',
      className,
    )}
  >
    {VIEW_OPTIONS.map((option) => (
      <button
        key={option.key}
        className={clsx(
          'flex items-center justify-center rounded-full px-3 text-xs font-medium leading-none tracking-[0.08em] whitespace-nowrap transition-all duration-150',
          {
            'bg-base-100 text-primary shadow-sm': currentView === option.key,
            'text-base-content/55 hover:bg-base-100/70 hover:text-base-content/80':
              currentView !== option.key,
          },
        )}
        onClick={() => onViewChange(option.key)}
        type="button"
      >
        <span className="select-none">{option.label}</span>
      </button>
    ))}
  </div>
)

export default ViewTabs
