import { ref, type Ref } from 'vue'

const stateByKey = new Map<string, Ref<unknown>>()

export const useRuntimeConfig = () => ({
  public: {
    serverBase: '',
    serverWsBase: ''
  }
})

export const useState = <T>(key: string, init?: () => T): Ref<T> => {
  if (!stateByKey.has(key)) {
    stateByKey.set(key, ref(init?.() ?? null))
  }

  return stateByKey.get(key) as Ref<T>
}

export const useRoute = () => ({
  params: {},
  query: {},
  path: '/'
})

export const useRouter = () => ({
  push: async () => {},
  replace: async () => {}
})
