"""
质量指标计算引擎
Metrics Calculator - 根据 IMS 同步的数据计算各类质量指标
"""
from datetime import date, datetime, timedelta
from typing import Optional, Dict, List, Any
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_

from app.models.quality_metric import QualityMetric, MetricType


class MetricsCalculator:
    """
    质量指标计算引擎
    
    功能：
    - 根据 IMS 同步的原始数据计算各类质量指标
    - 支持按供应商、产品类型、工序、线体进行分类统计
    - 自动存储计算结果到 quality_metrics 表
    
    计算公式（来自 product.md 2.4.1）：
    1. 来料批次合格率 = ((物料入库批次数-物料入库不合格批次数) / 物料入库批次数) * 100%
    2. 物料上线不良PPM = (物料上线不良数 / 物料入库总数量) * 1,000,000
    3. 制程不合格率 = (完成制程不合格品数 / 成品产出入库数) * 100%
    4. 制程直通率 = (一次测试通过数 / 一次测试总数量) * 100%
    5. 0KM不良PPM = (0KM客诉数 / 成品出库总量) * 1,000,000
    6. 3MIS售后不良PPM = (3mis客诉数 / 3个月滚动出货量) * 1,000,000
    7. 12MIS售后不良PPM = (12mis客诉数 / 12个月滚动出货量) * 1,000,000
    """
    
    def __init__(self):
        """初始化计算引擎"""
        pass
    
    async def calculate_incoming_batch_pass_rate(
        self,
        db: AsyncSession,
        target_date: date,
        supplier_id: Optional[int] = None,
        product_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        计算来料批次合格率
        
        公式：((物料入库批次数-物料入库不合格批次数) / 物料入库批次数) * 100%
        
        注：
        - 按供应商进行区分统计并计算总数
        - 按日、月统计推移并合计年度数据
        
        Args:
            db: 数据库会话
            target_date: 目标日期
            supplier_id: 供应商ID（可选，用于按供应商统计）
            product_type: 产品类型（可选，用于按产品类型统计）
            
        Returns:
            Dict[str, Any]: 计算结果
            {
                "success": bool,
                "metric_type": str,
                "date": str,
                "value": float,
                "total_batches": int,
                "ng_batches": int,
                "supplier_id": Optional[int],
                "product_type": Optional[str]
            }
        """
        # TODO: 实际实现需要从 IMS 同步的数据表中查询
        # 这里提供计算逻辑框架
        
        # 示例：假设从 incoming_inspection_records 表查询
        # total_batches = 查询该日期的总批次数
        # ng_batches = 查询该日期的不合格批次数
        
        # 模拟数据（实际应从数据库查询）
        total_batches = 100  # 示例值
        ng_batches = 5  # 示例值
        
        # 计算合格率
        if total_batches == 0:
            pass_rate = 0.0
        else:
            pass_rate = ((total_batches - ng_batches) / total_batches) * 100.0
        
        # 创建或更新质量指标记录
        metric = QualityMetric(
            metric_type=MetricType.INCOMING_BATCH_PASS_RATE,
            metric_date=target_date,
            value=Decimal(str(pass_rate)),
            supplier_id=supplier_id,
            product_type=product_type,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(metric)
        await db.commit()
        await db.refresh(metric)
        
        return {
            "success": True,
            "metric_type": MetricType.INCOMING_BATCH_PASS_RATE.value,
            "date": target_date.isoformat(),
            "value": pass_rate,
            "total_batches": total_batches,
            "ng_batches": ng_batches,
            "supplier_id": supplier_id,
            "product_type": product_type,
            "metric_id": metric.id
        }
    
    async def calculate_material_online_ppm(
        self,
        db: AsyncSession,
        target_date: date,
        supplier_id: Optional[int] = None,
        product_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        计算物料上线不良 PPM
        
        公式：(物料上线不良数 / 物料入库总数量) * 1,000,000
        
        注：
        - 按供应商进行区分统计并计算总数
        - 可实现按物料类型分类统计
        - 按日、月统计推移并合计年度数据
        
        Args:
            db: 数据库会话
            target_date: 目标日期
            supplier_id: 供应商ID（可选）
            product_type: 产品类型（可选）
            
        Returns:
            Dict[str, Any]: 计算结果
        """
        # TODO: 从 IMS 数据表查询
        # online_defects = 查询物料上线不良数
        # total_incoming_qty = 查询物料入库总数量
        
        # 模拟数据
        online_defects = 50  # 示例值
        total_incoming_qty = 100000  # 示例值
        
        # 计算 PPM
        if total_incoming_qty == 0:
            ppm = 0.0
        else:
            ppm = (online_defects / total_incoming_qty) * 1_000_000
        
        # 创建质量指标记录
        metric = QualityMetric(
            metric_type=MetricType.MATERIAL_ONLINE_PPM,
            metric_date=target_date,
            value=Decimal(str(ppm)),
            supplier_id=supplier_id,
            product_type=product_type,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(metric)
        await db.commit()
        await db.refresh(metric)
        
        return {
            "success": True,
            "metric_type": MetricType.MATERIAL_ONLINE_PPM.value,
            "date": target_date.isoformat(),
            "value": ppm,
            "online_defects": online_defects,
            "total_incoming_qty": total_incoming_qty,
            "supplier_id": supplier_id,
            "product_type": product_type,
            "metric_id": metric.id
        }
    
    async def calculate_process_defect_rate(
        self,
        db: AsyncSession,
        target_date: date,
        line_id: Optional[str] = None,
        process_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        计算制程不合格率
        
        公式：(完成制程不合格品数 / 成品产出入库数) * 100%
        
        注：
        - 按责任类别、工序、线体进行区分统计并计算总数
        - 按日、月统计推移并合计年度数据
        
        Args:
            db: 数据库会话
            target_date: 目标日期
            line_id: 产线ID（可选）
            process_id: 工序ID（可选）
            
        Returns:
            Dict[str, Any]: 计算结果
        """
        # TODO: 从 IMS 数据表查询
        # process_ng_count = 查询制程不合格品数
        # finished_goods_count = 查询成品产出入库数
        
        # 模拟数据
        process_ng_count = 120  # 示例值
        finished_goods_count = 10000  # 示例值
        
        # 计算不合格率
        if finished_goods_count == 0:
            defect_rate = 0.0
        else:
            defect_rate = (process_ng_count / finished_goods_count) * 100.0
        
        # 创建质量指标记录
        metric = QualityMetric(
            metric_type=MetricType.PROCESS_DEFECT_RATE,
            metric_date=target_date,
            value=Decimal(str(defect_rate)),
            line_id=line_id,
            process_id=process_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(metric)
        await db.commit()
        await db.refresh(metric)
        
        return {
            "success": True,
            "metric_type": MetricType.PROCESS_DEFECT_RATE.value,
            "date": target_date.isoformat(),
            "value": defect_rate,
            "process_ng_count": process_ng_count,
            "finished_goods_count": finished_goods_count,
            "line_id": line_id,
            "process_id": process_id,
            "metric_id": metric.id
        }
    
    async def calculate_process_fpy(
        self,
        db: AsyncSession,
        target_date: date,
        line_id: Optional[str] = None,
        process_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        计算制程直通率 (First Pass Yield)
        
        公式：(一次测试通过数 / 一次测试总数量) * 100%
        
        注：
        - 按责任类别、工序、线体进行区分统计并计算总数
        - 按日、月统计推移并合计年度数据
        
        Args:
            db: 数据库会话
            target_date: 目标日期
            line_id: 产线ID（可选）
            process_id: 工序ID（可选）
            
        Returns:
            Dict[str, Any]: 计算结果
        """
        # TODO: 从 IMS 数据表查询
        # first_pass_count = 查询一次测试通过数
        # total_test_count = 查询一次测试总数量
        
        # 模拟数据
        first_pass_count = 9500  # 示例值
        total_test_count = 10000  # 示例值
        
        # 计算直通率
        if total_test_count == 0:
            fpy = 0.0
        else:
            fpy = (first_pass_count / total_test_count) * 100.0
        
        # 创建质量指标记录
        metric = QualityMetric(
            metric_type=MetricType.PROCESS_FPY,
            metric_date=target_date,
            value=Decimal(str(fpy)),
            line_id=line_id,
            process_id=process_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(metric)
        await db.commit()
        await db.refresh(metric)
        
        return {
            "success": True,
            "metric_type": MetricType.PROCESS_FPY.value,
            "date": target_date.isoformat(),
            "value": fpy,
            "first_pass_count": first_pass_count,
            "total_test_count": total_test_count,
            "line_id": line_id,
            "process_id": process_id,
            "metric_id": metric.id
        }
    
    async def calculate_0km_ppm(
        self,
        db: AsyncSession,
        target_date: date,
        product_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        计算 0KM 不良 PPM
        
        公式：(0KM客诉数 / 成品出库总量) * 1,000,000
        
        注：
        - 按产品类型进行区分统计并计算总数
        - 按日、月滚动推移并合计年度数据
        
        Args:
            db: 数据库会话
            target_date: 目标日期
            product_type: 产品类型（可选）
            
        Returns:
            Dict[str, Any]: 计算结果
        """
        # TODO: 从客诉数据表和出货数据表查询
        # okm_complaint_count = 查询0KM客诉数
        # total_shipment_qty = 查询成品出库总量
        
        # 模拟数据
        okm_complaint_count = 10  # 示例值
        total_shipment_qty = 50000  # 示例值
        
        # 计算 0KM PPM
        if total_shipment_qty == 0:
            okm_ppm = 0.0
        else:
            okm_ppm = (okm_complaint_count / total_shipment_qty) * 1_000_000
        
        # 创建质量指标记录
        metric = QualityMetric(
            metric_type=MetricType.OKM_PPM,
            metric_date=target_date,
            value=Decimal(str(okm_ppm)),
            product_type=product_type,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(metric)
        await db.commit()
        await db.refresh(metric)
        
        return {
            "success": True,
            "metric_type": MetricType.OKM_PPM.value,
            "date": target_date.isoformat(),
            "value": okm_ppm,
            "okm_complaint_count": okm_complaint_count,
            "total_shipment_qty": total_shipment_qty,
            "product_type": product_type,
            "metric_id": metric.id
        }
    
    async def calculate_3mis_ppm(
        self,
        db: AsyncSession,
        target_date: date,
        product_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        计算 3MIS 售后不良 PPM（滚动 3 个月）
        
        公式：(3mis客诉数 / 3个月滚动出货量) * 1,000,000
        
        注：
        - 按产品类型进行区分统计并计算总数
        - 月度滚动推移
        
        Args:
            db: 数据库会话
            target_date: 目标日期
            product_type: 产品类型（可选）
            
        Returns:
            Dict[str, Any]: 计算结果
        """
        # 计算滚动3个月的日期范围
        end_date = target_date
        start_date = target_date - timedelta(days=90)  # 约3个月
        
        # TODO: 从客诉数据表和出货数据表查询
        # 查询过去3个月的客诉数和出货量
        # mis_3_complaint_count = 查询3个月内的售后客诉数
        # rolling_3m_shipment_qty = 查询3个月滚动出货量
        
        # 模拟数据
        mis_3_complaint_count = 15  # 示例值
        rolling_3m_shipment_qty = 150000  # 示例值
        
        # 计算 3MIS PPM
        if rolling_3m_shipment_qty == 0:
            mis_3_ppm = 0.0
        else:
            mis_3_ppm = (mis_3_complaint_count / rolling_3m_shipment_qty) * 1_000_000
        
        # 创建质量指标记录
        metric = QualityMetric(
            metric_type=MetricType.MIS_3_PPM,
            metric_date=target_date,
            value=Decimal(str(mis_3_ppm)),
            product_type=product_type,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(metric)
        await db.commit()
        await db.refresh(metric)
        
        return {
            "success": True,
            "metric_type": MetricType.MIS_3_PPM.value,
            "date": target_date.isoformat(),
            "value": mis_3_ppm,
            "mis_3_complaint_count": mis_3_complaint_count,
            "rolling_3m_shipment_qty": rolling_3m_shipment_qty,
            "rolling_period": f"{start_date.isoformat()} to {end_date.isoformat()}",
            "product_type": product_type,
            "metric_id": metric.id
        }
    
    async def calculate_12mis_ppm(
        self,
        db: AsyncSession,
        target_date: date,
        product_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        计算 12MIS 售后不良 PPM（滚动 12 个月）
        
        公式：(12mis客诉数 / 12个月滚动出货量) * 1,000,000
        
        注：
        - 按产品类型进行区分统计并计算总数
        - 月度滚动推移
        
        Args:
            db: 数据库会话
            target_date: 目标日期
            product_type: 产品类型（可选）
            
        Returns:
            Dict[str, Any]: 计算结果
        """
        # 计算滚动12个月的日期范围
        end_date = target_date
        start_date = target_date - timedelta(days=365)  # 约12个月
        
        # TODO: 从客诉数据表和出货数据表查询
        # 查询过去12个月的客诉数和出货量
        # mis_12_complaint_count = 查询12个月内的售后客诉数
        # rolling_12m_shipment_qty = 查询12个月滚动出货量
        
        # 模拟数据
        mis_12_complaint_count = 50  # 示例值
        rolling_12m_shipment_qty = 600000  # 示例值
        
        # 计算 12MIS PPM
        if rolling_12m_shipment_qty == 0:
            mis_12_ppm = 0.0
        else:
            mis_12_ppm = (mis_12_complaint_count / rolling_12m_shipment_qty) * 1_000_000
        
        # 创建质量指标记录
        metric = QualityMetric(
            metric_type=MetricType.MIS_12_PPM,
            metric_date=target_date,
            value=Decimal(str(mis_12_ppm)),
            product_type=product_type,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(metric)
        await db.commit()
        await db.refresh(metric)
        
        return {
            "success": True,
            "metric_type": MetricType.MIS_12_PPM.value,
            "date": target_date.isoformat(),
            "value": mis_12_ppm,
            "mis_12_complaint_count": mis_12_complaint_count,
            "rolling_12m_shipment_qty": rolling_12m_shipment_qty,
            "rolling_period": f"{start_date.isoformat()} to {end_date.isoformat()}",
            "product_type": product_type,
            "metric_id": metric.id
        }
    
    async def calculate_all_metrics(
        self,
        db: AsyncSession,
        target_date: date,
        supplier_ids: Optional[List[int]] = None,
        product_types: Optional[List[str]] = None,
        line_ids: Optional[List[str]] = None,
        process_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        计算所有质量指标（用于 Celery 定时任务）
        
        按供应商、产品类型、工序、线体进行分类统计
        
        Args:
            db: 数据库会话
            target_date: 目标日期
            supplier_ids: 供应商ID列表（可选）
            product_types: 产品类型列表（可选）
            line_ids: 产线ID列表（可选）
            process_ids: 工序ID列表（可选）
            
        Returns:
            Dict[str, Any]: 所有指标的计算结果汇总
        """
        print(f"🔄 开始计算质量指标: {target_date}")
        
        results = {
            "date": target_date.isoformat(),
            "started_at": datetime.utcnow().isoformat(),
            "metrics": [],
            "overall_success": True
        }
        
        try:
            # 1. 计算来料批次合格率（按供应商）
            if supplier_ids:
                for supplier_id in supplier_ids:
                    result = await self.calculate_incoming_batch_pass_rate(
                        db=db,
                        target_date=target_date,
                        supplier_id=supplier_id
                    )
                    results["metrics"].append(result)
            else:
                # 计算总体指标
                result = await self.calculate_incoming_batch_pass_rate(
                    db=db,
                    target_date=target_date
                )
                results["metrics"].append(result)
            
            # 2. 计算物料上线不良 PPM（按供应商）
            if supplier_ids:
                for supplier_id in supplier_ids:
                    result = await self.calculate_material_online_ppm(
                        db=db,
                        target_date=target_date,
                        supplier_id=supplier_id
                    )
                    results["metrics"].append(result)
            else:
                result = await self.calculate_material_online_ppm(
                    db=db,
                    target_date=target_date
                )
                results["metrics"].append(result)
            
            # 3. 计算制程不合格率（按产线和工序）
            if line_ids and process_ids:
                for line_id in line_ids:
                    for process_id in process_ids:
                        result = await self.calculate_process_defect_rate(
                            db=db,
                            target_date=target_date,
                            line_id=line_id,
                            process_id=process_id
                        )
                        results["metrics"].append(result)
            else:
                result = await self.calculate_process_defect_rate(
                    db=db,
                    target_date=target_date
                )
                results["metrics"].append(result)
            
            # 4. 计算制程直通率（按产线和工序）
            if line_ids and process_ids:
                for line_id in line_ids:
                    for process_id in process_ids:
                        result = await self.calculate_process_fpy(
                            db=db,
                            target_date=target_date,
                            line_id=line_id,
                            process_id=process_id
                        )
                        results["metrics"].append(result)
            else:
                result = await self.calculate_process_fpy(
                    db=db,
                    target_date=target_date
                )
                results["metrics"].append(result)
            
            # 5. 计算 0KM 不良 PPM（按产品类型）
            if product_types:
                for product_type in product_types:
                    result = await self.calculate_0km_ppm(
                        db=db,
                        target_date=target_date,
                        product_type=product_type
                    )
                    results["metrics"].append(result)
            else:
                result = await self.calculate_0km_ppm(
                    db=db,
                    target_date=target_date
                )
                results["metrics"].append(result)
            
            # 6. 计算 3MIS 售后不良 PPM（按产品类型）
            if product_types:
                for product_type in product_types:
                    result = await self.calculate_3mis_ppm(
                        db=db,
                        target_date=target_date,
                        product_type=product_type
                    )
                    results["metrics"].append(result)
            else:
                result = await self.calculate_3mis_ppm(
                    db=db,
                    target_date=target_date
                )
                results["metrics"].append(result)
            
            # 7. 计算 12MIS 售后不良 PPM（按产品类型）
            if product_types:
                for product_type in product_types:
                    result = await self.calculate_12mis_ppm(
                        db=db,
                        target_date=target_date,
                        product_type=product_type
                    )
                    results["metrics"].append(result)
            else:
                result = await self.calculate_12mis_ppm(
                    db=db,
                    target_date=target_date
                )
                results["metrics"].append(result)
            
            print(f"✅ 质量指标计算完成: {target_date}, 共 {len(results['metrics'])} 个指标")
            
        except Exception as e:
            print(f"❌ 质量指标计算失败: {str(e)}")
            results["overall_success"] = False
            results["error"] = str(e)
        
        results["completed_at"] = datetime.utcnow().isoformat()
        
        return results
    
    async def get_metric_trend(
        self,
        db: AsyncSession,
        metric_type: MetricType,
        start_date: date,
        end_date: date,
        supplier_id: Optional[int] = None,
        product_type: Optional[str] = None,
        line_id: Optional[str] = None,
        process_id: Optional[str] = None
    ) -> List[QualityMetric]:
        """
        查询指标趋势数据
        
        Args:
            db: 数据库会话
            metric_type: 指标类型
            start_date: 开始日期
            end_date: 结束日期
            supplier_id: 供应商ID（可选）
            product_type: 产品类型（可选）
            line_id: 产线ID（可选）
            process_id: 工序ID（可选）
            
        Returns:
            List[QualityMetric]: 指标记录列表
        """
        query = select(QualityMetric).where(
            and_(
                QualityMetric.metric_type == metric_type,
                QualityMetric.metric_date >= start_date,
                QualityMetric.metric_date <= end_date
            )
        )
        
        # 添加筛选条件
        if supplier_id:
            query = query.where(QualityMetric.supplier_id == supplier_id)
        
        if product_type:
            query = query.where(QualityMetric.product_type == product_type)
        
        if line_id:
            query = query.where(QualityMetric.line_id == line_id)
        
        if process_id:
            query = query.where(QualityMetric.process_id == process_id)
        
        # 按日期排序
        query = query.order_by(QualityMetric.metric_date.asc())
        
        result = await db.execute(query)
        return result.scalars().all()


# 创建全局计算引擎实例
metrics_calculator = MetricsCalculator()
