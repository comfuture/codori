import { useRuntimeConfig, useState } from '#imports'
import { $fetch } from 'ofetch'
import {
  encodeChatIdSegment,
  type ChatResponse,
  type ChatSessionRecord,
  type ChatsResponse,
  type DeleteChatResponse,
  type StartChatSessionResult,
  type UpdateChatThreadRequest,
  type UpdateChatTitleRequest
} from '~~/shared/codori'
import { resolveApiUrl, shouldUseServerProxy } from '~~/shared/network'

const mergeChat = (chats: ChatSessionRecord[], nextChat: ChatSessionRecord) => {
  const filtered = chats.filter(chat => chat.chatId !== nextChat.chatId)
  return [nextChat, ...filtered]
    .sort((left, right) => (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt))
    .slice(0, 5)
}

export const useChats = () => {
  const chats = useState<ChatSessionRecord[]>('codori-chats', () => [])
  const loaded = useState<boolean>('codori-chats-loaded', () => false)
  const loading = useState<boolean>('codori-chats-loading', () => false)
  const createPending = useState<boolean>('codori-chats-create-pending', () => false)
  const deletePendingId = useState<string | null>('codori-chats-delete-pending-id', () => null)
  const pendingChatId = useState<string | null>('codori-chats-pending-id', () => null)
  const error = useState<string | null>('codori-chats-error', () => null)
  const configuredBase = String(useRuntimeConfig().public.serverBase ?? '')
  const useProxy = shouldUseServerProxy(configuredBase)

  const toApiUrl = (path: string) =>
    useProxy
      ? `/api/codori${path}`
      : resolveApiUrl(path, configuredBase)

  const applyChatResponse = (response: ChatResponse) => {
    const nextChat = response.chat as ChatSessionRecord
    chats.value = mergeChat(chats.value, nextChat)
    return nextChat
  }

  const refreshChats = async () => {
    if (loading.value) {
      return
    }

    loading.value = true
    error.value = null
    try {
      const response = await $fetch<ChatsResponse>(toApiUrl('/chats'))
      chats.value = response.chats.slice(0, 5)
      loaded.value = true
    } catch (caughtError) {
      error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
    } finally {
      loading.value = false
    }
  }

  const createChat = async () => {
    if (createPending.value) {
      throw new Error('A new chat is already being created.')
    }

    createPending.value = true
    error.value = null
    try {
      const response = await $fetch<ChatResponse>(toApiUrl('/chats'), {
        method: 'POST'
      })
      loaded.value = true
      return applyChatResponse(response)
    } finally {
      createPending.value = false
    }
  }

  const fetchChat = async (chatId: string) => {
    const response = await $fetch<ChatResponse>(toApiUrl(
      `/chats/${encodeChatIdSegment(chatId)}`
    ))
    return applyChatResponse(response)
  }

  const startChat = async (chatId: string) => {
    pendingChatId.value = chatId
    try {
      const response = await $fetch<ChatResponse>(toApiUrl(
        `/chats/${encodeChatIdSegment(chatId)}/start`
      ), {
        method: 'POST'
      })
      return applyChatResponse(response) as StartChatSessionResult
    } finally {
      pendingChatId.value = null
    }
  }

  const deleteChat = async (chatId: string) => {
    if (deletePendingId.value) {
      throw new Error('A chat deletion is already in progress.')
    }

    deletePendingId.value = chatId
    error.value = null
    try {
      const response = await $fetch<DeleteChatResponse>(toApiUrl(
        `/chats/${encodeChatIdSegment(chatId)}`
      ), {
        method: 'DELETE'
      })
      chats.value = chats.value.filter(chat => chat.chatId !== response.chatId)
      return response
    } finally {
      deletePendingId.value = null
    }
  }

  const renameChat = async (chatId: string, title: string) => {
    const nextTitle = title.trim()
    if (!nextTitle) {
      return null
    }

    chats.value = chats.value.map(chat =>
      chat.chatId === chatId
        ? { ...chat, title: nextTitle, updatedAt: Date.now() }
        : chat
    )

    const response = await $fetch<ChatResponse>(toApiUrl(
      `/chats/${encodeChatIdSegment(chatId)}/title`
    ), {
      method: 'POST',
      body: {
        title: nextTitle
      } satisfies UpdateChatTitleRequest
    })
    return applyChatResponse(response)
  }

  const setChatThread = async (chatId: string, threadId: string) => {
    const nextThreadId = threadId.trim()
    if (!nextThreadId) {
      return null
    }

    chats.value = chats.value.map(chat =>
      chat.chatId === chatId
        ? { ...chat, threadId: nextThreadId, updatedAt: Date.now() }
        : chat
    )

    const response = await $fetch<ChatResponse>(toApiUrl(
      `/chats/${encodeChatIdSegment(chatId)}/thread`
    ), {
      method: 'POST',
      body: {
        threadId: nextThreadId
      } satisfies UpdateChatThreadRequest
    })
    return applyChatResponse(response)
  }

  const getChat = (chatId: string | null) => {
    if (!chatId) {
      return null
    }
    return chats.value.find(chat => chat.chatId === chatId) ?? null
  }

  return {
    chats,
    loaded,
    loading,
    createPending,
    deletePendingId,
    pendingChatId,
    error,
    refreshChats,
    fetchChat,
    createChat,
    startChat,
    deleteChat,
    renameChat,
    setChatThread,
    getChat
  }
}
