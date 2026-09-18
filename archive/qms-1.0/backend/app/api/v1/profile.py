"""
个人信息管理 API
Profile API - 用户个人信息查询、密码修改、电子签名上传
"""
from datetime import datetime
from pathlib import Path
from typing import Optional
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import update, select
from PIL import Image

from app.core.dependencies import get_current_active_user
from app.core.database import get_db
from app.core.auth_strategy import LocalAuthStrategy
from app.core.config import settings
from app.core.platform_admin import is_platform_admin
from app.models.user import User, UserType
from app.services.user_session_service import build_user_response
from app.schemas.profile import (
    ProfileUpdateSchema,
    PasswordChangeSchema,
    PasswordChangeResponseSchema,
    SignatureUploadResponseSchema
)
from app.schemas.user import UserResponseSchema


router = APIRouter(prefix="/profile", tags=["个人中心"])


# 初始化认证策略（用于密码验证和哈希）
auth_strategy = LocalAuthStrategy()


@router.get(
    "",
    response_model=UserResponseSchema,
    summary="获取个人信息",
    description="获取当前登录用户的个人信息"
)
async def get_profile(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
) -> UserResponseSchema:
    """
    获取个人信息
    
    返回当前登录用户的详细信息，包括：
    - 基础信息（用户名、姓名、邮箱、电话）
    - 用户类型和状态
    - 部门职位信息（内部员工）
    - 供应商关联信息（供应商用户）
    - 电子签名路径
    - 密码修改时间
    - 最后登录时间
    """
    return await build_user_response(db, current_user)


@router.patch(
    "",
    response_model=UserResponseSchema,
    summary="更新个人信息",
    description="更新当前登录用户可维护的个人资料字段"
)
async def update_profile(
    profile_data: ProfileUpdateSchema,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
) -> UserResponseSchema:
    """
    更新个人资料

    允许用户维护个人展示与联系方式字段，不涉及账号类型、供应商关联、
    环境权限等平台治理字段。
    """
    if not is_platform_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅平台管理员可修改账户信息，请在用户管理中调整"
        )

    raw_payload = profile_data.model_dump(exclude_unset=True)

    if current_user.user_type != UserType.INTERNAL:
        raw_payload.pop("department", None)

    nullable_fields = {"phone", "department", "position"}
    update_payload = {}

    for key, value in raw_payload.items():
        if key in nullable_fields:
            update_payload[key] = value
            continue

        if value is not None:
            update_payload[key] = value

    if not update_payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="至少提供一项需要更新的信息"
        )

    update_payload["updated_at"] = datetime.utcnow()

    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(**update_payload)
    )
    await db.commit()

    refreshed_user = await db.get(User, current_user.id)
    if not refreshed_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户不存在"
        )

    return await build_user_response(db, refreshed_user)


