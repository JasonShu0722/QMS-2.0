<template>
  <div class="register-container">
    <header class="register-topbar">
      <div class="brand-block">
        <span class="brand-mark">QMS</span>
        <span class="brand-caption">Quality Management System</span>
      </div>
    </header>

    <main class="register-stage">
      <section class="register-hero">
        <div class="hero-copy">
          <p class="hero-kicker">Quality Management System</p>
          <h1>
            统一账号申请入口
          </h1>
          <p class="hero-subtitle">
            内部员工可在此提交账号申请。
          </p>
        </div>
      </section>

      <section class="register-panel">
        <div class="register-panel-shell">
          <div class="register-panel-head">
            <div>
              <h2>用户注册</h2>
              <p>仅开放内部员工申请</p>
            </div>
            <span class="panel-badge">内部员工</span>
          </div>

          <el-form
            ref="registerFormRef"
            :model="registerForm"
            :rules="registerRules"
            label-position="top"
            class="register-form"
            @keyup.enter="handleRegister"
          >
            <div class="register-form-grid">
              <el-form-item label="用户名" prop="username">
                <el-input
                  v-model="registerForm.username"
                  placeholder="3-50 个字符，仅支持字母、数字和下划线"
                  clearable
                />
              </el-form-item>

              <el-form-item label="姓名" prop="full_name">
                <el-input
                  v-model="registerForm.full_name"
                  placeholder="请输入真实姓名"
                  clearable
                />
              </el-form-item>

              <el-form-item label="密码" prop="password">
                <el-input
                  v-model="registerForm.password"
                  type="password"
                  placeholder="至少 8 位，满足三类字符组合"
                  show-password
                  clearable
                />
              </el-form-item>

              <el-form-item label="确认密码" prop="confirmPassword">
                <el-input
                  v-model="registerForm.confirmPassword"
                  type="password"
                  placeholder="请再次输入密码"
                  show-password
                  clearable
                />
              </el-form-item>

              <el-form-item label="邮箱" prop="email">
                <el-input
                  v-model="registerForm.email"
                  placeholder="请输入企业邮箱"
                  clearable
                />
              </el-form-item>

              <el-form-item label="电话" prop="phone">
                <el-input
                  v-model="registerForm.phone"
                  placeholder="请输入联系电话"
                  clearable
                />
              </el-form-item>

              <el-form-item label="部门" prop="department">
                <el-select
                  v-model="registerForm.department"
                  placeholder="请选择部门"
                  clearable
                >
                  <el-option label="质量管理部" value="质量管理部" />
                  <el-option label="制造管理部" value="制造管理部" />
                  <el-option label="研发中心" value="研发中心" />
                  <el-option label="采购部" value="采购部" />
                  <el-option label="信息技术部" value="信息技术部" />
                  <el-option label="经营管理部" value="经营管理部" />
                </el-select>
              </el-form-item>

              <el-form-item label="岗位" prop="position">
                <el-input
                  v-model="registerForm.position"
                  placeholder="请输入岗位"
                  clearable
                />
              </el-form-item>
            </div>

            <div class="register-actions">
              <el-button
                type="primary"
                size="large"
                :loading="loading"
                class="submit-button"
                @click="handleRegister"
              >
                提交申请
              </el-button>

              <el-button
                size="large"
                class="cancel-button"
                @click="router.push('/login')"
              >
                返回登录
              </el-button>
            </div>
          </el-form>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'

import { authApi } from '@/api/auth'

const router = useRouter()
const registerFormRef = ref<FormInstance>()
const loading = ref(false)

const INTERNAL_EMAIL_DOMAIN = 'ics-energy.com'
const GENERIC_VALIDATION_ERROR = '注册信息校验未通过，请检查后重试'

const registerForm = reactive({
  username: '',
  password: '',
  confirmPassword: '',
  full_name: '',
  email: '',
  phone: '',
  department: '',
  position: '',
})

const validatePassword = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (!value) {
    callback(new Error('请输入密码'))
    return
  }

  if (value.length < 8) {
    callback(new Error('密码长度至少 8 位'))
    return
  }

  let complexity = 0
  if (/[a-z]/.test(value)) complexity += 1
  if (/[A-Z]/.test(value)) complexity += 1
  if (/[0-9]/.test(value)) complexity += 1
  if (/[^a-zA-Z0-9]/.test(value)) complexity += 1

  if (complexity < 3) {
    callback(new Error('密码需满足至少三类字符组合'))
    return
  }

  callback()
}

const validateConfirmPassword = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (!value) {
    callback(new Error('请再次输入密码'))
    return
  }

  if (value !== registerForm.password) {
    callback(new Error('两次输入的密码不一致'))
    return
  }

  callback()
}

