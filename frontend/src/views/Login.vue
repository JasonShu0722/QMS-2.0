<template>
  <div class="login-container">
    <header class="login-topbar">
      <div class="brand-block">
        <span class="brand-mark">QMS</span>
        <span class="brand-caption">Quality Management System</span>
      </div>

      <div class="entry-note" aria-hidden="true">
        <span class="entry-note__line"></span>
        <span>质量管理平台</span>
      </div>
    </header>

    <main :class="['login-stage', { 'login-stage--compact': isMobile }]">
      <section class="hero-panel">
        <div class="hero-copy">
          <p class="hero-kicker">Quality Management System</p>
          <h1>
            让质量更透明<br>
            让协同更高效
          </h1>
          <p class="hero-subtitle">
            Make quality visible across teams and keep collaboration moving.
          </p>
        </div>
      </section>

      <section class="login-panel">
        <div class="login-panel-shell">
          <div class="login-panel-head">
            <p>QMS Access</p>
            <h1>账号登录</h1>
          </div>

          <el-radio-group v-model="userType" class="user-type-selector" size="large">
            <el-radio-button value="internal">内部员工</el-radio-button>
            <el-radio-button value="supplier">供应商</el-radio-button>
          </el-radio-group>

          <el-form
            ref="loginFormRef"
            :model="loginForm"
            :rules="loginRules"
            class="login-form"
            @keyup.enter="handleLogin"
          >
            <el-form-item prop="username">
              <el-input
                v-model="loginForm.username"
                :prefix-icon="User"
                placeholder="用户名"
                size="large"
                clearable
              />
            </el-form-item>

            <el-form-item prop="password">
              <el-input
                v-model="loginForm.password"
                :prefix-icon="Lock"
                type="password"
                placeholder="密码"
                size="large"
                show-password
                clearable
              />
            </el-form-item>

            <el-form-item v-if="userType === 'supplier'" prop="captcha">
              <div class="captcha-row">
                <el-input
                  v-model="loginForm.captcha"
                  :prefix-icon="PictureFilled"
                  placeholder="验证码"
                  size="large"
                  clearable
                />

                <img
                  v-if="captchaImage"
                  :src="captchaImage"
                  alt="验证码"
                  class="captcha-image"
                  title="点击刷新验证码"
                  @click="refreshCaptcha"
                />
                <el-button
                  v-else
                  class="captcha-trigger"
                  type="primary"
                  plain
                  size="large"
                  @click="refreshCaptcha"
                >
                  获取验证码
                </el-button>
              </div>
            </el-form-item>

            <div class="form-meta">
              <el-checkbox v-model="rememberPassword">记住密码</el-checkbox>
              <router-link v-if="userType === 'internal'" to="/register" class="register-link">
                立即注册
              </router-link>
            </div>

            <el-button
              type="primary"
              size="large"
              :loading="loading"
              class="login-button"
              @click="handleLogin"
            >
              登录
            </el-button>

            <el-button
              v-if="userType === 'internal'"
              size="large"
              disabled
              class="sso-button"
            >
              <el-icon><Connection /></el-icon>
              SSO 单点登录
            </el-button>
          </el-form>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { Connection, Lock, PictureFilled, User } from '@element-plus/icons-vue'
import { authApi } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import { clearRememberedLogin, loadRememberedLogin, persistRememberedLogin } from '@/utils/loginRemembering'

const MOBILE_BREAKPOINT = 900

const router = useRouter()
const authStore = useAuthStore()
const loginFormRef = ref<FormInstance>()

const isMobile = ref(window.innerWidth < MOBILE_BREAKPOINT)
const userType = ref<'internal' | 'supplier'>('internal')
const rememberPassword = ref(false)
const loading = ref(false)
const captchaImage = ref('')
const captchaId = ref('')

const loginForm = reactive({
  username: '',
  password: '',
  captcha: ''
})

const loginRules = computed<FormRules>(() => ({
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 50, message: '用户名长度为 3 到 50 个字符', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, message: '密码长度至少为 8 个字符', trigger: 'blur' }
  ],
  captcha: userType.value === 'supplier'
    ? [{ required: true, message: '请输入验证码', trigger: 'blur' }]
    : []
}))

