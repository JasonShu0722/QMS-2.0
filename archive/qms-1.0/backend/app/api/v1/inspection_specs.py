"""
物料检验规范 API 路由
Inspection Specification Routes - RESTful API 接口
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User, UserType
from app.schemas.inspection_spec import (
    InspectionSpecCreate,
    InspectionSpecSubmit,
    InspectionSpecApprove,
    InspectionSpecUpdate,
    InspectionSpecResponse,
    InspectionSpecListResponse
)
from app.services.inspection_spec_service import InspectionSpecService, ReportTaskService


router = APIRouter(prefix="/inspection-specs", tags=["inspection-specs"])


@router.post("", response_model=InspectionSpecResponse, status_code=status.HTTP_201_CREATED)
async def create_inspection_spec(
    data: InspectionSpecCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    SQE 发起规范提交任务
    
    创建新的检验规范记录，状态为 DRAFT
    系统自动生成版本号（V1.0, V1.1...）
    """
    # 权限检查：仅内部员工（SQE）可发起
    if current_user.user_type != UserType.INTERNAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可发起检验规范提交任务"
        )
    
    try:
        spec = await InspectionSpecService.create_spec_task(
            db=db,
            material_code=data.material_code,
            supplier_id=data.supplier_id,
            report_frequency_type=data.report_frequency_type,
            created_by=current_user.id
        )
        
        return InspectionSpecResponse.model_validate(spec)
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"创建检验规范失败: {str(e)}"
        )


@router.post("/{spec_id}/submit", response_model=InspectionSpecResponse)
async def submit_sip(
    spec_id: int,
    data: InspectionSpecSubmit,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    供应商提交 SIP（检验规范）
    
    供应商在线填写关键检验项目并上传双方签字版 SIP 文件（PDF）
    提交后状态变为 PENDING_REVIEW，等待 SQE 审核
    """
    # 权限检查：仅供应商可提交
    if current_user.user_type != UserType.SUPPLIER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅供应商可提交 SIP"
        )
    
    try:
        # 转换 Pydantic 模型为字典
        key_characteristics = [item.model_dump() for item in data.key_characteristics]
        
        spec = await InspectionSpecService.submit_sip(
            db=db,
            spec_id=spec_id,
            key_characteristics=key_characteristics,
            sip_file_path=data.sip_file_path,
            supplier_id=current_user.supplier_id
        )
        
        return InspectionSpecResponse.model_validate(spec)
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"提交 SIP 失败: {str(e)}"
        )


@router.post("/{spec_id}/approve", response_model=InspectionSpecResponse)
async def approve_inspection_spec(
    spec_id: int,
    data: InspectionSpecApprove,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    SQE 审批检验规范
    
    批准：
    - 状态变为 APPROVED
    - 旧版本自动归档（状态变为 ARCHIVED）
    - 记录生效日期
    
    驳回：
    - 状态回退到 DRAFT
    - 必须填写审核意见
    - 供应商可重新提交
    """
    # 权限检查：仅内部员工（SQE）可审批
    if current_user.user_type != UserType.INTERNAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可审批检验规范"
        )
    
    try:
        spec = await InspectionSpecService.approve_spec(
            db=db,
            spec_id=spec_id,
            approved=data.approved,
            review_comments=data.review_comments,
            effective_date=data.effective_date,
            reviewer_id=current_user.id
        )
        
        return InspectionSpecResponse.model_validate(spec)
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"审批检验规范失败: {str(e)}"
        )


