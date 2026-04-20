import type { CodexRpcServerRequest } from './codex-rpc'
import type { RequestId } from './generated/codex-app-server/RequestId'
import type { ToolRequestUserInputAnswer } from './generated/codex-app-server/v2/ToolRequestUserInputAnswer'
import type { ToolRequestUserInputParams } from './generated/codex-app-server/v2/ToolRequestUserInputParams'
import type { ToolRequestUserInputOption } from './generated/codex-app-server/v2/ToolRequestUserInputOption'
import type { ToolRequestUserInputQuestion } from './generated/codex-app-server/v2/ToolRequestUserInputQuestion'
import type { ToolRequestUserInputResponse } from './generated/codex-app-server/v2/ToolRequestUserInputResponse'

type PendingRequestId = RequestId

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asTrimmedString = (value: unknown) => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const asBoolean = (value: unknown) => value === true

const asStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

export type PendingRequestUserInputOption = Omit<ToolRequestUserInputOption, 'description'> & {
  description: string | null
}

export type PendingRequestUserInputQuestion = {
  header: ToolRequestUserInputQuestion['header'] | null
  id: ToolRequestUserInputQuestion['id']
  question: ToolRequestUserInputQuestion['question']
  options: PendingRequestUserInputOption[]
  isOther: ToolRequestUserInputQuestion['isOther']
  isSecret: ToolRequestUserInputQuestion['isSecret']
}

export type PendingRequestUserInput = {
  kind: 'requestUserInput'
  requestId: PendingRequestId
  threadId: string | null
  turnId: string | null
  itemId: string | null
  questions: PendingRequestUserInputQuestion[]
}

type BaseElicitationField = {
  key: string
  label: string
  description: string | null
  required: boolean
}

export type PendingElicitationStringField = BaseElicitationField & {
  kind: 'string'
  minLength: number | null
  maxLength: number | null
  format: 'email' | 'uri' | 'date' | 'date-time' | null
  defaultValue: string | null
}

export type PendingElicitationNumberField = BaseElicitationField & {
  kind: 'number'
  numericType: 'number' | 'integer'
  minimum: number | null
  maximum: number | null
  defaultValue: number | null
}

export type PendingElicitationBooleanField = BaseElicitationField & {
  kind: 'boolean'
  defaultValue: boolean
}

export type PendingElicitationEnumField = BaseElicitationField & {
  kind: 'enum'
  valueType: 'string' | 'number' | 'integer' | 'boolean'
  options: Array<{
    label: string
    value: string | number | boolean
  }>
  defaultValue: string | number | boolean | null
}

export type PendingElicitationField =
  | PendingElicitationStringField
  | PendingElicitationNumberField
  | PendingElicitationBooleanField
  | PendingElicitationEnumField

export type PendingMcpElicitationForm = {
  kind: 'mcpElicitationForm'
  requestId: PendingRequestId
  threadId: string | null
  message: string | null
  fields: PendingElicitationField[]
}

export type PendingMcpElicitationUrl = {
  kind: 'mcpElicitationUrl'
  requestId: PendingRequestId
  threadId: string | null
  message: string | null
  url: string
  elicitationId: string | null
}

export type PendingUserRequest =
  | PendingRequestUserInput
  | PendingMcpElicitationForm
  | PendingMcpElicitationUrl

export type PendingUserRequestState = PendingUserRequest & {
  submitting: boolean
}

const parseRequestUserInputOption = (value: unknown): PendingRequestUserInputOption | null => {
  if (!isObjectRecord(value)) {
    return null
  }

  const label = asTrimmedString(value.label)
  if (!label) {
    return null
  }

  return {
    label,
    description: asTrimmedString(value.description)
  }
}

const parseRequestUserInputQuestion = (value: unknown): PendingRequestUserInputQuestion | null => {
  if (!isObjectRecord(value)) {
    return null
  }

  const id = asTrimmedString(value.id)
  const question = asTrimmedString(value.question)
  if (!id || !question) {
    return null
  }

  const options = Array.isArray(value.options)
    ? value.options
      .map(parseRequestUserInputOption)
      .filter((option): option is PendingRequestUserInputOption => option !== null)
    : []

  return {
    header: asTrimmedString(value.header),
    id,
    question,
    options,
    isOther: asBoolean(value.isOther),
    isSecret: asBoolean(value.isSecret)
  }
}

const parseNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const parseEnumValueType = (values: Array<string | number | boolean>) => {
  if (values.every(value => typeof value === 'string')) {
    return 'string'
  }

  if (values.every(value => typeof value === 'boolean')) {
    return 'boolean'
  }

  if (values.every(value => typeof value === 'number' && Number.isInteger(value))) {
    return 'integer'
  }

  if (values.every(value => typeof value === 'number')) {
    return 'number'
  }

  return null
}

