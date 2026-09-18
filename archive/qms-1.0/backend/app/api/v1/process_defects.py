"""
过程质量不良品数据 API 路由
Process Defects API - 制程不合格品记录管理接口
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.process_defect import (
    ProcessDefectCreate,
    ProcessDefectUpdate,
    ProcessDefectResponse,
    ProcessDefectListQuery,
    DefectTypeListResponse,
    ResponsibilityCategoryListResponse
)
from app.services.process_defect_service import ProcessDefectService
from app.core.exceptions import NotFoundException, BusinessException

router = APIRouter(prefix="/process-defects", tags=["Process Quality Management"])


# ============ 不良品数据录入与管理接口 ============

@router.post("", response_model=ProcessDefectResponse, status_code=status.HTTP_201_CREATED)
async def create_process_defect(
    defect_data: ProcessDefectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    人工补录不良品数据
    
    权限要求：内部用户（PQE/QE/产线质检员）
    
    业务流程：
    1. 验证责任类别
    2. 如果是物料不良，验证供应商和物料编码
    3. 创建不良品记录
    4. 自动关联质量指标计算（2.4.1）
    
    责任类别说明：
    - material_defect: 物料不良 -> 关联"物料上线不良PPM"指标
    - operation_defect: 作业不良 -> 关联"制程不合格率（作业类）"
    - equipment_defect: 设备不良 -> 关联"制程不合格率（设备类）"
    - process_defect: 工艺不良 -> 关联"制程不合格率（工艺类）"
    - design_defect: 设计不良 -> 关联"制程不合格率（设计类）"
    """
    try:
        # 权限检查：只有内部用户可以录入
        if current_user.user_type != "internal":
            raise HTTPException(
                status_code=403, 
                detail="Only internal users can create defect records"
            )
        
        defect = await ProcessDefectService.create_defect(
            db=db,
            defect_data=defect_data,
            recorded_by=current_user.id
        )
        
        # 构建响应
        response = ProcessDefectResponse.from_orm(defect)
        
        # 查询关联数据
        from app.models.supplier import Supplier
        from sqlalchemy import select
        
        # 查询操作员名称
        if defect.operator_id:
            operator_result = await db.execute(
                select(User).where(User.id == defect.operator_id)
            )
            operator = operator_result.scalar_one_or_none()
            if operator:
                response.operator_name = operator.full_name
        
        # 查询记录人名称
        response.recorded_by_name = current_user.full_name
        
        # 查询供应商名称
        if defect.supplier_id:
            supplier_result = await db.execute(
                select(Supplier).where(Supplier.id == defect.supplier_id)
            )
            supplier = supplier_result.scalar_one_or_none()
            if supplier:
                response.supplier_name = supplier.name
        
        return response
        
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BusinessException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to create process defect: {str(e)}"
        )


@router.get("", response_model=dict)
async def get_process_defect_list(
    defect_date_start: str = None,
    defect_date_end: str = None,
    work_order: str = None,
    process_id: str = None,
    line_id: str = None,
    defect_type: str = None,
    responsibility_category: str = None,
    supplier_id: int = None,
    material_code: str = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取不良品数据清单
    
    权限控制：
    - 供应商用户只能看到关联到自己的物料不良记录
    - 内部用户可以看到所有不良品记录
    
    支持筛选：
    - 日期范围（defect_date_start, defect_date_end）
    - 工单号（work_order）
    - 工序（process_id）
    - 产线（line_id）
    - 不良类型（defect_type）
    - 责任类别（responsibility_category）
    - 供应商（supplier_id）
    - 物料编码（material_code）
    
    返回数据包含：
    - 不良品记录列表
    - 分页信息
    - 关联的操作员、记录人、供应商名称
    """
    try:
        # 解析日期参数
        from datetime import date as date_type
        date_start = None
        date_end = None
        
        if defect_date_start:
            try:
                date_start = date_type.fromisoformat(defect_date_start)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid defect_date_start format. Use YYYY-MM-DD")
        
        if defect_date_end:
            try:
                date_end = date_type.fromisoformat(defect_date_end)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid defect_date_end format. Use YYYY-MM-DD")
        
        # 构建查询参数
        query = ProcessDefectListQuery(
            defect_date_start=date_start,
            defect_date_end=date_end,
            work_order=work_order,
            process_id=process_id,
            line_id=line_id,
            defect_type=defect_type,
            responsibility_category=responsibility_category,
            supplier_id=supplier_id,
            material_code=material_code,
            page=page,
            page_size=page_size
        )
        
        defects, total = await ProcessDefectService.get_defect_list(
            db=db,
            query=query,
            current_user=current_user
        )
        
        # 构建响应列表
        from app.models.supplier import Supplier
        from sqlalchemy import select
        
        defect_list = []
        for defect in defects:
            response = ProcessDefectResponse.from_orm(defect)
            
            # 查询操作员名称
            if defect.operator_id:
                operator_result = await db.execute(
                    select(User).where(User.id == defect.operator_id)
                )
                operator = operator_result.scalar_one_or_none()
                if operator:
                    response.operator_name = operator.full_name
            
            # 查询记录人名称
            if defect.recorded_by:
                recorder_result = await db.execute(
                    select(User).where(User.id == defect.recorded_by)
                )
                recorder = recorder_result.scalar_one_or_none()
                if recorder:
                    response.recorded_by_name = recorder.full_name
            
            # 查询供应商名称
            if defect.supplier_id:
                supplier_result = await db.execute(
                    select(Supplier).where(Supplier.id == defect.supplier_id)
                )
                supplier = supplier_result.scalar_one_or_none()
                if supplier:
                    response.supplier_name = supplier.name
            
            defect_list.append(response)
        
        return {
            "items": defect_list,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size
        }
        
    except BusinessException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to get process defect list: {str(e)}"
        )


@router.get("/{defect_id}", response_model=ProcessDefectResponse)
async def get_process_defect_detail(
    defect_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取不良品记录详情
    
    权限控制：供应商用户只能查看自己的记录
    """
    try:
        defect = await ProcessDefectService.get_defect_by_id(
            db=db,
            defect_id=defect_id,
            current_user=current_user
        )
        
        response = ProcessDefectResponse.from_orm(defect)
        
        # 查询关联数据
        from app.models.supplier import Supplier
        from sqlalchemy import select
        
        # 查询操作员名称
        if defect.operator_id:
            operator_result = await db.execute(
                select(User).where(User.id == defect.operator_id)
            )
            operator = operator_result.scalar_one_or_none()
            if operator:
                response.operator_name = operator.full_name
        
        # 查询记录人名称
        if defect.recorded_by:
            recorder_result = await db.execute(
                select(User).where(User.id == defect.recorded_by)
            )
            recorder = recorder_result.scalar_one_or_none()
            if recorder:
                response.recorded_by_name = recorder.full_name
        
        # 查询供应商名称
        if defect.supplier_id:
            supplier_result = await db.execute(
                select(Supplier).where(Supplier.id == defect.supplier_id)
            )
            supplier = supplier_result.scalar_one_or_none()
            if supplier:
                response.supplier_name = supplier.name
        
        return response
        
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BusinessException as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to get process defect detail: {str(e)}"
        )