const handleResize = () => {
  isMobile.value = window.innerWidth < MOBILE_BREAKPOINT
}

const refreshCaptcha = async () => {
  try {
    const response = await authApi.getCaptcha()
    captchaImage.value = response.captcha_image
    captchaId.value = response.captcha_id
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '获取验证码失败')
  }
}

const validateFallback = () => {
  if (!loginForm.username || !loginForm.password) {
    ElMessage.error('请填写用户名和密码')
    return false
  }

  if (userType.value === 'supplier' && !loginForm.captcha) {
    ElMessage.error('请输入验证码')
    return false
  }

  return true
}

const handleLogin = async () => {
  const passedFallback = validateFallback()
  if (!passedFallback) {
    return
  }

  const formValid = typeof loginFormRef.value?.validate === 'function'
    ? await loginFormRef.value.validate().catch(() => false)
    : true

  if (!formValid) {
    return
  }

  loading.value = true

  try {
    await authStore.login(
      loginForm.username,
      loginForm.password,
      userType.value,
      userType.value === 'supplier' ? loginForm.captcha : undefined,
      userType.value === 'supplier' ? captchaId.value : undefined
    )

    if (rememberPassword.value) {
      persistRememberedLogin(localStorage, {
        username: loginForm.username,
        password: loginForm.password,
        userType: userType.value
      })
    } else {
      clearRememberedLogin(localStorage)
    }

    ElMessage.success('登录成功')
    if (authStore.passwordExpired) {
      ElMessage.warning('当前账号密码已过期，请登录后尽快修改密码')
    }
    router.push('/workbench')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '登录失败，请检查用户名和密码')

    if (userType.value === 'supplier') {
      await refreshCaptcha()
      loginForm.captcha = ''
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  window.addEventListener('resize', handleResize)

  const rememberedLogin = loadRememberedLogin(localStorage)

  if (rememberedLogin) {
    loginForm.username = rememberedLogin.username
    loginForm.password = rememberedLogin.password
    rememberPassword.value = true
    userType.value = rememberedLogin.userType
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
})

watch(userType, async (newType) => {
  loginForm.captcha = ''

  if (newType === 'supplier' && !captchaImage.value) {
    await refreshCaptcha()
  }
})

defineExpose({
  loginForm,
  userType,
  rememberPassword,
  captchaId,
  loading,
  isMobile,
  refreshCaptcha,
  handleLogin
})
</script>

<style scoped>
.login-container {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(circle at 12% 18%, rgba(255, 255, 255, 0.18), transparent 22%),
    radial-gradient(circle at 84% 16%, rgba(255, 255, 255, 0.12), transparent 24%),
    linear-gradient(135deg, #0a73d1 0%, #1492ec 42%, #25abff 100%);
  color: #102333;
  overflow: hidden;
}

.login-topbar {
  position: relative;
  z-index: 3;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 64px;
  padding: 0 48px;
  background: linear-gradient(90deg, rgba(3, 70, 122, 0.84), rgba(11, 111, 188, 0.38));
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(14px);
}

.brand-block {
  display: flex;
  align-items: baseline;
  gap: 14px;
  color: #f7fbfc;
}

.brand-mark {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: 0;
}

.brand-caption {
  font-size: 13px;
  opacity: 0.72;
  letter-spacing: 0;
}

.entry-note {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: rgba(247, 251, 252, 0.78);
  font-size: 14px;
  letter-spacing: 0;
}

.entry-note__line {
  width: 42px;
  height: 1px;
  background: #d9a441;
}

.login-stage {
  position: relative;
  flex: 1;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
  align-items: center;
  gap: 48px;
  min-height: 0;
  height: calc(100vh - 64px);
  padding: 32px 52px;
}

.login-stage::before,
.login-stage::after,
.hero-panel::before,
.hero-panel::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.login-stage::before {
  right: 10%;
  top: 8%;
  width: 420px;
  height: 420px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.16), transparent 64%);
}

