"""
供应商质量目标管理 API 路由
Supplier Target API - 实现目标设定、签署、审批的HTTP接口
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User, UserType
from app.schemas.supplier_target import (
    BatchTargetCreate,
    BatchTargetCreateResponse,
    IndividualTargetCreate,
    IndividualTargetUpdate,
    TargetSignRequest,
    TargetApprovalRequest,
    TargetQueryParams,
    TargetResponse,
    TargetListResponse,
    HistoricalPerformanceData,
    UnsignedTargetsSummary
)
from app.services.supplier_target_service import SupplierTargetService

router = APIRouter(prefix="/supplier-targets", tags=["Supplier Targets"])


# ==================== 批量设定目标 ====================

@router.post("/batch", response_model=BatchTargetCreateResponse, status_code=status.HTTP_201_CREATED)
async def batch_create_targets(
    data: BatchTargetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    批量设定供应商质量目标
    
    权限要求：SQE 或质量经理
    
    业务逻辑：
    - 按物料类别或供应商等级批量设置通用目标
    - 批量设定不覆盖已存在的单独设定
    - 返回成功/失败统计
    """
    # 权限检查：仅内部员工可操作
    if current_user.user_type != UserType.INTERNAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可批量设定目标"
        )
    
    try:
        result = await SupplierTargetService.batch_create_targets(
            db=db,
            data=data,
            created_by=current_user.id
        )
        return result
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"批量设定目标失败: {str(e)}"
        )


# ==================== 单独设定目标 ====================

@router.post("/individual", response_model=TargetResponse, status_code=status.HTTP_201_CREATED)
async def create_individual_target(
    data: IndividualTargetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    单独设定供应商质量目标
    
    权限要求：SQE 或质量经理
    
    业务逻辑：
    - 针对特定供应商进行差异化目标配置
    - 单独设定优先级高于批量设定
    - 支持填写历史实际值作为辅助决策数据
    """
    # 权限检查：仅内部员工可操作
    if current_user.user_type != UserType.INTERNAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可单独设定目标"
        )
    
    try:
        target = await SupplierTargetService.create_individual_target(
            db=db,
            data=data,
            created_by=current_user.id
        )
        return TargetResponse.model_validate(target)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"创建目标失败: {str(e)}"
        )


@router.put("/individual/{target_id}", response_model=TargetResponse)
async def update_individual_target(
    target_id: int,
    data: IndividualTargetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新单独设定的目标
    
    权限要求：SQE 或质量经理
    
    业务逻辑：
    - 仅允许更新单独设定的目标
    - 如果已签署或已审批，更新后需重置状态
    """
    # 权限检查：仅内部员工可操作
    if current_user.user_type != UserType.INTERNAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可更新目标"
        )
    
    try:
        target = await SupplierTargetService.update_individual_target(
            db=db,
            target_id=target_id,
            data=data,
            updated_by=current_user.id
        )
        return TargetResponse.model_validate(target)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"更新目标失败: {str(e)}"
        )


# ==================== 供应商签署目标 ====================

@router.post("/{target_id}/sign", response_model=TargetResponse)
async def sign_target(
    target_id: int,
    data: TargetSignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    供应商签署质量目标
    
    权限要求：供应商用户
    
    业务逻辑：
    - 供应商查阅目标值，点击"确认/签署"
    - 必须先审批后签署
    - 记录签署时间和签署人
    - 签署互锁机制：未签署限制申诉权限
    """
    # 权限检查：仅供应商用户可签署
    if current_user.user_type != UserType.SUPPLIER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅供应商用户可签署目标"
        )
    
    if not current_user.supplier_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前用户未关联供应商"
        )
    
    try:
        target = await SupplierTargetService.sign_target(
            db=db,
            target_id=target_id,
            user_id=current_user.id,
            supplier_id=current_user.supplier_id
        )
        return TargetResponse.model_validate(target)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"签署目标失败: {str(e)}"
        )


# ==================== 质量经理审批目标 ====================

@router.post("/approve", response_model=dict)
async def approve_targets(
    data: TargetApprovalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    质量经理审批目标
    
    权限要求：质量经理
    
    业务逻辑：
    - SQE 提交 -> 质量经理审核
    - 若目标值低于历史实际值，系统自动高亮提示"目标倒退风险"
    - 批量审批多个目标
    """
    # 权限检查：仅内部员工可审批（实际应检查是否为质量经理角色）
    if current_user.user_type != UserType.INTERNAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅质量经理可审批目标"
        )
    
    # TODO: 增加角色权限检查，确保是质量经理
    
    try:
        result = await SupplierTargetService.approve_targets(
            db=db,
            target_ids=data.target_ids,
            approve=data.approve,
            approved_by=current_user.id
        )
        return result
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"审批目标失败: {str(e)}"
        )


# ==================== 查询目标列表 ====================