const registerRules = computed<FormRules>(() => ({
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 50, message: '用户名长度为 3 到 50 个字符', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]+$/, message: '仅支持字母、数字和下划线', trigger: 'blur' },
  ],
  password: [{ required: true, validator: validatePassword, trigger: 'blur' }],
  confirmPassword: [{ required: true, validator: validateConfirmPassword, trigger: 'blur' }],
  full_name: [
    { required: true, message: '请输入姓名', trigger: 'blur' },
    { min: 2, max: 100, message: '姓名长度为 2 到 100 个字符', trigger: 'blur' },
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' },
  ],
  phone: [{ pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号', trigger: 'blur' }],
  department: [{ required: true, message: '请选择部门', trigger: 'change' }],
}))

function matchesInternalEmailPolicy(email: string) {
  return email.trim().toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`)
}

function validateFallback() {
  if (!registerForm.username.trim()) {
    ElMessage.error('请输入用户名')
    return false
  }

  if (!registerForm.full_name.trim()) {
    ElMessage.error('请输入姓名')
    return false
  }

  if (!registerForm.password) {
    ElMessage.error('请输入密码')
    return false
  }

  if (registerForm.password !== registerForm.confirmPassword) {
    ElMessage.error('两次输入的密码不一致')
    return false
  }

  if (!registerForm.email.trim()) {
    ElMessage.error('请输入邮箱')
    return false
  }

  if (!matchesInternalEmailPolicy(registerForm.email)) {
    ElMessage.error(GENERIC_VALIDATION_ERROR)
    return false
  }

  if (!registerForm.department) {
    ElMessage.error('请选择部门')
    return false
  }

  return true
}

async function handleRegister() {
  if (!validateFallback()) {
    return
  }

  if (!registerFormRef.value) {
    return
  }

  const valid = await registerFormRef.value.validate().catch(() => false)
  if (!valid) {
    return
  }

  loading.value = true

  try {
    const response = await authApi.register({
      username: registerForm.username.trim(),
      password: registerForm.password,
      full_name: registerForm.full_name.trim(),
      email: registerForm.email.trim(),
      phone: registerForm.phone.trim() || undefined,
      user_type: 'internal',
      department: registerForm.department.trim(),
      position: registerForm.position.trim() || undefined,
    })

    ElMessage.success(response.message || '注册成功，请等待管理员审核')
    await router.push('/login')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '注册失败，请检查输入信息')
  } finally {
    loading.value = false
  }
}

defineExpose({
  registerForm,
  loading,
  handleRegister,
})
</script>

<style scoped>
.register-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(circle at 12% 18%, rgba(255, 255, 255, 0.18), transparent 22%),
    radial-gradient(circle at 84% 16%, rgba(255, 255, 255, 0.12), transparent 24%),
    linear-gradient(135deg, #0a73d1 0%, #1492ec 42%, #25abff 100%);
  overflow: hidden;
}

.register-topbar {
  position: relative;
  z-index: 3;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  min-height: 64px;
  padding: 0 clamp(28px, 4vw, 56px);
  background: linear-gradient(90deg, rgba(3, 70, 122, 0.84), rgba(11, 111, 188, 0.38));
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(14px);
}

.brand-block {
  display: flex;
  align-items: baseline;
  gap: 16px;
  color: #f8fbff;
}

.brand-mark {
  font-size: clamp(28px, 2.2vw, 40px);
  font-weight: 800;
  letter-spacing: 0.14em;
}

.brand-caption {
  font-size: 13px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  opacity: 0.72;
}

.register-stage {
  position: relative;
  flex: 1;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(400px, 520px);
  align-items: center;
  gap: clamp(28px, 4vw, 52px);
  height: calc(100vh - 64px);
  padding: clamp(18px, 2.6vw, 30px) clamp(24px, 3.4vw, 52px) clamp(16px, 2.2vw, 22px);
}

.register-stage::before,
.register-stage::after,
.register-hero::before,
.register-hero::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.register-stage::before {
  right: 10%;
  top: 8%;
  width: 420px;
  height: 420px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.16), transparent 64%);
}

.register-stage::after {
  inset: auto auto -10% -5%;
  width: min(50vw, 760px);
  aspect-ratio: 1 / 1;
  background: repeating-linear-gradient(
    120deg,
    rgba(255, 255, 255, 0.08) 0 14px,
    rgba(255, 255, 255, 0) 14px 34px
  );
  clip-path: polygon(20% 100%, 42% 18%, 56% 18%, 88% 100%, 68% 100%, 59% 72%, 34% 72%, 27% 100%);
  opacity: 0.72;
}

.register-hero {
  position: relative;
  min-height: 0;
  display: flex;
  align-items: center;
}

.register-hero::before {
  left: 0;
  bottom: -26%;
  width: min(44vw, 640px);
  height: min(44vw, 640px);
  background: radial-gradient(circle, rgba(255, 255, 255, 0.09), transparent 66%);
}

.register-hero::after {
  right: 6%;
  bottom: 4%;
  width: 180px;
  height: 180px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.18);
  opacity: 0.44;
}

.hero-copy {
  position: relative;
  z-index: 1;
  max-width: 620px;
  color: #ffffff;
}

.hero-kicker {
  margin: 0 0 18px;
  font-size: 15px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  opacity: 0.82;
}

.hero-copy h1 {
  margin: 0;
  font-size: clamp(34px, 4vw, 56px);
  line-height: 1.08;
  font-weight: 700;
}

.hero-subtitle {
  margin: 18px 0 0;
  font-size: clamp(17px, 1.55vw, 21px);
  line-height: 1.55;
  max-width: 440px;
  opacity: 0.88;
}

.register-panel {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: flex-end;
}

.register-panel-shell {
  width: 100%;
  max-width: 520px;
  max-height: calc(100vh - 112px);
  padding: 22px 24px 24px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(245, 250, 255, 0.93));
  box-shadow: 0 34px 72px rgba(6, 34, 73, 0.18);
  backdrop-filter: blur(16px);
  overflow: auto;
  scrollbar-gutter: stable;
}

.register-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.register-panel-head h2 {
  margin: 0;
  color: #0f2748;
  font-size: 26px;
  line-height: 1.15;
  font-weight: 700;
}

.register-panel-head p {
  margin: 8px 0 0;
  color: rgba(34, 59, 92, 0.72);
  font-size: 14px;
  line-height: 1.5;
}

.panel-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 84px;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgba(19, 119, 214, 0.12);
  color: #1377d6;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.register-form {
  display: flex;
  flex-direction: column;
}

.register-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 12px;
}

.register-form :deep(.el-form-item) {
  margin-bottom: 8px;
}

.register-form :deep(.el-form-item__label) {
  padding-bottom: 6px;
  color: rgba(34, 59, 92, 0.74);
  font-weight: 600;
}

.register-form :deep(.el-input__wrapper),
.register-form :deep(.el-select__wrapper) {
  min-height: 44px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 0 0 1px rgba(15, 39, 72, 0.12) inset;
}

.register-form :deep(.el-input__wrapper.is-focus),
.register-form :deep(.el-select__wrapper.is-focused) {
  box-shadow:
    0 0 0 1px rgba(47, 142, 239, 0.34) inset,
    0 0 0 4px rgba(47, 142, 239, 0.1);
}

.register-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.submit-button,
.cancel-button {
  min-height: 46px;
  margin: 0;
  padding: 0 16px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  box-sizing: border-box;
}

.submit-button {
  border: none;
  background: linear-gradient(135deg, #2d8cf0, #4ba6ff);
  box-shadow: 0 18px 30px rgba(35, 131, 228, 0.24);
}

.cancel-button,
.cancel-button:hover {
  background: rgba(227, 238, 249, 0.96);
  color: #526f8d;
  border-color: rgba(21, 76, 136, 0.12);
}

.register-form :deep(.el-button + .el-button) {
  margin-left: 0;
}

@media (max-width: 1180px) {
  .register-stage {
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    gap: 24px;
    height: auto;
    min-height: calc(100vh - 64px);
    padding-top: 18px;
    padding-bottom: 22px;
  }

  .register-hero {
    width: 100%;
    justify-content: center;
    text-align: center;
  }

  .register-panel {
    width: 100%;
    justify-content: center;
  }

  .register-stage::after {
    left: 50%;
    bottom: 34%;
    width: min(70vw, 620px);
    transform: translateX(-50%);
    opacity: 0.36;
  }
}

@media (max-width: 900px) {
  .register-topbar {
    min-height: 60px;
    padding: 0 20px;
  }

  .brand-block {
    gap: 10px;
  }

  .brand-mark {
    font-size: 30px;
    letter-spacing: 0.1em;
  }

  .brand-caption {
    display: none;
  }

  .register-stage {
    min-height: calc(100vh - 60px);
    padding: 16px 20px 22px;
  }

  .hero-kicker {
    margin-bottom: 14px;
    font-size: 13px;
    letter-spacing: 0.16em;
  }

  .hero-copy h1 {
    font-size: clamp(30px, 8vw, 42px);
  }

  .hero-subtitle {
    margin-top: 14px;
    font-size: 17px;
  }

  .register-panel-shell {
    max-height: none;
    padding: 20px 18px 18px;
    border-radius: 24px;
  }

  .register-form-grid,
  .register-actions {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .register-stage::after,
  .register-hero::after {
    display: none;
  }

  .hero-copy {
    max-width: 100%;
  }

  .hero-subtitle {
    font-size: 16px;
  }

  .register-panel-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
