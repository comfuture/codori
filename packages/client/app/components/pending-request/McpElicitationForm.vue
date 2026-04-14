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
        content[field.key] = rawValue === true
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
    class="space-y-4"
    @submit.prevent="submit"
  >
    <section
      v-for="field in request.fields"
      :key="field.key"
      class="rounded-3xl border border-default bg-elevated/30 p-4"
    >
      <div class="space-y-1">
        <h3 class="text-sm font-semibold text-highlighted">
          {{ field.label }}
        </h3>
        <p
          v-if="field.description"
          class="text-sm text-muted"
        >
          {{ field.description }}
        </p>
      </div>

      <div class="mt-4">
        <textarea
          v-if="field.kind === 'string' && (field.maxLength == null || field.maxLength > 120)"
          :id="`elicitation-field-${field.key}`"
          :value="String(values[field.key] ?? '')"
          rows="4"
          class="min-h-28 w-full rounded-2xl border border-default bg-default px-3 py-2 text-sm text-default outline-none transition focus:border-primary/50"
          @input="values[field.key] = ($event.target as HTMLTextAreaElement).value"
        />

        <input
          v-else-if="field.kind === 'string'"
          :id="`elicitation-field-${field.key}`"
          :value="String(values[field.key] ?? '')"
          class="w-full rounded-2xl border border-default bg-default px-3 py-2 text-sm text-default outline-none transition focus:border-primary/50"
          :type="field.format === 'email' ? 'email' : field.format === 'uri' ? 'url' : field.format === 'date' ? 'date' : field.format === 'date-time' ? 'datetime-local' : 'text'"
          @input="values[field.key] = ($event.target as HTMLInputElement).value"
        >

        <input
          v-else-if="field.kind === 'number'"
          :id="`elicitation-field-${field.key}`"
          :value="String(values[field.key] ?? '')"
          class="w-full rounded-2xl border border-default bg-default px-3 py-2 text-sm text-default outline-none transition focus:border-primary/50"
          :step="field.numericType === 'integer' ? '1' : 'any'"
          type="number"
          @input="values[field.key] = ($event.target as HTMLInputElement).value"
        >

        <select
          v-else-if="field.kind === 'enum'"
          :id="`elicitation-field-${field.key}`"
          :value="String(values[field.key] ?? '')"
          class="w-full rounded-2xl border border-default bg-default px-3 py-2 text-sm text-default outline-none transition focus:border-primary/50"
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
          class="flex items-center gap-3 rounded-2xl border border-default bg-default px-3 py-2 text-sm text-default"
        >
          <input
            :checked="values[field.key] === true"
            type="checkbox"
            @change="values[field.key] = ($event.target as HTMLInputElement).checked"
          >
          <span>Enabled</span>
        </label>
      </div>

      <p
        v-if="attemptedSubmit && resolveFieldError(field)"
        class="mt-2 text-xs font-medium text-error"
      >
        {{ resolveFieldError(field) }}
      </p>
    </section>

    <div class="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        class="rounded-full border border-default px-4 py-2 text-sm font-medium text-default transition hover:border-error/40 hover:text-error"
        @click="emit('decline')"
      >
        Decline
      </button>
      <button
        type="button"
        class="rounded-full border border-default px-4 py-2 text-sm font-medium text-default transition hover:border-default/80 hover:text-highlighted"
        @click="emit('cancel')"
      >
        Cancel
      </button>
      <button
        type="submit"
        class="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-inverted transition"
      >
        Continue
      </button>
    </div>
  </form>
</template>
