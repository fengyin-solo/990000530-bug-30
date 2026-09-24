<template>
  <div class="services-page">
    <div class="services-header">
      <div>
        <h2>服务看板</h2>
        <p class="subtitle">统一状态生命周期：准备中 → 就绪 / 失败 → 停止</p>
      </div>
      <div class="header-actions">
        <el-button @click="store.fetchServices" :loading="store.loading" :icon="Refresh">刷新</el-button>
        <el-button type="warning" :icon="VideoPause" @click="handleStopAll">全部停止</el-button>
      </div>
    </div>

    <el-alert
      v-if="store.lastError"
      :title="store.lastError"
      type="error"
      show-icon
      :closable="false"
      style="margin-bottom: 16px"
    />

    <el-table :data="store.services" v-loading="store.loading" row-key="id" class="services-table">
      <el-table-column label="服务" min-width="160">
        <template #default="{ row }">
          <div class="svc-name">{{ row.name }}</div>
          <div class="svc-id">{{ row.id }}</div>
        </template>
      </el-table-column>

      <el-table-column label="状态" width="220">
        <template #default="{ row }">
          <!-- One badge driven by canonical status; phase label mirrors it -->
          <el-tag :type="STATUS_TAG_TYPE[row.status]" effect="dark" class="status-tag">
            <el-icon v-if="row.status === 'preparing' || row.status === 'stopping'" class="is-loading">
              <Loading />
            </el-icon>
            {{ STATUS_LABELS[row.status] || row.status }}
          </el-tag>
          <span class="phase-note">phase: {{ row.phase }} · ready: {{ row.ready ? '是' : '否' }}</span>
        </template>
      </el-table-column>

      <el-table-column label="运行信息" min-width="200">
        <template #default="{ row }">
          <div class="meta">
            <span>pid: {{ row.pid ?? '-' }}</span>
            <span>端口: {{ row.port ?? '-' }}</span>
          </div>
          <div v-if="row.error" class="svc-error" :title="row.error">{{ row.error }}</div>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="320" fixed="right">
        <template #default="{ row }">
          <el-button-group>
            <el-button
              size="small" type="primary"
              :disabled="!canStart(row) || store.busy[row.id]"
              :loading="store.busy[row.id] && row.status === 'preparing'"
              @click="store.start(row.id)"
            >启动</el-button>
            <el-button
              size="small" type="warning"
              :disabled="!canStop(row) || store.busy[row.id]"
              @click="store.stop(row.id)"
            >停止</el-button>
            <el-button
              size="small"
              :disabled="!canRestart(row) || store.busy[row.id]"
              @click="store.restart(row.id)"
            >重启</el-button>
            <el-button size="small" @click="goLogs(row)">日志</el-button>
            <el-button
              size="small" type="danger" plain
              :disabled="store.busy[row.id]"
              @click="handleCleanup(row)"
            >清理</el-button>
          </el-button-group>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, VideoPause, Loading } from '@element-plus/icons-vue'
import { useServiceStore, STATUS, STATUS_LABELS, STATUS_TAG_TYPE } from '../stores/services.js'

const router = useRouter()
const store = useServiceStore()

function canStart(row) {
  return row.status === STATUS.STOPPED || row.status === STATUS.FAILED
}
function canStop(row) {
  return row.status === STATUS.READY || row.status === STATUS.PREPARING
}
function canRestart(row) {
  return canStart(row) || canStop(row)
}

function goLogs(row) {
  router.push(`/services/${row.id}/logs`)
}

async function handleCleanup(row) {
  try {
    await ElMessageBox.confirm(
      `将停止服务并清空 "${row.name}" 的日志与旧状态标记，确定继续？`,
      '清理服务',
      { type: 'warning', confirmButtonText: '清理', cancelButtonText: '取消' }
    )
    await store.cleanup(row.id)
    ElMessage.success('清理完成，状态已重置为已停止')
  } catch (_) { /* cancelled */ }
}

async function handleStopAll() {
  try {
    await ElMessageBox.confirm('确定停止全部运行中的服务？', '全部停止', { type: 'warning' })
    await store.stopAll()
    ElMessage.success('已全部停止')
  } catch (_) { /* cancelled */ }
}

onMounted(() => store.startPolling(2000))
onUnmounted(() => store.stopPolling())
</script>

<style scoped>
.services-page {
  padding: 20px;
}
.services-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}
.services-header h2 {
  color: #303133;
}
.subtitle {
  color: #909399;
  font-size: 13px;
  margin-top: 4px;
}
.svc-name {
  font-weight: 600;
  color: #303133;
}
.svc-id {
  font-size: 12px;
  color: #909399;
}
.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.phase-note {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}
.meta {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: #606266;
}
.svc-error {
  margin-top: 4px;
  font-size: 12px;
  color: #f56c6c;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
