/** Shows a balanced two-line archive name with a user-selected italic word. */
export default function MastheadName({ name, italicWordIndex = -1 }: { name: string; italicWordIndex?: number }) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null

  let splitAt = words.length
  let smallestDifference = Infinity
  for (let i = 1; i < words.length; i++) {
    const firstLineLength = words.slice(0, i).join(' ').length
    const secondLineLength = words.slice(i).join(' ').length
    const difference = Math.abs(firstLineLength - secondLineLength)
    if (difference < smallestDifference) {
      splitAt = i
      smallestDifference = difference
    }
  }
  const accentIndex = italicWordIndex < 0 ? words.length - 1 : Math.min(italicWordIndex, words.length - 1)
  const renderWords = (line: string[], startIndex: number) => line.map((word, index) => {
    const wordIndex = startIndex + index
    return (
      <span key={wordIndex}>
        {index > 0 && ' '}
        {wordIndex === accentIndex ? <em className="text-[var(--primary)]">{word}</em> : word}
      </span>
    )
  })

  return (
    <>
      <span className="block whitespace-nowrap animate-rise [animation-delay:60ms]">{renderWords(words.slice(0, splitAt), 0)}</span>
      {splitAt < words.length && (
        <span className="block whitespace-nowrap animate-rise [animation-delay:180ms]">
          {renderWords(words.slice(splitAt), splitAt)}
        </span>
      )}
    </>
  )
}
