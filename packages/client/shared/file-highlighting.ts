import { bundledLanguagesInfo } from 'shiki'

const specialBasenameLanguages = new Map<string, string>([
  ['dockerfile', 'docker'],
  ['makefile', 'make'],
  ['cmakelists.txt', 'cmake'],
  ['gemfile', 'ruby'],
  ['rakefile', 'ruby'],
  ['podfile', 'ruby'],
  ['brewfile', 'ruby'],
  ['jenkinsfile', 'groovy']
])

const specialSuffixLanguages = new Map<string, string>([
  ['.d.ts', 'typescript'],
  ['.d.mts', 'typescript'],
  ['.d.cts', 'typescript']
])

const languageInfoById = new Map(
  bundledLanguagesInfo.map((info) => [info.id.toLowerCase(), info])
)

const languageAliasToId = new Map<string, string>()

for (const info of bundledLanguagesInfo) {
  languageAliasToId.set(info.id.toLowerCase(), info.id)

  for (const alias of info.aliases ?? []) {
    languageAliasToId.set(alias.toLowerCase(), info.id)
  }
}

const findShebangLanguage = (text: string) => {
  const firstLine = text.split('\n', 1)[0]?.trim() ?? ''
  if (!firstLine.startsWith('#!')) {
    return null
  }

  const normalized = firstLine.toLowerCase()
  if (/python/.test(normalized)) {
    return 'python'
  }

  if (/(node|deno|bun)/.test(normalized)) {
    return 'javascript'
  }

  if (/(bash|zsh|\/sh\b|shell)/.test(normalized)) {
    return 'shellscript'
  }

  if (/ruby/.test(normalized)) {
    return 'ruby'
  }

  if (/php/.test(normalized)) {
    return 'php'
  }

  if (/perl/.test(normalized)) {
    return 'perl'
  }

  return null
}

const resolveExtensionLanguage = (filePath: string) => {
  const normalizedPath = filePath.toLowerCase()

  for (const [suffix, language] of specialSuffixLanguages.entries()) {
    if (normalizedPath.endsWith(suffix)) {
      return language
    }
  }

  const basename = normalizedPath.split(/[\\/]/u).pop() ?? normalizedPath
  const segments = basename.split('.')
  if (segments.length < 2) {
    return null
  }

  for (let index = 1; index < segments.length; index += 1) {
    const candidate = segments.slice(index).join('.')
    const resolved = languageAliasToId.get(candidate)
    if (resolved) {
      return resolved
    }
  }

  return null
}

export const inferLocalFileLanguage = (filePath: string, text = '') => {
  const basename = filePath.toLowerCase().split(/[\\/]/u).pop() ?? ''
  const specialBasenameLanguage = specialBasenameLanguages.get(basename)
  if (specialBasenameLanguage) {
    return specialBasenameLanguage
  }

  const extensionLanguage = resolveExtensionLanguage(filePath)
  if (extensionLanguage) {
    return extensionLanguage
  }

  return findShebangLanguage(text)
}

export const resolveLocalFileLanguageLabel = (language: string | null) => {
  if (!language) {
    return null
  }

  return languageInfoById.get(language.toLowerCase())?.name ?? language
}

export const buildHighlightedFileMarkdown = (text: string, language: string | null) => {
  const longestBacktickRun = Math.max(
    2,
    ...Array.from(text.matchAll(/`+/g), (match) => match[0].length)
  )
  const fence = '`'.repeat(longestBacktickRun + 1)
  const languageSuffix = language ?? ''
  const body = text.endsWith('\n') ? text : `${text}\n`

  return `${fence}${languageSuffix}\n${body}${fence}`
}
