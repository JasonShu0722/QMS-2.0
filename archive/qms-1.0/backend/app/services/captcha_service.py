"""
图形验证码服务
Captcha Service - 生成和验证图形验证码
"""
import uuid
import base64
from io import BytesIO
from typing import Optional
from datetime import datetime, timedelta
from PIL import Image, ImageDraw, ImageFont
import random
import string


class CaptchaService:
    """
    图形验证码服务
    
    功能：
    - 生成随机验证码图片
    - 验证用户输入的验证码
    - 验证码有效期管理（5分钟）
    """
    
    def __init__(self):
        # 验证码存储（生产环境应使用 Redis）
        self._captcha_store: dict[str, dict] = {}
        
        # 验证码配置
        self.CAPTCHA_LENGTH = 4
        self.CAPTCHA_EXPIRE_MINUTES = 5
        self.IMAGE_WIDTH = 120
        self.IMAGE_HEIGHT = 40
    
    def generate_captcha(self) -> tuple[str, str]:
        """
        生成验证码
        
        Returns:
            tuple[str, str]: (captcha_id, base64_image)
        """
        # 生成唯一ID
        captcha_id = str(uuid.uuid4())
        
        # 生成随机验证码文本（大写字母和数字，排除易混淆字符）
        chars = string.ascii_uppercase.replace('O', '').replace('I', '') + string.digits.replace('0', '').replace('1', '')
        captcha_text = ''.join(random.choices(chars, k=self.CAPTCHA_LENGTH))
        
        # 生成验证码图片
        image = self._create_captcha_image(captcha_text)
        
        # 转换为 Base64
        buffered = BytesIO()
        image.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()
        base64_image = f"data:image/png;base64,{img_str}"
        
        # 存储验证码（生产环境应使用 Redis）
        self._captcha_store[captcha_id] = {
            "text": captcha_text,
            "created_at": datetime.utcnow(),
            "used": False
        }
        
        return captcha_id, base64_image
    
    def verify_captcha(self, captcha_id: str, user_input: str) -> bool:
        """
        验证验证码
        
        Args:
            captcha_id: 验证码ID
            user_input: 用户输入的验证码
            
        Returns:
            bool: 验证是否通过
        """
        # 检查验证码是否存在
        if captcha_id not in self._captcha_store:
            return False
        
        captcha_data = self._captcha_store[captcha_id]
        
        # 检查是否已使用
        if captcha_data["used"]:
            return False
        
        # 检查是否过期
        expire_time = captcha_data["created_at"] + timedelta(minutes=self.CAPTCHA_EXPIRE_MINUTES)
        if datetime.utcnow() > expire_time:
            # 清理过期验证码
            del self._captcha_store[captcha_id]
            return False
        
        # 验证码比对（不区分大小写）
        is_valid = captcha_data["text"].upper() == user_input.upper()
        
        # 标记为已使用（无论验证成功与否）
        captcha_data["used"] = True
        
        return is_valid
    
    def _create_captcha_image(self, text: str) -> Image.Image:
        """
        创建验证码图片
        
        Args:
            text: 验证码文本
            
        Returns:
            Image: PIL Image 对象
        """
        # 创建图片
        image = Image.new('RGB', (self.IMAGE_WIDTH, self.IMAGE_HEIGHT), color='white')
        draw = ImageDraw.Draw(image)
        
        # 绘制背景干扰线
        for _ in range(3):
            x1 = random.randint(0, self.IMAGE_WIDTH)
            y1 = random.randint(0, self.IMAGE_HEIGHT)
            x2 = random.randint(0, self.IMAGE_WIDTH)
            y2 = random.randint(0, self.IMAGE_HEIGHT)
            draw.line([(x1, y1), (x2, y2)], fill=self._random_color(100, 200), width=1)
        
        # 绘制验证码文本
        try:
            # 尝试使用系统字体
            font = ImageFont.truetype("arial.ttf", 28)
        except:
            # 如果找不到字体，使用默认字体
            font = ImageFont.load_default()
        
        # 计算文本位置
        char_width = self.IMAGE_WIDTH // self.CAPTCHA_LENGTH
        
        for i, char in enumerate(text):
            # 随机位置和颜色
            x = char_width * i + random.randint(5, 10)
            y = random.randint(5, 10)
            color = self._random_color(0, 100)
            
            draw.text((x, y), char, font=font, fill=color)
        
        # 绘制干扰点
        for _ in range(50):
            x = random.randint(0, self.IMAGE_WIDTH)
            y = random.randint(0, self.IMAGE_HEIGHT)
            draw.point((x, y), fill=self._random_color(50, 150))
        
        return image
    
    def _random_color(self, min_val: int = 0, max_val: int = 255) -> tuple[int, int, int]:
        """
        生成随机颜色
        
        Args:
            min_val: 最小值
            max_val: 最大值
            
        Returns:
            tuple[int, int, int]: RGB 颜色值
        """
        return (
            random.randint(min_val, max_val),
            random.randint(min_val, max_val),
            random.randint(min_val, max_val)
        )
    
    def cleanup_expired(self):
        """清理过期的验证码"""
        current_time = datetime.utcnow()
        expired_ids = [
            captcha_id
            for captcha_id, data in self._captcha_store.items()
            if current_time > data["created_at"] + timedelta(minutes=self.CAPTCHA_EXPIRE_MINUTES)
        ]
        
        for captcha_id in expired_ids:
            del self._captcha_store[captcha_id]


# 创建全局验证码服务实例
captcha_service = CaptchaService()
