/** Shared name styling for the Home masthead and its Settings preview. */
export default function MastheadName({ name, animated = true }: { name: string; animated?: boolean }) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null

  const tail = words[words.length - 1]
  const head = words.slice(0, -1).join(' ')
  return (
    <>
      {head && <span className={`inline-block max-w-full [overflow-wrap:anywhere] ${animated ? 'animate-rise [animation-delay:60ms]' : ''}`}>{head}</span>}
      {head && ' '}
      <span className={`inline-block max-w-full [overflow-wrap:anywhere] italic text-[var(--primary)] ${animated ? 'animate-rise [animation-delay:180ms]' : ''}`}>
        {tail}
      </span>
    </>
  )
}
