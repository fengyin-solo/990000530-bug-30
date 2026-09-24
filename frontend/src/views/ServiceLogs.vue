<template>
  <div class="logs-page">
    <div class="logs-header">
      <div class="logs-title">
        <el-button text :icon="ArrowLeft" @click="$router.push('/services')">返回看板</el-button>
        <h2>{{ service?.name || serviceId }} · 日志</h2>
        <el-tag
          v-if="service"
          :type="STATUS_TAG_TYPE[service.status]"
          effect="dark"
          class="status-tag"
        >
          <el-icon v-if="service.status === 'preparing' || service.status === 'stopping'" class="is-loading">
            <Loading />
          </el-icon>
          {{ STATUS_LABELS[service.status] }}
        </el-tag>
      </div>
      <div class="logs-actions">
        <el-select v-model="phaseFilter" placeholder="全部阶段" clearable size="default" style="width: 140px">
          <el-option label="准备中" value="preparing" />
          <el-option label="就绪" value="ready" />
          <el-option label="失败" value="failed" />
          <el-option label="停止中" value="stopping" />
          <el-option label="已停止" value="stopped" />
        </el-select>
        <el-switch v-model="autoRefresh" active-text="自动刷新" @change="togglePoll" />
        <el-button :icon="Refresh" @click="loadLogs">刷新</el-button>
      </div>
    </div>

    <!-- The stage banner always reflects the canonical status, so the page
         can never show a phase that disagrees with the board. -->
    <el-alert
      v-if="service"
      :title="`当前阶段：${STATUS_LABELS[service.status]}（${service.status}）`"
      :type="bannerType"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
    />

    <div class="log-pane">
      <div v-if="!entries.length" class="empty">暂无日志（清理后或服务尚未启动）</div>
      <div
        v-for="(e, i) in entries"
        :key="i"
        class="log-line"
        :class="lineClass(e)"
      >
        <span class="ts">{{ formatTs(e.ts) }}</span>
        <el-tag size="small" :type="phaseTagType(e.phase)" class="phase-badge">
          {{ STATUS_LABELS[e.phase] || e.phase || '-' }}
        </el-tag>
        <span class="stream">[{{ e.stream }}]</span>
        <span class="msg">{{ e.msg }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Refresh, Loading } from '@element-plus/icons-vue'
import { useServiceStore, STATUS_LABELS, STATUS_TAG_TYPE } from '../stores/services.js'

const route = useRoute()
const store = useServiceStore()
const serviceId = route.params.id

const entries = ref([])
const phaseFilter = ref(null)
const autoRefresh = ref(true)
let timer = null

const service = computed(() => store.services.find(s => s.id === serviceId))
const bannerType = computed(() => {
  const s = service.value?.status
  if (s === 'ready') return 'success'
  if (s === 'failed') return 'error'
  if (s === 'preparing' || s === 'stopping') return 'warning'
  return 'info'
})

function phaseTagType(phase) {
  return STATUS_TAG_TYPE[phase] || 'info'
}

function lineClass(e) {
  if (e.stream === 'lifecycle') return 'lifecycle'
  if (e.stream === 'stderr') return 'stderr'
  return ''
}

function formatTs(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

async function loadLogs() {
  await store.fetchServices()
  entries.value = await store.fetchLogs(serviceId, {
    phase: phaseFilter.value || undefined,
  })
}

function togglePoll(on) {
  if (on) {
    loadLogs()
    timer = setInterval(loadLogs, 2000)
  } else if (timer) {
    clearInterval(timer)
    timer = null
  }
}

onMounted(() => {
  loadLogs()
  timer = setInterval(loadLogs, 2000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  store.stopPolling()
})
</script>

<style scoped>
.logs-page {
  padding: 20px;
}
.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}
.logs-title {
  display: flex;
  align-items: center;
  gap: 12px;
}
.logs-title h2 {
  font-size: 20px;
  color: #303133;
}
.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.logs-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.log-pane {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 16px;
  height: calc(100vh - 220px);
  overflow-y: auto;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 13px;
}
.empty {
  color: #888;
  text-align: center;
  padding: 40px;
}
.log-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0;
  color: #d4d4d4;
}
.log-line .ts {
  color: #858585;
  white-space: nowrap;
}
.phase-badge {
  transform: scale(0.85);
  transform-origin: left center;
}
.log-line .stream {
  color: #6a9955;
  white-space: nowrap;
}
.log-line.stderr .msg {
  color: #f48771;
}
.log-line.lifecycle .msg {
  color: #4fc1ff;
  font-weight: 600;
}
.msg {
  word-break: break-all;
}
</style>