@router.get("", response_model=TargetListResponse)
async def get_targets(
    supplier_id: int = None,
    year: int = None,
    target_type: str = None,
    is_signed: bool = None,
    is_approved: bool = None,
    is_individual: bool = None,
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    查询目标列表
    
    权限要求：
    - 内部员工：可查看所有目标
    - 供应商用户：仅可查看自己的目标
    
    支持多条件筛选和分页
    """
    # 供应商用户仅能查看自己的目标
    if current_user.user_type == UserType.SUPPLIER:
        if not current_user.supplier_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="当前用户未关联供应商"
            )
        supplier_id = current_user.supplier_id
    
    params = TargetQueryParams(
        supplier_id=supplier_id,
        year=year,
        target_type=target_type,
        is_signed=is_signed,
        is_approved=is_approved,
        is_individual=is_individual,
        page=page,
        page_size=page_size
    )
    
    try:
        result = await SupplierTargetService.get_targets(db=db, params=params)
        
        # 转换为响应模型
        items = [TargetResponse.model_validate(item) for item in result["items"]]
        
        return TargetListResponse(
            total=result["total"],
            page=result["page"],
            page_size=result["page_size"],
            items=items
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"查询目标列表失败: {str(e)}"
        )


# ==================== 获取目标详情 ====================

@router.get("/{target_id}", response_model=TargetResponse)
async def get_target_detail(
    target_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取目标详情
    
    权限要求：
    - 内部员工：可查看所有目标
    - 供应商用户：仅可查看自己的目标
    """
    target = await SupplierTargetService.get_target_by_id(db=db, target_id=target_id)
    
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"目标ID {target_id} 不存在"
        )
    
    # 供应商用户权限检查
    if current_user.user_type == UserType.SUPPLIER:
        if not current_user.supplier_id or target.supplier_id != current_user.supplier_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="无权查看其他供应商的目标"
            )
    
    return TargetResponse.model_validate(target)


# ==================== 获取历史绩效数据（辅助决策） ====================

@router.get("/{supplier_id}/historical-performance", response_model=HistoricalPerformanceData)
async def get_historical_performance(
    supplier_id: int,
    target_type: str,
    year: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取历史绩效数据（辅助决策）
    
    权限要求：内部员工
    
    业务逻辑：
    - 在设定界面，系统自动左右分栏展示
    - 左侧：拟设定的目标值
    - 右侧：该供应商历史实际达成值（平均值及波动范围）
    - 辅助 SQE 评估目标的合理性与挑战性
    """
    # 权限检查：仅内部员工可查看
    if current_user.user_type != UserType.INTERNAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可查看历史绩效数据"
        )
    
    try:
        from app.models.supplier_target import TargetType
        target_type_enum = TargetType(target_type)
        
        data = await SupplierTargetService.get_historical_performance(
            db=db,
            supplier_id=supplier_id,
            target_type=target_type_enum,
            year=year
        )
        
        if not data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="未找到历史绩效数据"
            )
        
        return data
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无效的目标类型"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取历史绩效数据失败: {str(e)}"
        )


# ==================== 获取未签署目标统计 ====================

@router.get("/statistics/unsigned", response_model=UnsignedTargetsSummary)
async def get_unsigned_targets_summary(
    year: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取未签署目标统计
    
    权限要求：内部员工
    
    业务逻辑：
    - 用于管理员监控供应商签署进度
    - 显示未签署总数和按供应商分组统计
    """
    # 权限检查：仅内部员工可查看
    if current_user.user_type != UserType.INTERNAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可查看统计数据"
        )
    
    try:
        result = await SupplierTargetService.get_unsigned_targets_summary(
            db=db,
            year=year
        )
        return UnsignedTargetsSummary(**result)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取统计数据失败: {str(e)}"
        )


# ==================== 检查签署权限（申诉互锁） ====================

@router.get("/check-permission/{supplier_id}/{year}", response_model=dict)
async def check_signing_permission(
    supplier_id: int,
    year: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    检查供应商是否有申诉权限
    
    权限要求：供应商用户或内部员工
    
    业务逻辑：
    - 签署互锁机制：未签署限制申诉权限
    - 若在规定时间（如 1 月 31 日）前未签署，系统限制其查看绩效申诉权限
    """
    # 供应商用户仅能查看自己的权限
    if current_user.user_type == UserType.SUPPLIER:
        if not current_user.supplier_id or current_user.supplier_id != supplier_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="无权查看其他供应商的权限"
            )
    
    try:
        has_permission = await SupplierTargetService.check_signing_permission(
            db=db,
            supplier_id=supplier_id,
            year=year
        )
        
        return {
            "supplier_id": supplier_id,
            "year": year,
            "has_appeal_permission": has_permission,
            "message": "已签署所有目标，拥有申诉权限" if has_permission else "存在未签署目标，申诉权限受限"
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"检查权限失败: {str(e)}"
        )