.login-stage::after {
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

.hero-panel {
  position: relative;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.hero-panel::before {
  left: 0;
  bottom: -26%;
  width: min(44vw, 640px);
  height: min(44vw, 640px);
  background: radial-gradient(circle, rgba(255, 255, 255, 0.09), transparent 66%);
}

.hero-panel::after {
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
  letter-spacing: 0;
}

.hero-subtitle {
  margin: 18px 0 0;
  font-size: clamp(17px, 1.55vw, 21px);
  line-height: 1.55;
  max-width: 440px;
  opacity: 0.88;
}

.login-panel {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: flex-end;
}

.login-panel-shell {
  --panel-title: #0f2748;
  --panel-muted: rgba(34, 59, 92, 0.74);
  --panel-field-bg: rgba(255, 255, 255, 0.98);
  --panel-field-border: rgba(15, 39, 72, 0.12);
  --panel-field-text: #223b5c;
  --panel-field-placeholder: rgba(34, 59, 92, 0.58);
  --panel-icon: rgba(34, 59, 92, 0.58);
  --panel-segment-bg: rgba(232, 239, 241, 0.96);
  --panel-segment-text: #4a6787;
  --panel-segment-border: rgba(45, 84, 105, 0.14);
  --panel-primary-start: #137c78;
  --panel-primary-end: #1d928d;
  --panel-primary-shadow: rgba(19, 124, 120, 0.22);
  --panel-primary-contrast: #ffffff;
  --panel-secondary-bg: rgba(232, 239, 241, 0.96);
  --panel-secondary-text: #526f8d;
  --panel-secondary-border: rgba(45, 84, 105, 0.14);
  --panel-focus-border: rgba(19, 124, 120, 0.34);
  --panel-focus-ring: rgba(19, 124, 120, 0.1);
  --panel-trigger-border: rgba(19, 124, 120, 0.28);
  --panel-checkbox-border: rgba(19, 124, 120, 0.34);
  width: 100%;
  max-width: 420px;
  padding: 28px;
  border: 1px solid rgba(11, 42, 62, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 28px 60px rgba(13, 40, 57, 0.18);
  backdrop-filter: blur(14px);
}

.login-panel-head {
  margin-bottom: 22px;
}

.login-panel-head p {
  margin: 0 0 8px;
  color: #7a8b95;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
}

.login-panel-head h1 {
  margin: 0;
  color: var(--panel-title);
  font-size: 28px;
  line-height: 1.15;
  font-weight: 800;
  letter-spacing: 0;
}

.user-type-selector {
  width: 100%;
  display: flex;
  margin-bottom: 20px;
}

.user-type-selector :deep(.el-radio-button) {
  flex: 1;
}

.user-type-selector :deep(.el-radio-button__inner) {
  width: 100%;
  height: 44px;
  border-radius: 8px;
  border: 1px solid var(--panel-segment-border);
  background: var(--panel-segment-bg);
  color: var(--panel-segment-text);
  font-weight: 600;
  transition: all 0.24s ease;
}

.user-type-selector :deep(.el-radio-button:first-child .el-radio-button__inner) {
  border-radius: 8px;
}

.user-type-selector :deep(.el-radio-button:last-child .el-radio-button__inner) {
  border-radius: 8px;
}

.user-type-selector :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background: linear-gradient(135deg, var(--panel-primary-start), var(--panel-primary-end));
  border-color: transparent;
  color: var(--panel-primary-contrast);
  box-shadow: 0 14px 28px var(--panel-primary-shadow);
}

.login-form {
  display: flex;
  flex-direction: column;
}

.login-form :deep(.el-form-item) {
  margin-bottom: 16px;
}

.login-form :deep(.el-input__wrapper) {
  min-height: 46px;
  border-radius: 8px;
  background: var(--panel-field-bg);
  box-shadow: 0 0 0 1px var(--panel-field-border) inset;
}

.login-form :deep(.el-input__wrapper.is-focus) {
  box-shadow:
    0 0 0 1px var(--panel-focus-border) inset,
    0 0 0 4px var(--panel-focus-ring);
}

.login-form :deep(.el-input__inner) {
  color: var(--panel-field-text);
}

.login-form :deep(.el-input__inner::placeholder) {
  color: var(--panel-field-placeholder);
}

.login-form :deep(.el-input__prefix-inner),
.login-form :deep(.el-input__suffix-inner),
.login-form :deep(.el-input__prefix-inner .el-icon),
.login-form :deep(.el-input__suffix-inner .el-icon) {
  color: var(--panel-icon);
}

.captcha-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 128px;
  gap: 12px;
  width: 100%;
}

.captcha-image,
.captcha-trigger {
  width: 128px;
  height: 46px;
  border-radius: 8px;
}

.captcha-image {
  object-fit: cover;
  cursor: pointer;
  border: 1px solid var(--panel-field-border);
  background: var(--panel-field-bg);
}

.captcha-trigger {
  border-color: var(--panel-trigger-border);
}

.form-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 18px;
}

