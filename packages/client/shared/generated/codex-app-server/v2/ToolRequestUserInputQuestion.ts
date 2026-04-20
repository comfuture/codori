// GENERATED CODE! DO NOT MODIFY BY HAND!
//
// Sourced from the codex app-server ts-rs output to keep the wire contract
// aligned with upstream.

import type { ToolRequestUserInputOption } from './ToolRequestUserInputOption'

export type ToolRequestUserInputQuestion = {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  options: ToolRequestUserInputOption[] | null
}
