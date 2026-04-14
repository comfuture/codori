<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type {
  PendingElicitationField,
  PendingElicitationEnumField,
  PendingMcpElicitationForm
} from '../../../shared/pending-user-request'

const props = defineProps<{
  request: PendingMcpElicitationForm
}>()

const emit = defineEmits<{
  accept: [content: Record<string, string | number | boolean>]
  decline: []
  cancel: []
}>()

const attemptedSubmit = ref(false)
const values = reactive<Record<string, string | boolean>>(
  Object.fromEntries(props.request.fields.map((field) => {
    switch (field.kind) {
      case 'boolean':
        return [field.key, field.defaultValue]
      case 'number':
        return [field.key, field.defaultValue == null ? '' : String(field.defaultValue)]
      case 'enum':
        return [field.key, field.defaultValue == null ? '' : String(field.defaultValue)]
      case 'string':
        return [field.key, field.defaultValue ?? '']
    }
  }))
)

const enumValueFromInput = (field: PendingElicitationEnumField, rawValue: string) => {
  const match = field.options.find(option => String(option.value) === rawValue)
  return match?.value ?? null
}

const resolveFieldError = (field: PendingElicitationField) => {
  const rawValue = values[field.key]

  switch (field.kind) {
    case 'boolean':
      return null
    case 'string': {
      const value = typeof rawValue === 'string' ? rawValue.trim() : ''
      if (field.required && value.length === 0) {
        return 'This field is required.'
      }
      if (field.minLength != null && value.length > 0 && value.length < field.minLength) {
        return `Enter at least ${field.minLength} characters.`
      }
      if (field.maxLength != null && value.length > field.maxLength) {
        return `Keep this under ${field.maxLength} characters.`
      }
      return null
    }
    case 'number': {
      const value = typeof rawValue === 'string' ? rawValue.trim() : ''
      if (value.length === 0) {
        return field.required ? 'This field is required.' : null
      }

      const numericValue = Number(value)
      if (!Number.isFinite(numericValue)) {
        return 'Enter a valid number.'
      }
      if (field.numericType === 'integer' && !Number.isInteger(numericValue)) {
        return 'Enter a whole number.'
      }
      if (field.minimum != null && numericValue < field.minimum) {
        return `Enter a value greater than or equal to ${field.minimum}.`
      }
      if (field.maximum != null && numericValue > field.maximum) {
        return `Enter a value less than or equal to ${field.maximum}.`
      }
      return null
    }
    case 'enum': {
      const value = typeof rawValue === 'string' ? rawValue : ''
      if (value.length === 0) {
        return field.required ? 'Select a value.' : null
      }
      return enumValueFromInput(field, value) == null ? 'Select a valid value.' : null
    }
  }
}

const hasErrors = computed(() =>
  props.request.fields.some(field => resolveFieldError(field) !== null)
)

const buildContent = () => {
  const content: Record<string, string | number | boolean> = {}

  for (const field of props.request.fields) {
    const rawValue = values[field.key]

    switch (field.kind) {
      case 'boolean':
        if (field.required || field.defaultValue === true || rawValue === true) {
          content[field.key] = rawValue === true
        }
        break
      case 'string': {
        const value = typeof rawValue === 'string' ? rawValue.trim() : ''
        if (value.length > 0 || field.required) {
          content[field.key] = value
        }
        break
      }
      case 'number': {
        const value = typeof rawValue === 'string' ? rawValue.trim() : ''
        if (value.length === 0) {
          break
        }
        content[field.key] = Number(value)
        break
      }
      case 'enum': {
        const value = typeof rawValue === 'string' ? rawValue : ''
        if (value.length === 0) {
          break
        }
        const parsedValue = enumValueFromInput(field, value)
        if (parsedValue != null) {
          content[field.key] = parsedValue
        }
        break
      }
    }
  }

  return content
}

const submit = () => {
  attemptedSubmit.value = true
  if (hasErrors.value) {
    return
  }

  emit('accept', buildContent())
}
</script>

<template>
  <form
    class="space-y-3"
    @submit.prevent="submit"
  >
    <div
      v-for="field in request.fields"
      :key="field.key"
      class="rounded-lg border border-default/70 bg-elevated/20 p-3"
    >
      <UFormField
        :name="field.key"
        :label="field.label"
        :description="field.description ?? undefined"
        :required="field.required"
        :error="attemptedSubmit ? (resolveFieldError(field) ?? undefined) : undefined"
        size="sm"
        :ui="{
          root: 'space-y-2',
          container: 'mt-2',
          label: 'text-sm font-semibold text-highlighted',
          description: 'text-xs text-muted',
          error: 'mt-2 text-xs font-medium text-error'
        }"
      >
        <UInput
          v-if="field.kind === 'string'"
          :id="`elicitation-field-${field.key}`"
          :model-value="String(values[field.key] ?? '')"
          color="neutral"
          variant="subtle"
          size="sm"
          class="w-full"
          :type="field.format === 'email' ? 'email' : field.format === 'uri' ? 'url' : field.format === 'date' ? 'date' : field.format === 'date-time' ? 'datetime-local' : 'text'"
          :ui="{ base: 'rounded-lg' }"
          @update:model-value="values[field.key] = String($event ?? '')"
        />

        <UInput
          v-else-if="field.kind === 'number'"
          :id="`elicitation-field-${field.key}`"
          :model-value="String(values[field.key] ?? '')"
          color="neutral"
          variant="subtle"
          size="sm"
          class="w-full"
          :step="field.numericType === 'integer' ? '1' : 'any'"
          type="number"
          :ui="{ base: 'rounded-lg' }"
          @update:model-value="values[field.key] = String($event ?? '')"
        />

        <select
          v-else-if="field.kind === 'enum'"
          :id="`elicitation-field-${field.key}`"
          :value="String(values[field.key] ?? '')"
          class="w-full rounded-lg border border-default/70 bg-elevated px-3 py-2 text-sm text-default outline-none transition focus:border-primary/50"
          @change="values[field.key] = ($event.target as HTMLSelectElement).value"
        >
          <option value="">
            {{ field.required ? 'Select a value' : 'Leave blank' }}
          </option>
          <option
            v-for="option in field.options"
            :key="`${field.key}-${String(option.value)}`"
            :value="String(option.value)"
          >
            {{ option.label }}
          </option>
        </select>

        <label
          v-else
          class="flex items-center gap-2 rounded-lg border border-default/70 bg-elevated px-3 py-2 text-sm text-default"
        >
          <input
            :checked="values[field.key] === true"
            type="checkbox"
            @change="values[field.key] = ($event.target as HTMLInputElement).checked"
          >
          <span>Enabled</span>
        </label>
      </UFormField>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
      <UButton
        type="button"
        color="error"
        variant="ghost"
        size="sm"
        class="rounded-lg"
        @click="emit('decline')"
      >
        Decline
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        size="sm"
        class="rounded-lg"
        @click="emit('cancel')"
      >
        Cancel
      </UButton>
      <UButton
        type="submit"
        color="primary"
        size="sm"
        class="rounded-lg"
      >
        Continue
      </UButton>
    </div>
  </form>
</template>