.form-meta :deep(.el-checkbox__label) {
  color: var(--panel-muted);
  font-weight: 500;
}

.form-meta :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
  background-color: var(--panel-primary-start);
  border-color: var(--panel-primary-start);
}

.form-meta :deep(.el-checkbox__inner) {
  border-color: var(--panel-checkbox-border);
  background: rgba(255, 255, 255, 0.9);
}

.register-link {
  color: var(--panel-primary-start);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.register-link:hover {
  opacity: 0.88;
}

.login-button,
.sso-button {
  width: 100%;
  min-height: 46px;
  margin: 0;
  padding: 0 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  box-sizing: border-box;
}

.login-button {
  margin-bottom: 12px;
  border: none;
  background: linear-gradient(135deg, var(--panel-primary-start), var(--panel-primary-end));
  box-shadow: 0 18px 30px var(--panel-primary-shadow);
}

.login-button:hover {
  opacity: 0.96;
}

.sso-button {
  background: var(--panel-secondary-bg);
  color: var(--panel-secondary-text);
  border-color: var(--panel-secondary-border);
}

.sso-button.is-disabled,
.sso-button.is-disabled:hover,
.sso-button[disabled] {
  background: var(--panel-secondary-bg);
  color: var(--panel-secondary-text);
  border-color: var(--panel-secondary-border);
  opacity: 1;
}

.sso-button :deep(.el-icon) {
  margin-right: 6px;
}

.login-form :deep(.el-button + .el-button) {
  margin-left: 0;
}

@media (max-width: 1100px) {
  .login-stage {
    grid-template-columns: minmax(0, 1fr);
    gap: 22px;
    justify-items: center;
    height: auto;
    min-height: calc(100vh - 64px);
    padding: 22px 32px 28px;
  }

  .hero-panel {
    min-height: auto;
    width: 100%;
    justify-content: center;
    text-align: center;
  }

  .login-panel {
    width: 100%;
    justify-content: center;
  }

  .login-stage::after {
    left: 50%;
    bottom: 34%;
    width: min(70vw, 620px);
    transform: translateX(-50%);
    opacity: 0.36;
  }
}

@media (max-width: 900px) {
  .login-topbar {
    min-height: 60px;
    padding: 0 20px;
  }

  .login-stage {
    min-height: calc(100vh - 60px);
    padding: 16px 20px 22px;
  }

  .login-stage--compact .hero-panel {
    padding-top: 6px;
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

  .login-panel-shell {
    padding: 20px 18px 18px;
    border-radius: 8px;
  }

  .login-panel-head {
    margin-bottom: 18px;
  }
}

@media (max-width: 640px) {
  .brand-caption,
  .entry-note {
    display: none;
  }

  .hero-panel {
    display: none;
  }

  .login-stage::after,
  .hero-panel::after {
    display: none;
  }

  .login-panel-shell {
    max-width: none;
  }

  .captcha-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .captcha-image,
  .captcha-trigger {
    width: 100%;
  }

  .form-meta {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
