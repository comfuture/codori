// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ImmersiveWorkspaceLaunch from '../app/components/ImmersiveWorkspaceLaunch.client.vue'

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: {
    href: {
      type: String,
      default: ''
    },
    external: {
      type: Boolean,
      default: false
    },
    icon: {
      type: String,
      default: ''
    }
  },
  template: `
    <a
      v-bind="$attrs"
      :href="href"
      :data-external="String(external)"
      :data-icon="icon"
    />
  `
})

const TooltipStub = defineComponent({
  template: '<span><slot /></span>'
})

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: true
  })
  Object.defineProperty(navigator, 'xr', {
    configurable: true,
    value: {
      isSessionSupported: async () => true
    }
  })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'xr')
})

describe('immersive workspace launch', () => {
  it('uses a full document navigation and the VR glasses icon', async () => {
    const wrapper = mount(ImmersiveWorkspaceLaunch, {
      props: {
        workspace: {
          kind: 'project',
          id: 'codori'
        },
        threadId: 'thread-103',
        returnTo: '/projects/codori/threads/thread-103'
      },
      global: {
        stubs: {
          UButton: ButtonStub,
          UTooltip: TooltipStub
        }
      }
    })
    await flushPromises()

    const launch = wrapper.get('[data-testid="immersive-workspace-launch"]')
    expect(launch.attributes('href')).toBe(
      '/xr/?workspaceKind=project'
      + '&workspaceId=codori'
      + '&threadId=thread-103'
      + '&returnTo=%2Fprojects%2Fcodori%2Fthreads%2Fthread-103'
    )
    expect(launch.attributes('data-external')).toBe('true')
    expect(launch.attributes('data-icon')).toBe(
      'i-hugeicons-vr-glasses'
    )
  })
})