@router.get("", response_model=InspectionSpecListResponse)
async def list_inspection_specs(
    material_code: Optional[str] = Query(None, description="物料编码（模糊搜索）"),
    supplier_id: Optional[int] = Query(None, description="供应商ID"),
    status: Optional[str] = Query(None, description="状态（draft/pending_review/approved/archived）"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    查询检验规范列表
    
    支持筛选：
    - 物料编码（模糊搜索）
    - 供应商ID
    - 状态
    
    供应商用户仅能查看自己的数据
    """
    # 供应商权限过滤
    if current_user.user_type == UserType.SUPPLIER:
        supplier_id = current_user.supplier_id
    
    try:
        specs, total = await InspectionSpecService.list_specs(
            db=db,
            material_code=material_code,
            supplier_id=supplier_id,
            status=status,
            page=page,
            page_size=page_size
        )
        
        return InspectionSpecListResponse(
            total=total,
            items=[InspectionSpecResponse.model_validate(spec) for spec in specs],
            page=page,
            page_size=page_size
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"查询检验规范列表失败: {str(e)}"
        )


@router.get("/{spec_id}", response_model=InspectionSpecResponse)
async def get_inspection_spec(
    spec_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取检验规范详情
    
    供应商用户仅能查看自己的数据
    """
    try:
        spec = await InspectionSpecService.get_spec_by_id(db, spec_id)
        
        if not spec:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"检验规范 ID {spec_id} 不存在"
            )
        
        # 供应商权限检查
        if current_user.user_type == UserType.SUPPLIER:
            if spec.supplier_id != current_user.supplier_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="无权限查看此检验规范"
                )
        
        return InspectionSpecResponse.model_validate(spec)
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取检验规范详情失败: {str(e)}"
        )


@router.patch("/{spec_id}/report-frequency", response_model=InspectionSpecResponse)
async def update_report_frequency(
    spec_id: int,
    data: InspectionSpecUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新报告频率策略
    
    仅内部员工（SQE）可修改
    支持的频率类型：
    - batch: 按批次（每笔发货都需要报告）
    - weekly: 每周
    - monthly: 每月
    - quarterly: 每季度
    """
    # 权限检查：仅内部员工（SQE）可修改
    if current_user.user_type != UserType.INTERNAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可修改报告频率策略"
        )
    
    if not data.report_frequency_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="报告频率类型不能为空"
        )
    
    try:
        spec = await InspectionSpecService.update_report_frequency(
            db=db,
            spec_id=spec_id,
            report_frequency_type=data.report_frequency_type,
            updated_by=current_user.id
        )
        
        return InspectionSpecResponse.model_validate(spec)
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"更新报告频率失败: {str(e)}"
        )


@router.get("/active/{material_code}/{supplier_id}", response_model=InspectionSpecResponse)
async def get_active_spec(
    material_code: str,
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取当前生效的检验规范
    
    用于 IQC 检验参照
    返回最新批准且生效的版本
    """
    try:
        spec = await InspectionSpecService.get_active_spec(
            db=db,
            material_code=material_code,
            supplier_id=supplier_id
        )
        
        if not spec:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"未找到物料 {material_code} 供应商 {supplier_id} 的生效检验规范"
            )
        
        return InspectionSpecResponse.model_validate(spec)
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取生效检验规范失败: {str(e)}"
        )


# ==================== 预留功能接口 ====================

@router.post("/report-tasks/generate", status_code=status.HTTP_202_ACCEPTED)
async def generate_report_tasks(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    生成定期报告提交任务（预留功能）
    
    由 Celery 定时任务调用
    根据 report_frequency_type 自动生成待办任务推送给供应商
    
    待 ASN 发货数据流打通后启用
    """
    # 权限检查：仅系统管理员可调用
    if current_user.user_type != UserType.INTERNAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅系统管理员可调用此接口"
        )
    
    try:
        await ReportTaskService.generate_periodic_tasks(db)
        return {"message": "定期报告任务生成成功（预留功能）"}
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"生成定期报告任务失败: {str(e)}"
        )


@router.get("/asn-check/{material_code}/{supplier_id}")
async def check_asn_report_requirement(
    material_code: str,
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    ASN 强关联检查（预留功能）
    
    检查该物料是否需要上传报告才能提交发货单
    
    返回：
    - required: 是否需要报告
    - frequency_type: 报告频率类型
    
    待 ASN 发货数据流打通后启用
    """
    try:
        required, frequency_type = await ReportTaskService.check_asn_report_requirement(
            db=db,
            material_code=material_code,
            supplier_id=supplier_id
        )
        
        return {
            "required": required,
            "frequency_type": frequency_type,
            "message": "ASN 强关联检查（预留功能）"
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ASN 强关联检查失败: {str(e)}"
        )

