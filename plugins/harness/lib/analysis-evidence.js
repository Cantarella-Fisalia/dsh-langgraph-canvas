/** Plan bounded reads for cited evidence. The worker remains the final validator. */
const rows = (value, limit) => Array.isArray(value) ? value.slice(0, limit) : []

function locations(payload) {
  const result = []
  const add = value => { if (value !== undefined) result.push(value) }
  const claim = value => { for (const span of rows(value?.evidence, 10)) add(span) }
  const calls = value => { for (const call of rows(value, 16)) add(call?.source) }
  for (const graph of rows(payload?.graphs, 40)) {
    add(graph?.source); add(graph?.state?.source)
    for (const field of rows(graph?.state?.fields, 300)) add(field?.source)
    for (const node of rows(graph?.nodes, 500)) {
      if (['__start__', '__end__'].includes(node?.id)) continue
      add(node?.registration); add(node?.implementation)
    }
    for (const edge of rows(graph?.edges, 1500)) add(edge?.source)
  }
  const architecture = payload?.architecture
  claim(architecture?.overview)
  for (const graph of rows(architecture?.graphs, 40)) {
    claim(graph?.purpose); claim(graph?.entry); claim(graph?.exit)
    for (const field of rows(graph?.stateFields, 300)) claim(field?.meaning)
    for (const node of rows(graph?.nodes, 500)) { claim(node?.displayName); claim(node?.summary); calls(node?.calls) }
    for (const condition of rows(graph?.conditions, 1500)) claim(condition?.when)
  }
  for (const relationship of rows(architecture?.relationships, 100)) { claim(relationship?.explanation); calls(relationship?.callPath) }
  return result
}

const reference = file => file.split('/').slice(0, -1).some(part => /^(?:docs?|examples?|tests?|archive)$/i.test(part))
const interval = value => Number.isInteger(value?.line) && Number.isInteger(value?.endLine) && value.line > 0 && value.endLine >= value.line
function merge(ranges) {
  const merged = []
  for (const range of ranges.sort((a, b) => a.line - b.line || a.endLine - b.endLine)) {
    const previous = merged.at(-1)
    if (previous && range.line <= previous.endLine + 1) previous.endLine = Math.max(previous.endLine, range.endLine)
    else merged.push({ line: range.line, endLine: range.endLine })
  }
  return merged
}

export function inspectAnalysisEvidence(payload, files, supplied) {
  const manifest = new Map(files.map(file => [file.file, file]))
  const coverage = new Map(), missing = new Map()
  for (const read of supplied) {
    const entry = manifest.get(read.file)
    if (!entry || !interval(read) || (entry.hash && entry.hash !== read.hash)) continue
    const ranges = coverage.get(read.file) || []
    ranges.push(read); coverage.set(read.file, ranges)
  }
  for (const [file, ranges] of coverage) coverage.set(file, merge(ranges))
  for (const span of locations(payload)) {
    const entry = manifest.get(span?.file)
    if (!entry || reference(entry.file) || !interval(span) || span.endLine > entry.lines) {
      throw new Error('AI 引用的源码文件或行号不在本次业务索引内；请重新核对引用，静态图与已保存解读保留。')
    }
    let cursor = span.line
    const gaps = missing.get(span.file) || []
    for (const range of coverage.get(span.file) || []) {
      if (range.endLine < cursor) continue
      if (range.line > span.endLine) break
      if (range.line > cursor) gaps.push({ line: cursor, endLine: range.line - 1 })
      cursor = Math.max(cursor, range.endLine + 1)
      if (cursor > span.endLine) break
    }
    if (cursor <= span.endLine) gaps.push({ line: cursor, endLine: span.endLine })
    if (gaps.length) missing.set(span.file, gaps)
  }
  // Pack nearby gaps plus their intervening context into <=300-line reads. Tiny
  // isolated citations must not exhaust every round before other files are read.
  const requests = []
  for (const [file, gaps] of missing) {
    let packed
    for (const range of merge(gaps)) {
      let cursor = range.line
      while (cursor <= range.endLine) {
        if (packed && cursor <= packed.line + 299) packed.endLine = Math.min(packed.line + 299, range.endLine)
        else {
          packed = { file, line: cursor, endLine: Math.min(cursor + 299, range.endLine), column: 0 }
          requests.push(packed)
        }
        cursor = packed.endLine + 1
      }
    }
  }
  return requests
}