@router.post(
    "/avatar",
    summary="上传头像",
    description="上传用户头像图片（已裁剪）"
)
async def upload_avatar(
    file: UploadFile = File(..., description="头像图片文件（PNG/JPG格式）"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    上传头像

    接收前端裁剪后的头像图片，保存到 uploads/avatars/ 目录。
    """
    # 验证文件类型
    allowed_extensions = [".png", ".jpg", ".jpeg", ".webp"]
    file_extension = Path(file.filename).suffix.lower()
    
    if file_extension not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的文件格式。仅支持：{', '.join(allowed_extensions)}"
        )
    
    # 创建上传目录
    upload_dir = Path(settings.UPLOAD_DIR) / "avatars"
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    # 生成唯一文件名
    unique_filename = f"user_{current_user.id}_avatar_{uuid.uuid4()}.png"
    file_path = upload_dir / unique_filename
    
    try:
        # 读取上传的图片
        contents = await file.read()
        
        # 使用 Pillow 处理（统一转为 PNG）
        from io import BytesIO
        image = Image.open(BytesIO(contents))
        
        if image.mode != 'RGBA':
            image = image.convert('RGBA')
        
        # 限制尺寸为 256x256
        image.thumbnail((256, 256), Image.Resampling.LANCZOS)
        
        # 保存
        image.save(file_path, "PNG")
        
        # 删除旧头像文件
        if current_user.avatar_image_path:
            old_file_path = Path(current_user.avatar_image_path.lstrip('/'))
            if old_file_path.exists():
                old_file_path.unlink()
        
        # 更新数据库
        avatar_path = f"/uploads/avatars/{unique_filename}"
        
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(
                avatar_image_path=avatar_path,
                updated_at=datetime.utcnow()
            )
        )
        await db.commit()
        
        return {"message": "头像上传成功", "avatar_path": avatar_path}
    
    except Exception as e:
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"头像处理失败: {str(e)}"
        )


@router.put(
    "/password",
    response_model=PasswordChangeResponseSchema,
    summary="修改密码",
    description="修改当前用户的登录密码，需要验证旧密码并应用密码策略"
)
async def change_password(
    password_data: PasswordChangeSchema,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
) -> PasswordChangeResponseSchema:
    """
    修改密码
    
    功能特性：
    1. 验证旧密码的正确性
    2. 应用密码策略（复杂度、长度要求）
    3. 更新 password_changed_at 时间戳
    4. 返回成功消息，提示用户重新登录
    
    密码策略：
    - 长度必须大于 8 位
    - 必须包含大写字母、小写字母、数字、特殊字符中的至少三种
    
    注意：
    - 修改密码后，当前 Token 仍然有效（24小时内）
    - 建议前端在收到成功响应后，清除本地 Token 并跳转到登录页
    """
    # 1. 验证旧密码
    if not auth_strategy.verify_password(password_data.old_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="旧密码错误"
        )
    
    # 2. 验证新密码不能与旧密码相同
    if password_data.old_password == password_data.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新密码不能与旧密码相同"
        )
    
    # 3. 密码复杂度验证（Pydantic 已在 Schema 层验证，此处为双重保险）
    is_valid, error_message = auth_strategy.validate_password_complexity(password_data.new_password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_message
        )
    
    # 4. 哈希新密码
    new_password_hash = auth_strategy.hash_password(password_data.new_password)
    
    # 5. 更新数据库
    password_changed_at = datetime.utcnow()
    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(
            password_hash=new_password_hash,
            password_changed_at=password_changed_at,
            updated_at=datetime.utcnow()
        )
    )
    await db.commit()
    
    return PasswordChangeResponseSchema(
        message="密码修改成功，请重新登录",
        password_changed_at=password_changed_at.isoformat()
    )


@router.post(
    "/signature",
    response_model=SignatureUploadResponseSchema,
    summary="上传电子签名",
    description="上传用户的手写签名图片，系统自动处理背景透明化"
)
async def upload_signature(
    file: UploadFile = File(..., description="签名图片文件（PNG/JPG格式）"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
) -> SignatureUploadResponseSchema:
    """
    上传电子签名
    
    功能特性：
    1. 接收图片文件（PNG/JPG格式）
    2. 自动处理图片背景透明化（使用 Pillow）
    3. 存储到文件系统（uploads/signatures/ 目录）
    4. 更新用户的 digital_signature 字段
    
    文件命名规则：
    - 格式：user_{user_id}_signature_{uuid}.png
    - 示例：user_1_signature_550e8400-e29b-41d4-a716-446655440000.png
    
    图片处理：
    - 自动转换为 PNG 格式（支持透明通道）
    - 移除白色背景（阈值：RGB > 240）
    - 保存为 RGBA 模式
    
    注意：
    - 上传新签名会覆盖旧签名文件
    - 签名图片用于后续审批流程的电子签章生成
    """
    # 1. 验证文件类型
    allowed_extensions = [".png", ".jpg", ".jpeg"]
    file_extension = Path(file.filename).suffix.lower()
    
    if file_extension not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的文件格式。仅支持：{', '.join(allowed_extensions)}"
        )
    
    # 2. 创建上传目录
    upload_dir = Path(settings.UPLOAD_DIR) / "signatures"
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    # 3. 生成唯一文件名
    unique_filename = f"user_{current_user.id}_signature_{uuid.uuid4()}.png"
    file_path = upload_dir / unique_filename
    
    try:
        # 4. 读取上传的图片
        contents = await file.read()
        
        # 5. 使用 Pillow 处理图片
        from io import BytesIO
        image = Image.open(BytesIO(contents))
        
        # 转换为 RGBA 模式（支持透明通道）
        if image.mode != 'RGBA':
            image = image.convert('RGBA')
        
        # 6. 背景透明化处理
        # 将白色背景（RGB > 240）转换为透明
        datas = image.getdata()
        new_data = []
        
        for item in datas:
            # 检查是否为白色背景（阈值：240）
            if item[0] > 240 and item[1] > 240 and item[2] > 240:
                # 将白色背景设置为完全透明
                new_data.append((255, 255, 255, 0))
            else:
                # 保留原始像素
                new_data.append(item)
        
        image.putdata(new_data)
        
        # 7. 保存处理后的图片
        image.save(file_path, "PNG")
        
        # 8. 删除旧签名文件（如果存在）
        if current_user.digital_signature:
            old_file_path = Path(current_user.digital_signature.lstrip('/'))
            if old_file_path.exists():
                old_file_path.unlink()
        
        # 9. 更新数据库
        # 存储相对路径（前端访问时需要拼接 BASE_URL）
        signature_path = f"/uploads/signatures/{unique_filename}"
        
        await db.execute(
            update(User)
            .where(User.id == current_user.id)
            .values(
                digital_signature=signature_path,
                updated_at=datetime.utcnow()
            )
        )
        await db.commit()
        
        return SignatureUploadResponseSchema(
            message="电子签名上传成功",
            signature_path=signature_path
        )
    
    except Exception as e:
        # 清理已创建的文件（如果存在）
        if file_path.exists():
            file_path.unlink()
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"图片处理失败: {str(e)}"
        )