const parseElicitationField = (
  key: string,
  value: unknown,
  requiredKeys: Set<string>
): PendingElicitationField | null => {
  if (!isObjectRecord(value)) {
    return null
  }

  const label = asTrimmedString(value.title) ?? key
  const description = asTrimmedString(value.description)
  const required = requiredKeys.has(key)
  const enumValues = Array.isArray(value.enum)
    ? value.enum.filter((entry): entry is string | number | boolean =>
      typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean')
    : []

  if (enumValues.length > 0) {
    const valueType = parseEnumValueType(enumValues)
    if (!valueType) {
      return null
    }

    const defaultValue = enumValues.includes(value.default as never)
      ? value.default as string | number | boolean
      : null

    return {
      kind: 'enum',
      key,
      label,
      description,
      required,
      valueType,
      defaultValue,
      options: enumValues.map(option => ({
        label: String(option),
        value: option
      }))
    }
  }

  if (value.type === 'string') {
    const format = value.format === 'email'
      || value.format === 'uri'
      || value.format === 'date'
      || value.format === 'date-time'
      ? value.format
      : null

    return {
      kind: 'string',
      key,
      label,
      description,
      required,
      minLength: parseNumber(value.minLength),
      maxLength: parseNumber(value.maxLength),
      format,
      defaultValue: typeof value.default === 'string' ? value.default : null
    }
  }

  if (value.type === 'number' || value.type === 'integer') {
    return {
      kind: 'number',
      key,
      label,
      description,
      required,
      numericType: value.type,
      minimum: parseNumber(value.minimum),
      maximum: parseNumber(value.maximum),
      defaultValue: typeof value.default === 'number' ? value.default : null
    }
  }

  if (value.type === 'boolean') {
    return {
      kind: 'boolean',
      key,
      label,
      description,
      required,
      defaultValue: value.default === true
    }
  }

  return null
}

export const parsePendingUserRequest = (request: CodexRpcServerRequest): PendingUserRequest | null => {
  const params = isObjectRecord(request.params) ? request.params : null

  switch (request.method) {
    case 'item/tool/requestUserInput': {
      const typedParams = params as Partial<ToolRequestUserInputParams> | null
      const questions = Array.isArray(typedParams?.questions)
        ? typedParams.questions
          .map(parseRequestUserInputQuestion)
          .filter((question): question is PendingRequestUserInputQuestion => question !== null)
        : []
      if (questions.length === 0) {
        return null
      }

      return {
        kind: 'requestUserInput',
        requestId: request.id,
        threadId: asTrimmedString(typedParams?.threadId),
        turnId: asTrimmedString(typedParams?.turnId),
        itemId: asTrimmedString(typedParams?.itemId),
        questions
      }
    }
    case 'mcpServer/elicitation/request': {
      const mode = asTrimmedString(params?.mode)
      if (mode === 'url') {
        const url = asTrimmedString(params?.url)
        if (!url) {
          return null
        }

        return {
          kind: 'mcpElicitationUrl',
          requestId: request.id,
          threadId: asTrimmedString(params?.threadId),
          message: asTrimmedString(params?.message),
          url,
          elicitationId: asTrimmedString(params?.elicitationId)
        }
      }

      if (mode !== 'form') {
        return null
      }

      const requestedSchema = isObjectRecord(params?.requestedSchema) ? params.requestedSchema : null
      if (!requestedSchema || requestedSchema.type !== 'object') {
        return null
      }

      const properties = isObjectRecord(requestedSchema.properties) ? requestedSchema.properties : null
      if (!properties) {
        return null
      }

      const requiredKeys = new Set(asStringArray(requestedSchema.required))
      const fields = Object.entries(properties)
        .map(([key, value]) => parseElicitationField(key, value, requiredKeys))
        .filter((field): field is PendingElicitationField => field !== null)
      if (fields.length === 0) {
        return null
      }

      return {
        kind: 'mcpElicitationForm',
        requestId: request.id,
        threadId: asTrimmedString(params?.threadId),
        message: asTrimmedString(params?.message),
        fields
      }
    }
    default:
      return null
  }
}

const sanitizeAnswerList = (answers: string[]): ToolRequestUserInputAnswer['answers'] =>
  answers
    .map(answer => answer.trim())
    .filter(answer => answer.length > 0)

export const buildRequestUserInputResponse = (
  answers: Record<string, string[]>
): ToolRequestUserInputResponse => ({
  answers: Object.fromEntries(
    Object.entries(answers).map(([questionId, questionAnswers]) => [questionId, {
      answers: sanitizeAnswerList(questionAnswers)
    }])
  )
})

export const buildMcpElicitationResponse = (
  action: 'accept' | 'decline' | 'cancel',
  content?: Record<string, string | number | boolean>
) => {
  if (action !== 'accept') {
    return { action }
  }

  return content ? { action, content } : { action }
}

export const buildPendingUserRequestDismissResponse = (request: PendingUserRequest) => {
  switch (request.kind) {
    case 'requestUserInput':
      return buildRequestUserInputResponse({})
    case 'mcpElicitationForm':
    case 'mcpElicitationUrl':
      return buildMcpElicitationResponse('cancel')
  }
}