@router.put("/{defect_id}", response_model=ProcessDefectResponse)
async def update_process_defect(
    defect_id: int,
    defect_data: ProcessDefectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新不良品记录
    
    权限要求：内部用户
    """
    try:
        defect = await ProcessDefectService.update_defect(
            db=db,
            defect_id=defect_id,
            defect_data=defect_data,
            current_user=current_user
        )
        
        response = ProcessDefectResponse.from_orm(defect)
        
        # 查询关联数据
        from app.models.supplier import Supplier
        from sqlalchemy import select
        
        if defect.operator_id:
            operator_result = await db.execute(
                select(User).where(User.id == defect.operator_id)
            )
            operator = operator_result.scalar_one_or_none()
            if operator:
                response.operator_name = operator.full_name
        
        if defect.recorded_by:
            recorder_result = await db.execute(
                select(User).where(User.id == defect.recorded_by)
            )
            recorder = recorder_result.scalar_one_or_none()
            if recorder:
                response.recorded_by_name = recorder.full_name
        
        if defect.supplier_id:
            supplier_result = await db.execute(
                select(Supplier).where(Supplier.id == defect.supplier_id)
            )
            supplier = supplier_result.scalar_one_or_none()
            if supplier:
                response.supplier_name = supplier.name
        
        return response
        
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BusinessException as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to update process defect: {str(e)}"
        )


@router.delete("/{defect_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_process_defect(
    defect_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    删除不良品记录
    
    权限要求：内部用户
    """
    try:
        await ProcessDefectService.delete_defect(
            db=db,
            defect_id=defect_id,
            current_user=current_user
        )
        
        return None
        
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BusinessException as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to delete process defect: {str(e)}"
        )


# ============ 预设选项接口 ============

@router.get("/options/defect-types", response_model=DefectTypeListResponse)
async def get_defect_type_options(
    current_user: User = Depends(get_current_user)
):
    """
    获取失效类型预设选项
    
    返回系统预设的失效类型列表，用于前端下拉选择
    
    分类包括：
    - 焊接类：焊接桥接、冷焊、焊接空洞等
    - 组装类：漏装元件、错装元件、极性反装等
    - 外观类：划伤、污染、变色等
    - 功能类：短路、开路、参数超标等
    - 尺寸类：尺寸超差、位置偏移等
    """
    try:
        defect_types = ProcessDefectService.get_defect_type_options()
        return DefectTypeListResponse(defect_types=defect_types)
        
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to get defect type options: {str(e)}"
        )


@router.get("/options/responsibility-categories", response_model=ResponsibilityCategoryListResponse)
async def get_responsibility_category_options(
    current_user: User = Depends(get_current_user)
):
    """
    获取责任类别选项及说明
    
    返回责任类别列表，包含：
    - 类别值和显示名称
    - 类别说明
    - 关联的质量指标（用于自动关联 2.4.1 指标计算）
    
    责任类别：
    - material_defect: 物料不良 -> 关联"物料上线不良PPM"
    - operation_defect: 作业不良 -> 关联"制程不合格率（作业类）"
    - equipment_defect: 设备不良 -> 关联"制程不合格率（设备类）"
    - process_defect: 工艺不良 -> 关联"制程不合格率（工艺类）"
    - design_defect: 设计不良 -> 关联"制程不合格率（设计类）"
    """
    try:
        categories = ProcessDefectService.get_responsibility_category_options()
        return ResponsibilityCategoryListResponse(categories=categories)
        
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to get responsibility category options: {str(e)}"
        )
