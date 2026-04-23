import clsx from 'clsx'

export type AppView = 'protocol' | 'power'

const VIEW_OPTIONS: Array<{ key: AppView; label: string }> = [
  { key: 'protocol', label: 'Protocol' },
  { key: 'power', label: 'Power' },
]

type Props = {
  currentView: AppView
  onViewChange: (view: AppView) => void
}

const ViewTabs = ({ currentView, onViewChange }: Props) => (
  <div className="inline-flex items-center rounded-full border border-base-300/80 bg-base-200/70 p-1">
    {VIEW_OPTIONS.map((option) => (
      <button
        key={option.key}
        className={clsx(
          'rounded-full px-3 py-1.5 text-xs font-medium tracking-[0.08em] transition-all duration-150',
          {
            'bg-base-100 text-primary shadow-sm': currentView === option.key,
            'text-base-content/55 hover:bg-base-100/70 hover:text-base-content/80': currentView !== option.key,
          }
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
