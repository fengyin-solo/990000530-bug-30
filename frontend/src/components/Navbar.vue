<template>
  <nav class="navbar">
    <div class="navbar-content">
      <div class="navbar-brand" @click="$router.push('/')">
        <el-icon :size="24" color="#fff"><List /></el-icon>
        <span>Task Board</span>
      </div>
      <div class="navbar-right">
        <router-link to="/services" class="nav-link">
          <el-icon><Monitor /></el-icon>
          服务看板
        </router-link>
        <el-text style="color: #fff; margin-right: 16px;">
          <el-icon><User /></el-icon>
          {{ authStore.user?.username }}
        </el-text>
        <el-button type="danger" text @click="handleLogout">
          <el-icon><SwitchButton /></el-icon>
          Logout
        </el-button>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { List, User, SwitchButton, Monitor } from '@element-plus/icons-vue'

const router = useRouter()
const authStore = useAuthStore()

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<style scoped>
.navbar {
  background: linear-gradient(135deg, #409eff, #6366f1);
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.navbar-content {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.navbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  color: white;
  font-size: 20px;
  font-weight: 600;
}

.navbar-right {
  display: flex;
  align-items: center;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #fff;
  text-decoration: none;
  margin-right: 20px;
  font-size: 14px;
  opacity: 0.9;
}

.nav-link:hover {
  opacity: 1;
  text-decoration: underline;
}
</style>
