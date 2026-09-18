import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 响应式断点检测 Composable
 * 提供移动端、平板、桌面端的判断
 */
export function useResponsive() {
  const isMobile = ref(false)
  const isTablet = ref(false)
  const isDesktop = ref(false)
  const screenWidth = ref(0)

  const checkScreenSize = () => {
    screenWidth.value = window.innerWidth
    
    // 根据 Tailwind 断点配置
    isMobile.value = screenWidth.value < 768  // < md
    isTablet.value = screenWidth.value >= 768 && screenWidth.value < 1024  // md to lg
    isDesktop.value = screenWidth.value >= 1024  // >= lg
  }

  onMounted(() => {
    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', checkScreenSize)
  })

  return {
    isMobile,
    isTablet,
    isDesktop,
    screenWidth
  }
}
