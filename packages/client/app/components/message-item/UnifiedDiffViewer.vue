<script setup lang="ts">
import { computed } from 'vue'

type DiffRowKind = 'meta' | 'hunk' | 'context' | 'add' | 'delete' | 'note'

type DiffRow = {
  id: string
  kind: DiffRowKind
  text: string
  prefix: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

const props = defineProps<{
  diff: string
}>()

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

const rows = computed<DiffRow[]>(() => {
  const source = props.diff.replace(/\r\n/g, '\n').trim()
  if (!source) {
    return []
  }

  const parsedRows: DiffRow[] = []
  const lines = source.split('\n')
  let oldLineNumber: number | null = null
  let newLineNumber: number | null = null

  lines.forEach((line, index) => {
    const rowId = `diff-row-${index}`

    if (line.startsWith('@@')) {
      const matched = line.match(HUNK_HEADER_PATTERN)
      oldLineNumber = matched ? Number.parseInt(matched[1] ?? '0', 10) : null
      newLineNumber = matched ? Number.parseInt(matched[2] ?? '0', 10) : null
      parsedRows.push({
        id: rowId,
        kind: 'hunk',
        text: line,
        prefix: '@@',
        oldLineNumber: null,
        newLineNumber: null
      })
      return
    }

    if (
      line.startsWith('diff --git')
      || line.startsWith('index ')
      || line.startsWith('--- ')
      || line.startsWith('+++ ')
    ) {
      parsedRows.push({
        id: rowId,
        kind: 'meta',
        text: line,
        prefix: line.slice(0, Math.min(4, line.length)),
        oldLineNumber: null,
        newLineNumber: null
      })
      return
    }

    if (line.startsWith('\\')) {
      parsedRows.push({
        id: rowId,
        kind: 'note',
        text: line,
        prefix: '\\',
        oldLineNumber: null,
        newLineNumber: null
      })
      return
    }

    if (line.startsWith('+')) {
      parsedRows.push({
        id: rowId,
        kind: 'add',
        text: line.slice(1),
        prefix: '+',
        oldLineNumber: null,
        newLineNumber
      })
      newLineNumber = newLineNumber == null ? null : newLineNumber + 1
      return
    }

    if (line.startsWith('-')) {
      parsedRows.push({
        id: rowId,
        kind: 'delete',
        text: line.slice(1),
        prefix: '-',
        oldLineNumber,
        newLineNumber: null
      })
      oldLineNumber = oldLineNumber == null ? null : oldLineNumber + 1
      return
    }

    parsedRows.push({
      id: rowId,
      kind: 'context',
      text: line.startsWith(' ') ? line.slice(1) : line,
      prefix: ' ',
      oldLineNumber,
      newLineNumber
    })
    oldLineNumber = oldLineNumber == null ? null : oldLineNumber + 1
    newLineNumber = newLineNumber == null ? null : newLineNumber + 1
  })

  return parsedRows
})

const lineNumberText = (value: number | null) => value == null ? '' : String(value)

const rowClass = (kind: DiffRowKind) => {
  switch (kind) {
    case 'meta':
      return 'bg-muted/15 text-muted'
    case 'hunk':
      return 'bg-info/10 text-info'
    case 'add':
      return 'bg-success/10 text-success'
    case 'delete':
      return 'bg-error/10 text-error'
    case 'note':
      return 'bg-muted/10 text-muted italic'
    default:
      return 'text-toned'
  }
}

const gutterClass = (kind: DiffRowKind) => {
  switch (kind) {
    case 'add':
      return 'text-success'
    case 'delete':
      return 'text-error'
    case 'hunk':
      return 'text-info'
    case 'meta':
    case 'note':
      return 'text-muted'
    default:
      return 'text-dimmed'
  }
}
</script>

<template>
  <div class="overflow-x-auto rounded-md border border-default/70 bg-elevated/20">
    <table class="min-w-full border-collapse font-mono text-[11px] leading-5">
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          :class="rowClass(row.kind)"
        >
          <td
            class="w-12 select-none border-r border-default/60 px-2 text-right align-top"
            :class="gutterClass(row.kind)"
          >
            {{ lineNumberText(row.oldLineNumber) }}
          </td>
          <td
            class="w-12 select-none border-r border-default/60 px-2 text-right align-top"
            :class="gutterClass(row.kind)"
          >
            {{ lineNumberText(row.newLineNumber) }}
          </td>
          <td
            class="w-6 select-none border-r border-default/60 px-2 text-center align-top"
            :class="gutterClass(row.kind)"
          >
            {{ row.prefix }}
          </td>
          <td class="px-3 py-0.5 whitespace-pre">
            {{ row.text }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
