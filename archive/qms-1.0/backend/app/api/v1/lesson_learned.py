"""
Lesson Learned API Routes
经验教训管理API路由
"""
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.lesson_learned_service import LessonLearnedService
from app.schemas.lesson_learned import (
    LessonLearnedCreate,
    LessonLearnedUpdate,
    LessonLearnedResponse,
    LessonLearnedListResponse,
    ProjectLessonCheckRequest,
    ProjectLessonCheckBatchRequest,
    ProjectLessonCheckResponse,
    EvidenceUploadResponse,
    LessonLearnedPushResponse
)

router = APIRouter(prefix="/lesson-learned", tags=["lesson-learned"])


@router.post("", response_model=LessonLearnedResponse, status_code=status.HTTP_201_CREATED)
async def create_lesson_learned(
    lesson_data: LessonLearnedCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    手工新增/完善经验教训
    
    支持：
    - 手工录入新的经验教训
    - 从8D报告自动提取（通过source_record_id关联）
    """
    try:
        lesson = await LessonLearnedService.create_lesson(
            db=db,
            lesson_data=lesson_data,
            created_by=current_user.id
        )
        return lesson
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"创建经验教训失败: {str(e)}"
        )


@router.get("", response_model=LessonLearnedListResponse)
async def get_lesson_learned_list(
    source_module: Optional[str] = None,
    is_active: Optional[bool] = True,
    search_keyword: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取经验教训库列表
    
    支持筛选：
    - source_module: 来源模块（supplier_quality/process_quality/customer_quality/manual）
    - is_active: 是否启用
    - search_keyword: 关键词搜索（标题、内容、适用场景）
    """
    try:
        lessons, total = await LessonLearnedService.get_lessons(
            db=db,
            source_module=source_module,
            is_active=is_active,
            search_keyword=search_keyword,
            page=page,
            page_size=page_size
        )
        
        return LessonLearnedListResponse(
            total=total,
            items=lessons,
            page=page,
            page_size=page_size
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取经验教训列表失败: {str(e)}"
        )


@router.get("/{lesson_id}", response_model=LessonLearnedResponse)
async def get_lesson_learned_detail(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取经验教训详情"""
    lesson = await LessonLearnedService.get_lesson_by_id(db=db, lesson_id=lesson_id)
    
    if not lesson:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"经验教训 ID {lesson_id} 不存在"
        )
    
    return lesson


@router.put("/{lesson_id}", response_model=LessonLearnedResponse)
async def update_lesson_learned(
    lesson_id: int,
    lesson_data: LessonLearnedUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新经验教训
    支持完善、修改经验教训内容
    """
    lesson = await LessonLearnedService.update_lesson(
        db=db,
        lesson_id=lesson_id,
        lesson_data=lesson_data,
        updated_by=current_user.id
    )
    
    if not lesson:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"经验教训 ID {lesson_id} 不存在"
        )
    
    return lesson


@router.delete("/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lesson_learned(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    删除经验教训（软删除）
    将is_active设置为False
    """
    success = await LessonLearnedService.delete_lesson(db=db, lesson_id=lesson_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"经验教训 ID {lesson_id} 不存在"
        )
    
    return None


@router.post("/extract/supplier-8d/{eight_d_id}", response_model=LessonLearnedResponse)
async def extract_from_supplier_8d(
    eight_d_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    从供应商8D报告提取经验教训
    调用2.5模块的8D结案记录
    """
    lesson = await LessonLearnedService.extract_from_supplier_8d(
        db=db,
        eight_d_id=eight_d_id,
        created_by=current_user.id
    )
    
    if not lesson:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"8D报告 ID {eight_d_id} 不存在或未批准"
        )
    
    return lesson


@router.post("/extract/customer-8d/{eight_d_id}", response_model=LessonLearnedResponse)
async def extract_from_customer_8d(
    eight_d_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    从客诉8D报告提取经验教训
    调用2.7模块的8D结案记录
    """
    lesson = await LessonLearnedService.extract_from_customer_8d(
        db=db,
        eight_d_id=eight_d_id,
        created_by=current_user.id
    )
    
    if not lesson:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"客诉8D报告 ID {eight_d_id} 不存在或未批准"
        )
    
    return lesson


@router.post("/projects/{project_id}/push", response_model=LessonLearnedPushResponse)
async def push_lessons_to_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    项目立项时自动推送相关历史问题
    基于项目类型、产品类型等智能匹配
    """
    from app.services.lesson_learned_service import LessonLearnedService
    from app.models.new_product_project import NewProductProject
    from sqlalchemy import select
    
    # 验证项目是否存在
    stmt = select(NewProductProject).where(NewProductProject.id == project_id)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()
    
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"项目 ID {project_id} 不存在"
        )
    
    # 推送经验教训
    pushed_lessons = await LessonLearnedService.push_lessons_to_project(
        db=db,
        project_id=project_id
    )
    
    return LessonLearnedPushResponse(
        project_id=project_id,
        project_name=project.project_name,
        pushed_lessons=pushed_lessons,
        total_pushed=len(pushed_lessons),
        message=f"成功推送 {len(pushed_lessons)} 条经验教训到项目 {project.project_name}"
    )


@router.post("/projects/{project_id}/lesson-check", response_model=ProjectLessonCheckResponse)
async def check_lesson_for_project(
    project_id: int,
    check_data: ProjectLessonCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    逐条勾选规避措施
    项目团队填写是否适用及规避措施
    """
    check = await LessonLearnedService.check_lesson_for_project(
        db=db,
        project_id=project_id,
        check_data=check_data,
        checked_by=current_user.id
    )
    
    # 获取经验教训标题
    lesson = await LessonLearnedService.get_lesson_by_id(db=db, lesson_id=check.lesson_id)
    
    response_data = check.to_dict()
    response_data['lesson_title'] = lesson.lesson_title if lesson else ""
    
    return ProjectLessonCheckResponse(**response_data)


@router.post("/projects/{project_id}/lesson-check/batch", response_model=List[ProjectLessonCheckResponse])
async def batch_check_lessons(
    project_id: int,
    batch_data: ProjectLessonCheckBatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    批量勾选规避措施
    支持一次性提交多条点检记录
    """
    results = []
    
    for check_data in batch_data.checks:
        check = await LessonLearnedService.check_lesson_for_project(
            db=db,
            project_id=project_id,
            check_data=check_data,
            checked_by=current_user.id
        )
        
        # 获取经验教训标题
        lesson = await LessonLearnedService.get_lesson_by_id(db=db, lesson_id=check.lesson_id)
        
        response_data = check.to_dict()
        response_data['lesson_title'] = lesson.lesson_title if lesson else ""
        
        results.append(ProjectLessonCheckResponse(**response_data))
    
    return results


@router.get("/projects/{project_id}/lesson-checks", response_model=List[ProjectLessonCheckResponse])
async def get_project_lesson_checks(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取项目的所有经验教训点检记录
    包含经验教训详情
    """
    checks = await LessonLearnedService.get_project_lesson_checks(
        db=db,
        project_id=project_id,
        include_lesson_details=True
    )
    
    return [ProjectLessonCheckResponse(**check) for check in checks]


@router.post("/projects/{project_id}/lesson-checks/{check_id}/evidence", response_model=EvidenceUploadResponse)
async def upload_evidence(
    project_id: int,
    check_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    上传规避证据
    阶段评审时上传设计截图、文件修改记录等
    """
    import os
    from datetime import datetime
    
    # 保存文件
    upload_dir = f"uploads/lesson_evidence/{project_id}"
    os.makedirs(upload_dir, exist_ok=True)
    
    file_extension = os.path.splitext(file.filename)[1]
    file_name = f"{check_id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{file_extension}"
    file_path = os.path.join(upload_dir, file_name)
    
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)
    
    # 更新数据库
    check = await LessonLearnedService.upload_evidence(
        db=db,
        check_id=check_id,
        file_path=file_path
    )
    
    if not check:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"点检记录 ID {check_id} 不存在"
        )
    
    return EvidenceUploadResponse(
        check_id=check_id,
        file_path=file_path,
        uploaded_at=datetime.utcnow()
    )


@router.post("/projects/{project_id}/lesson-checks/{check_id}/verify")
async def verify_lesson_check(
    project_id: int,
    check_id: int,
    verification_result: str,
    verification_comment: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    阶段评审时验证规避证据
    评审员验证项目团队提交的规避措施是否有效
    """
    if verification_result not in ["passed", "failed"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证结果必须是 'passed' 或 'failed'"
        )
    
    check = await LessonLearnedService.verify_lesson_check(
        db=db,
        check_id=check_id,
        verified_by=current_user.id,
        verification_result=verification_result,
        verification_comment=verification_comment
    )
    
    if not check:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"点检记录 ID {check_id} 不存在"
        )
    
    return {"message": "验证完成", "result": verification_result}


@router.get("/projects/{project_id}/unchecked-count")
async def get_unchecked_lessons_count(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取项目未点检的经验教训数量
    用于阶段评审时的互锁检查
    """
    count = await LessonLearnedService.get_unchecked_lessons_count(
        db=db,
        project_id=project_id
    )
    
    return {
        "project_id": project_id,
        "unchecked_count": count,
        "can_proceed": count == 0
    }
