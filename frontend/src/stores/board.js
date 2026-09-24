import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { boardApi, columnApi, cardApi } from '../api/index.js'

// Unified lifecycle states shared by every load:
//   'idle'    -> nothing loaded yet, or cleanup has completed
//   'loading' -> a load is in flight (preparing)
//   'ready'   -> last load succeeded
//   'error'   -> last load failed (see `error` for the message)
export const useBoardStore = defineStore('board', () => {
  const boards = ref([])
  const currentBoard = ref(null)
  const columns = ref([])
  const cards = ref({}) // keyed by columnId -> [cards]

  const status = ref('idle')
  const error = ref(null)

  // Kept for compatibility: views read `loading` to show spinners.
  const loading = computed(() => status.value === 'loading')

  // Generation token for the current lifecycle. Every new load and every
  // cleanup bumps it, so async completions from an interrupted or stale
  // lifecycle are dropped instead of resurrecting old state.
  let loadToken = 0

  function beginLoad() {
    loadToken += 1
    status.value = 'loading'
    error.value = null
    return loadToken
  }

  function isCurrent(token) {
    return token === loadToken
  }

  function settleLoad(token, err) {
    if (!isCurrent(token)) return
    if (err) {
      status.value = 'error'
      error.value = err?.response?.data?.error || err?.message || 'Request failed'
    } else {
      status.value = 'ready'
      error.value = null
    }
  }

  // Board actions
  async function fetchBoards() {
    const token = beginLoad()
    try {
      const res = await boardApi.list()
      if (!isCurrent(token)) return
      boards.value = res.data
      settleLoad(token, null)
    } catch (err) {
      settleLoad(token, err)
    }
  }

  async function createBoard(name, description) {
    const res = await boardApi.create(name, description)
    boards.value.unshift(res.data)
    return res.data
  }

  async function deleteBoard(id) {
    await boardApi.delete(id)
    boards.value = boards.value.filter(b => b.id !== id)
  }

  // Load a board page (columns + cards + board meta) as one lifecycle phase,
  // so the view never renders a half-loaded "ready" state.
  async function loadBoard(boardId) {
    const token = beginLoad()
    try {
      const colRes = await columnApi.list(boardId)
      if (!isCurrent(token)) return
      columns.value = colRes.data
      cards.value = {}
      for (const col of colRes.data) {
        cards.value[col.id] = []
      }

      const results = await Promise.all(colRes.data.map(col => cardApi.list(col.id)))
      if (!isCurrent(token)) return
      colRes.data.forEach((col, i) => {
        cards.value[col.id] = results[i].data
      })

      // Resolve board meta from the cached list, refetching it if needed
      let board = boards.value.find(b => b.id === boardId)
      if (!board) {
        const listRes = await boardApi.list()
        if (!isCurrent(token)) return
        boards.value = listRes.data
        board = boards.value.find(b => b.id === boardId)
      }
      currentBoard.value = board || { id: boardId, name: `Board #${boardId}` }
      settleLoad(token, null)
    } catch (err) {
      settleLoad(token, err)
    }
  }

  // Column actions
  async function fetchColumns(boardId) {
    const token = beginLoad()
    try {
      const res = await columnApi.list(boardId)
      if (!isCurrent(token)) return
      columns.value = res.data
      // Initialize cards map
      cards.value = {}
      for (const col of res.data) {
        cards.value[col.id] = []
      }
      settleLoad(token, null)
    } catch (err) {
      settleLoad(token, err)
    }
  }

  async function addColumn(boardId, name) {
    const res = await columnApi.create(boardId, name)
    columns.value.push(res.data)
    cards.value[res.data.id] = []
    return res.data
  }

  async function renameColumn(colId, name) {
    const res = await columnApi.update(colId, { name })
    const idx = columns.value.findIndex(c => c.id === colId)
    if (idx !== -1) columns.value[idx] = res.data
    return res.data
  }

  async function deleteColumn(colId) {
    await columnApi.delete(colId)
    columns.value = columns.value.filter(c => c.id !== colId)
    delete cards.value[colId]
  }

  async function reorderColumn(colId, newPosition) {
    const res = await columnApi.update(colId, { position: newPosition })
    // Refresh columns to get correct order
    if (currentBoard.value) {
      await fetchColumns(currentBoard.value.id)
    }
    return res.data
  }

  // Card actions
  async function fetchCards(columnId) {
    const token = loadToken
    const res = await cardApi.list(columnId)
    if (isCurrent(token)) {
      cards.value[columnId] = res.data
    }
    return res.data
  }

  async function fetchAllCards(boardId) {
    // Fetch cards for all columns in parallel
    const token = loadToken
    const cols = columns.value
    const promises = cols.map(col => cardApi.list(col.id))
    const results = await Promise.all(promises)
    if (!isCurrent(token)) return
    cols.forEach((col, i) => {
      cards.value[col.id] = results[i].data
    })
  }

  async function addCard(columnId, data) {
    const res = await cardApi.create(columnId, data)
    if (!cards.value[columnId]) cards.value[columnId] = []
    cards.value[columnId].push(res.data)
    return res.data
  }

  async function updateCard(cardId, data) {
    const res = await cardApi.update(cardId, data)
    // Update card in the local state
    for (const colId in cards.value) {
      const idx = cards.value[colId].findIndex(c => c.id === cardId)
      if (idx !== -1) {
        cards.value[colId][idx] = res.data
        break
      }
    }
    return res.data
  }

  async function deleteCard(cardId) {
    await cardApi.delete(cardId)
    for (const colId in cards.value) {
      cards.value[colId] = cards.value[colId].filter(c => c.id !== cardId)
    }
  }

  async function moveCard(cardId, targetColumnId, position) {
    const res = await cardApi.move(cardId, targetColumnId, position)
    // Remove card from old column and add to new column
    let movedCard = null
    for (const colId in cards.value) {
      const idx = cards.value[colId].findIndex(c => c.id === cardId)
      if (idx !== -1) {
        movedCard = cards.value[colId].splice(idx, 1)[0]
        break
      }
    }
    if (movedCard) {
      movedCard.column_id = targetColumnId
      movedCard.position = position
      if (!cards.value[targetColumnId]) cards.value[targetColumnId] = []
      // Insert at position
      cards.value[targetColumnId].splice(position, 0, movedCard)
    }
    return res.data
  }

  // Leaving a board: drop the detail state, invalidate any in-flight load,
  // and settle back to a definite 'idle' state.
  function clearBoard() {
    loadToken += 1
    currentBoard.value = null
    columns.value = []
    cards.value = {}
    status.value = 'idle'
    error.value = null
  }

  // Full reset (logout / new session): nothing from the previous
  // lifecycle may leak into the next one.
  function resetAll() {
    clearBoard()
    boards.value = []
  }

  return {
    boards, currentBoard, columns, cards, status, error, loading,
    fetchBoards, createBoard, deleteBoard, loadBoard,
    fetchColumns, addColumn, renameColumn, deleteColumn, reorderColumn,
    fetchCards, fetchAllCards, addCard, updateCard, deleteCard, moveCard,
    clearBoard, resetAll
  }
})
