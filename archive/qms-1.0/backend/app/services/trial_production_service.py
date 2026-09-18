"""
Trial Production Service
试产目标与实绩管理服务
实现2.8.3试产目标与实绩管理
"""
from datetime import datetime, date
from typing import Optional, Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload

from app.models.trial_production import TrialProduction, TrialStatus
from app.models.new_product_project import NewProductProject
from app.schemas.trial_production import (
    TrialProductionCreate,
    TrialProductionUpdate,
    ManualMetricsInput,
    TrialProductionSummary
)
from app.services.ims_integration_service import ims_integration_service


class TrialProductionService:
    """
    试产目标与实绩管理服务类
    
    功能：
    - 创建试产记录并设定质量目标
    - 关联IMS工单号自动抓取生产数据
    - 支持手动补录CPK、破坏性实验等数据
    - 生成试产总结报告（红绿灯对比）
    - 导出Excel/PDF报告
    """
    
    @staticmethod
    async def create_trial_production(
        db: AsyncSession,
        trial_data: TrialProductionCreate,
        current_user_id: int
    ) -> TrialProduction:
        """
        创建试产记录
        
        Args:
            db: 数据库会话
            trial_data: 试产记录数据
            current_user_id: 当前用户ID
            
        Returns:
            TrialProduction: 创建的试产记录
            
        Raises:
            ValueError: 项目不存在或工单号重复
        """
        # 验证项目是否存在
        project_query = select(NewProductProject).where(
            NewProductProject.id == trial_data.project_id
        )
        project_result = await db.execute(project_query)
        project = project_result.scalar_one_or_none()
        
        if not project:
            raise ValueError(f"项目不存在: project_id={trial_data.project_id}")
        
        # 检查工单号是否已存在
        existing_query = select(TrialProduction).where(
            and_(
                TrialProduction.project_id == trial_data.project_id,
                TrialProduction.work_order == trial_data.work_order
            )
        )
        existing_result = await db.execute(existing_query)
        existing_trial = existing_result.scalar_one_or_none()
        
        if existing_trial:
            raise ValueError(f"工单号已存在: {trial_data.work_order}")
        
        # 创建试产记录
        trial_production = TrialProduction(
            project_id=trial_data.project_id,
            work_order=trial_data.work_order,
            trial_batch=trial_data.trial_batch,
            trial_date=trial_data.trial_date,
            target_metrics=trial_data.target_metrics,
            status=TrialStatus.PLANNED,
            ims_sync_status="pending",
            summary_comments=trial_data.summary_comments,
            created_by=current_user_id,
            updated_by=current_user_id
        )
        
        db.add(trial_production)
        await db.commit()
        await db.refresh(trial_production)
        
        print(f"✅ 创建试产记录成功: ID={trial_production.id}, 工单号={trial_production.work_order}")
        
        return trial_production
    
    @staticmethod
    async def get_trial_production_by_id(
        db: AsyncSession,
        trial_id: int
    ) -> Optional[TrialProduction]:
        """
        根据ID获取试产记录
        
        Args:
            db: 数据库会话
            trial_id: 试产记录ID
            
        Returns:
            Optional[TrialProduction]: 试产记录或None
        """
        query = select(TrialProduction).where(TrialProduction.id == trial_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()
    
    @staticmethod
    async def update_trial_production(
        db: AsyncSession,
        trial_id: int,
        trial_data: TrialProductionUpdate,
        current_user_id: int
    ) -> TrialProduction:
        """
        更新试产记录
        
        Args:
            db: 数据库会话
            trial_id: 试产记录ID
            trial_data: 更新数据
            current_user_id: 当前用户ID
            
        Returns:
            TrialProduction: 更新后的试产记录
            
        Raises:
            ValueError: 试产记录不存在
        """
        trial = await TrialProductionService.get_trial_production_by_id(db, trial_id)
        
        if not trial:
            raise ValueError(f"试产记录不存在: trial_id={trial_id}")
        
        # 更新字段
        if trial_data.trial_batch is not None:
            trial.trial_batch = trial_data.trial_batch
        
        if trial_data.trial_date is not None:
            trial.trial_date = trial_data.trial_date
        
        if trial_data.target_metrics is not None:
            trial.target_metrics = trial_data.target_metrics
        
        if trial_data.actual_metrics is not None:
            trial.actual_metrics = trial_data.actual_metrics
        
        if trial_data.status is not None:
            trial.status = trial_data.status
        
        if trial_data.summary_comments is not None:
            trial.summary_comments = trial_data.summary_comments
        
        trial.updated_by = current_user_id
        trial.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(trial)
        
        print(f"✅ 更新试产记录成功: ID={trial.id}")
        
        return trial
    
    @staticmethod
    async def sync_ims_data(
        db: AsyncSession,
        trial_id: int,
        force_sync: bool = False
    ) -> Dict[str, Any]:
        """
        从IMS系统同步试产数据
        
        自动抓取：投入数、产出数、一次合格数、不良数
        
        Args:
            db: 数据库会话
            trial_id: 试产记录ID
            force_sync: 是否强制重新同步
            
        Returns:
            Dict[str, Any]: 同步结果
            {
                "success": bool,
                "message": str,
                "synced_data": Optional[Dict],
                "error": Optional[str]
            }
        """
        trial = await TrialProductionService.get_trial_production_by_id(db, trial_id)
        
        if not trial:
            return {
                "success": False,
                "message": "试产记录不存在",
                "synced_data": None,
                "error": f"trial_id={trial_id} 不存在"
            }
        
        # 检查是否已同步且不强制重新同步
        if trial.ims_sync_status == "synced" and not force_sync:
            return {
                "success": True,
                "message": "数据已同步，无需重复同步",
                "synced_data": trial.actual_metrics,
                "error": None
            }
        
        try:
            # 更新同步状态为进行中
            trial.ims_sync_status = "pending"
            await db.commit()
            
            # 调用IMS API获取工单数据
            # 注意：这里需要根据工单号查询对应日期的数据
            # 如果trial_date存在，使用trial_date；否则使用当前日期
            target_date = trial.trial_date if trial.trial_date else date.today()
            
            # 获取成品产出数据
            output_result = await ims_integration_service.fetch_production_output_data(
                db=db,
                start_date=target_date
            )
            
            # 获取一次测试数据
            test_result = await ims_integration_service.fetch_process_test_data(
                db=db,
                start_date=target_date
            )
            
            if not output_result["success"] or not test_result["success"]:
                error_msg = f"IMS数据同步失败: output={output_result.get('error')}, test={test_result.get('error')}"
                trial.ims_sync_status = "failed"
                trial.ims_sync_error = error_msg
                await db.commit()
                
                return {
                    "success": False,
                    "message": "IMS数据同步失败",
                    "synced_data": None,
                    "error": error_msg
                }
            
            # 从返回的数据中筛选出当前工单的数据
            work_order_data = None
            for record in output_result["data"]:
                if record.get("work_order") == trial.work_order:
                    work_order_data = record
                    break
            
            if not work_order_data:
                error_msg = f"未找到工单号 {trial.work_order} 的数据"
                trial.ims_sync_status = "failed"
                trial.ims_sync_error = error_msg
                await db.commit()
                
                return {
                    "success": False,
                    "message": "未找到工单数据",
                    "synced_data": None,
                    "error": error_msg
                }
            
            # 提取关键数据
            input_qty = work_order_data.get("input_qty", 0)
            output_qty = work_order_data.get("output_qty", 0)
            
            # 从测试数据中获取一次合格数
            first_pass_qty = 0
            total_test_qty = 0
            for test_record in test_result["data"]:
                if test_record.get("work_order") == trial.work_order:
                    first_pass_qty = test_record.get("first_pass_qty", 0)
                    total_test_qty = test_record.get("total_test_qty", 0)
                    break
            
            # 计算不良数
            defect_qty = input_qty - output_qty if input_qty > output_qty else 0
            
            # 计算合格率和直通率
            pass_rate = (output_qty / input_qty * 100) if input_qty > 0 else 0
            fpy = (first_pass_qty / total_test_qty * 100) if total_test_qty > 0 else 0
            
            # 构建实绩数据
            synced_data = {
                "input_qty": input_qty,
                "output_qty": output_qty,
                "first_pass_qty": first_pass_qty,
                "total_test_qty": total_test_qty,
                "defect_qty": defect_qty,
                "pass_rate": {
                    "actual": round(pass_rate, 2),
                    "status": "pending"  # 待与目标值对比后确定
                },
                "fpy": {
                    "actual": round(fpy, 2),
                    "status": "pending"
                }
            }
            
            # 如果已有actual_metrics，合并数据（保留手工录入的数据）
            if trial.actual_metrics:
                synced_data = {**trial.actual_metrics, **synced_data}
            
            # 与目标值对比，更新状态
            if trial.target_metrics:
                synced_data = TrialProductionService._compare_with_targets(
                    synced_data,
                    trial.target_metrics
                )
            
            # 更新试产记录
            trial.actual_metrics = synced_data
            trial.ims_sync_status = "synced"
            trial.ims_sync_at = datetime.utcnow()
            trial.ims_sync_error = None
            trial.updated_at = datetime.utcnow()
            
            await db.commit()
            await db.refresh(trial)
            
            print(f"✅ IMS数据同步成功: trial_id={trial_id}, 工单号={trial.work_order}")
            
            return {
                "success": True,
                "message": "IMS数据同步成功",
                "synced_data": synced_data,
                "error": None
            }
            
        except Exception as e:
            error_msg = f"IMS数据同步异常: {str(e)}"
            trial.ims_sync_status = "failed"
            trial.ims_sync_error = error_msg
            await db.commit()
            
            print(f"❌ {error_msg}")
            
            return {
                "success": False,
                "message": "IMS数据同步异常",
                "synced_data": None,
                "error": error_msg
            }
    
    @staticmethod
    def _compare_with_targets(
        actual_metrics: Dict[str, Any],
        target_metrics: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        将实绩值与目标值对比，更新状态（红绿灯）
        
        Args:
            actual_metrics: 实绩指标
            target_metrics: 目标指标
            
        Returns:
            Dict[str, Any]: 更新后的实绩指标（包含status字段）
        """
        result = actual_metrics.copy()
        
        for metric_key, target_value in target_metrics.items():
            if metric_key in result and isinstance(result[metric_key], dict):
                actual_value = result[metric_key].get("actual")
                target = target_value.get("target")
                
                if actual_value is not None and target is not None:
                    # 判断是否达标（实际值 >= 目标值为达标）
                    status = "pass" if actual_value >= target else "fail"
                    result[metric_key]["status"] = status
                    result[metric_key]["target"] = target
        
        return result
    
    @staticmethod
    async def manual_input_metrics(
        db: AsyncSession,
        trial_id: int,
        manual_data: ManualMetricsInput,
        current_user_id: int
    ) -> TrialProduction:
        """
        手动补录实绩数据
        
        用于录入IMS无法采集的数据：CPK、破坏性实验、外观评审等
        
        Args:
            db: 数据库会话
            trial_id: 试产记录ID
            manual_data: 手动录入数据
            current_user_id: 当前用户ID
            
        Returns:
            TrialProduction: 更新后的试产记录
            
        Raises:
            ValueError: 试产记录不存在
        """
        trial = await TrialProductionService.get_trial_production_by_id(db, trial_id)
        
        if not trial:
            raise ValueError(f"试产记录不存在: trial_id={trial_id}")
        
        # 获取现有的actual_metrics
        actual_metrics = trial.actual_metrics or {}
        
        # 添加手工录入的数据
        if manual_data.cpk is not None:
            actual_metrics["cpk"] = {
                "actual": manual_data.cpk,
                "status": "pending"
            }
        
        if manual_data.destructive_test_result is not None:
            actual_metrics["destructive_test"] = {
                "result": manual_data.destructive_test_result
            }
        
        if manual_data.appearance_score is not None:
            actual_metrics["appearance_score"] = {
                "actual": manual_data.appearance_score,
                "status": "pending"
            }
        
        if manual_data.dimension_pass_rate is not None:
            actual_metrics["dimension_pass_rate"] = {
                "actual": manual_data.dimension_pass_rate,
                "status": "pending"
            }
        
        if manual_data.other_metrics:
            actual_metrics["other_metrics"] = manual_data.other_metrics
        
        # 与目标值对比，更新状态
        if trial.target_metrics:
            actual_metrics = TrialProductionService._compare_with_targets(
                actual_metrics,
                trial.target_metrics
            )
        
        # 更新试产记录
        trial.actual_metrics = actual_metrics
        trial.updated_by = current_user_id
        trial.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(trial)
        
        print(f"✅ 手动补录实绩数据成功: trial_id={trial_id}")
        
        return trial
    
    @staticmethod
    async def generate_summary(
        db: AsyncSession,
        trial_id: int
    ) -> TrialProductionSummary:
        """
        生成试产总结报告
        
        包含：
        - 目标值 vs 实绩值对比（红绿灯）
        - 整体达成状态
        - 改进建议
        
        Args:
            db: 数据库会话
            trial_id: 试产记录ID
            
        Returns:
            TrialProductionSummary: 试产总结报告
            
        Raises:
            ValueError: 试产记录不存在或数据不完整
        """
        trial = await TrialProductionService.get_trial_production_by_id(db, trial_id)
        
        if not trial:
            raise ValueError(f"试产记录不存在: trial_id={trial_id}")
        
        if not trial.target_metrics:
            raise ValueError("目标指标未设定，无法生成总结报告")
        
        if not trial.actual_metrics:
            raise ValueError("实绩数据未录入，无法生成总结报告")
        
        # 构建目标值 vs 实绩值对比
        target_vs_actual = {}
        pass_count = 0
        fail_count = 0
        
        for metric_key, target_value in trial.target_metrics.items():
            if metric_key in trial.actual_metrics:
                actual_data = trial.actual_metrics[metric_key]
                
                if isinstance(actual_data, dict) and "actual" in actual_data:
                    target = target_value.get("target")
                    actual = actual_data.get("actual")
                    status = actual_data.get("status", "unknown")
                    unit = target_value.get("unit", "")
                    
                    target_vs_actual[metric_key] = {
                        "target": target,
                        "actual": actual,
                        "status": status,
                        "unit": unit
                    }
                    
                    if status == "pass":
                        pass_count += 1
                    elif status == "fail":
                        fail_count += 1
        
        # 判断整体状态
        overall_status = "pass" if fail_count == 0 and pass_count > 0 else "fail"
        
        # 生成改进建议
        recommendations = TrialProductionService._generate_recommendations(
            target_vs_actual,
            overall_status
        )
        
        # 构建响应
        from app.schemas.trial_production import TrialProductionResponse
        
        summary = TrialProductionSummary(
            trial_production=TrialProductionResponse.from_orm(trial),
            target_vs_actual=target_vs_actual,
            overall_status=overall_status,
            pass_count=pass_count,
            fail_count=fail_count,
            recommendations=recommendations
        )
        
        print(f"✅ 生成试产总结报告成功: trial_id={trial_id}, 整体状态={overall_status}")
        
        return summary
    
    @staticmethod
    def _generate_recommendations(
        target_vs_actual: Dict[str, Any],
        overall_status: str
    ) -> str:
        """
        根据对比结果生成改进建议
        
        Args:
            target_vs_actual: 目标值vs实绩值对比
            overall_status: 整体状态
            
        Returns:
            str: 改进建议
        """
        if overall_status == "pass":
            return "各项指标均达标，试产成功。建议：1) 总结成功经验并标准化；2) 可进入量产准备阶段。"
        
        # 找出未达标的指标
        failed_metrics = []
        for metric_key, data in target_vs_actual.items():
            if data.get("status") == "fail":
                failed_metrics.append(f"{metric_key}（目标：{data['target']}{data['unit']}，实际：{data['actual']}{data['unit']}）")
        
        if failed_metrics:
            failed_list = "、".join(failed_metrics)
            return f"以下指标未达标：{failed_list}。建议：1) 分析根本原因；2) 制定改善对策；3) 验证后再次试产。"
        
        return "数据不完整，无法生成建议。"
    
    @staticmethod
    async def export_summary_report(
        db: AsyncSession,
        trial_id: int,
        format: str = "pdf"
    ) -> str:
        """
        导出试产总结报告（Excel/PDF）
        
        Args:
            db: 数据库会话
            trial_id: 试产记录ID
            format: 导出格式（pdf/excel）
            
        Returns:
            str: 报告文件路径
            
        Raises:
            ValueError: 试产记录不存在或格式不支持
        """
        if format not in ["pdf", "excel"]:
            raise ValueError(f"不支持的导出格式: {format}")
        
        # 生成总结报告
        summary = await TrialProductionService.generate_summary(db, trial_id)
        
        # TODO: 实现实际的PDF/Excel生成逻辑
        # 这里暂时返回模拟路径
        report_filename = f"trial_summary_{trial_id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.{format}"
        report_path = f"/reports/trial_production/{report_filename}"
        
        # 更新试产记录的报告路径
        trial = await TrialProductionService.get_trial_production_by_id(db, trial_id)
        trial.summary_report_path = report_path
        trial.updated_at = datetime.utcnow()
        await db.commit()
        
        print(f"✅ 导出试产总结报告成功: {report_path}")
        
        return report_path
    
    @staticmethod
    async def list_trial_productions(
        db: AsyncSession,
        project_id: Optional[int] = None,
        status: Optional[TrialStatus] = None,
        skip: int = 0,
        limit: int = 50
    ) -> List[TrialProduction]:
        """
        查询试产记录列表
        
        Args:
            db: 数据库会话
            project_id: 项目ID（可选）
            status: 试产状态（可选）
            skip: 跳过记录数
            limit: 返回记录数限制
            
        Returns:
            List[TrialProduction]: 试产记录列表
        """
        query = select(TrialProduction)
        
        # 添加筛选条件
        if project_id:
            query = query.where(TrialProduction.project_id == project_id)
        
        if status:
            query = query.where(TrialProduction.status == status)
        
        # 按创建时间倒序排列
        query = query.order_by(TrialProduction.created_at.desc()).offset(skip).limit(limit)
        
        result = await db.execute(query)
        return result.scalars().all()


# 创建全局服务实例
trial_production_service = TrialProductionService()
