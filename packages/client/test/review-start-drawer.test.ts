/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import ReviewStartDrawer from '../app/components/ReviewStartDrawer.vue'

const DrawerStub = defineComponent({
  name: 'DrawerStub',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  setup(props, { slots }) {
    return () => props.open
      ? h('div', { class: 'drawer-stub' }, [
          h('div', { class: 'drawer-header' }, slots.header?.()),
          h('div', { class: 'drawer-body' }, slots.body?.()),
          slots.default?.()
        ])
      : null
  }
})

const ButtonStub = defineComponent({
  name: 'ButtonStub',
  props: {
    type: {
      type: String,
      default: 'button'
    }
  },
  emits: ['click'],
  setup(props, { emit, slots }) {
    return () => h('button', {
      type: props.type,
      onClick: (event: MouseEvent) => emit('click', event)
    }, slots.default?.())
  }
})

const CommandPaletteStub = defineComponent({
  name: 'CommandPaletteStub',
  props: {
    groups: {
      type: Array,
      default: () => []
    },
    searchTerm: {
      type: String,
      default: ''
    }
  },
  emits: ['update:searchTerm'],
  setup(props, { emit }) {
    return () => h('div', { class: 'command-palette-stub' }, [
      h('input', {
        class: 'command-search',
        value: props.searchTerm,
        onInput: (event: Event) => emit('update:searchTerm', (event.target as HTMLInputElement).value)
      }),
      ...(props.groups as Array<{ items?: Array<Record<string, unknown>> }>).flatMap(group =>
        (group.items ?? []).map((item) => h('button', {
          type: 'button',
          class: 'command-item',
          onClick: () => {
            const onSelect = item.onSelect
            if (typeof onSelect === 'function') {
              onSelect()
            }
          }
        }, `${String(item.label ?? '')} ${String(item.description ?? '')}`))
      )
    ])
  }
})

const mountDrawer = (props: Record<string, unknown>) =>
  mount(ReviewStartDrawer, {
    props,
    global: {
      stubs: {
        BottomDrawerShell: false,
        UDrawer: DrawerStub,
        UButton: ButtonStub,
        UCommandPalette: CommandPaletteStub,
        UAlert: defineComponent({
          name: 'AlertStub',
          props: {
            title: {
              type: String,
              default: ''
            }
          },
          setup(props) {
            return () => h('div', { class: 'alert-stub' }, props.title)
          }
        }),
        UIcon: defineComponent({
          name: 'IconStub',
          setup() {
            return () => h('span', { class: 'icon-stub' })
          }
        })
      }
    }
  })

describe('review start drawer', () => {
  it('renders the target selection step and emits current-changes selection', async () => {
    const wrapper = mountDrawer({
      open: true,
      mode: 'target'
    })

    expect(wrapper.text()).toContain('Review current changes')
    expect(wrapper.text()).toContain('Review against a base branch')

    const currentChangesButton = wrapper.findAll('button').find(button => button.text().includes('Review current changes'))
    expect(currentChangesButton).toBeTruthy()

    await currentChangesButton!.trigger('click')

    expect(wrapper.emitted('chooseCurrentChanges')).toHaveLength(1)
  })

  it('renders searchable branches and emits the selected branch', async () => {
    const wrapper = mountDrawer({
      open: true,
      mode: 'branch',
      currentBranch: 'feature/ui',
      branches: ['main', 'release']
    })

    expect(wrapper.text()).toContain('Current feature/ui')
    expect(wrapper.text()).toContain('main')
    expect(wrapper.text()).toContain('release')

    await wrapper.get('.command-search').setValue('rel')

    expect(wrapper.text()).not.toContain('main')
    expect(wrapper.text()).toContain('release')

    const releaseButton = wrapper.findAll('button').find(button => button.text().includes('release'))
    expect(releaseButton).toBeTruthy()

    await releaseButton!.trigger('click')

    expect(wrapper.emitted('chooseBaseBranch')?.[0]?.[0]).toBe('release')
  })
})
