import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi } from '../api/index.js'
import { useBoardStore } from './board.js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const token = ref(null)

  const isLoggedIn = computed(() => !!token.value)

  function loadFromStorage() {
    const savedToken = localStorage.getItem('token')
    const savedUser = localStorage.getItem('user')
    if (savedToken && savedUser) {
      token.value = savedToken
      user.value = JSON.parse(savedUser)
    }
  }

  async function login(username, password) {
    const res = await authApi.login(username, password)
    // Start the new session from a clean lifecycle state
    useBoardStore().resetAll()
    token.value = res.data.token
    user.value = res.data.user
    localStorage.setItem('token', res.data.token)
    localStorage.setItem('user', JSON.stringify(res.data.user))
    return res.data
  }

  async function register(username, password) {
    const res = await authApi.register(username, password)
    // Start the new session from a clean lifecycle state
    useBoardStore().resetAll()
    token.value = res.data.token
    user.value = res.data.user
    localStorage.setItem('token', res.data.token)
    localStorage.setItem('user', JSON.stringify(res.data.user))
    return res.data
  }

  function logout() {
    user.value = null
    token.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    // Clear board state so no stale "ready" data leaks into the next session
    useBoardStore().resetAll()
  }

  return { user, token, isLoggedIn, loadFromStorage, login, register, logout }
})
