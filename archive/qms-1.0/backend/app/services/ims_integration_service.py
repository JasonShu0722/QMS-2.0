"""
IMS 数据集成服务
IMS Integration Service - 与内部管理系统(IMS)对接，拉取质量数据
"""
import asyncio
from datetime import date, datetime, timedelta
from typing import Optional, Dict, List, Any
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.models.ims_sync_log import IMSSyncLog, SyncType, SyncStatus


class IMSIntegrationService:
    """
    IMS 集成服务类
    
    功能：
    - 使用 HTTPX 异步客户端从 IMS 系统拉取数据
    - 支持入库检验、成品产出、制程测试等多种数据类型
    - 实现错误处理和重试机制
    - 记录同步日志用于监控和追溯
    
    设计原则：
    - 异步非阻塞：使用 async/await 模式，避免阻塞主线程
    - 容错性：网络异常时自动重试，记录详细错误信息
    - 可追溯：每次同步操作都记录日志，便于问题排查
    """
    
    def __init__(self):
        """初始化 IMS 集成服务"""
        self.base_url = settings.IMS_BASE_URL
        self.api_key = settings.IMS_API_KEY
        self.timeout = settings.IMS_TIMEOUT
        
        # 配置 HTTPX 客户端
        self.client_config = {
            "timeout": httpx.Timeout(self.timeout),
            "headers": {
                "Content-Type": "application/json",
                "X-API-Key": self.api_key if self.api_key else "",
            },
            "follow_redirects": True,
        }
    
    async def _make_request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        json_data: Optional[Dict[str, Any]] = None,
        retry_count: int = 3
    ) -> Dict[str, Any]:
        """
        发起 HTTP 请求（带重试机制）
        
        Args:
            method: HTTP 方法 (GET, POST, etc.)
            endpoint: API 端点路径
            params: URL 查询参数
            json_data: JSON 请求体
            retry_count: 重试次数
            
        Returns:
            Dict[str, Any]: API 响应数据
            
        Raises:
            httpx.HTTPError: 网络请求失败
            ValueError: IMS 配置不完整
        """
        # 检查 IMS 配置
        if not self.base_url:
            raise ValueError("IMS_BASE_URL 未配置，请在 .env 文件中设置")
        
        url = f"{self.base_url.rstrip('/')}/{endpoint.lstrip('/')}"
        
        # 重试逻辑
        last_exception = None
        for attempt in range(retry_count):
            try:
                async with httpx.AsyncClient(**self.client_config) as client:
                    response = await client.request(
                        method=method,
                        url=url,
                        params=params,
                        json=json_data
                    )
                    
                    # 检查响应状态
                    response.raise_for_status()
                    
                    # 返回 JSON 数据
                    return response.json()
                    
            except httpx.HTTPError as e:
                last_exception = e
                print(f"IMS 请求失败 (尝试 {attempt + 1}/{retry_count}): {str(e)}")
                
                # 如果不是最后一次尝试，等待后重试
                if attempt < retry_count - 1:
                    await asyncio.sleep(2 ** attempt)  # 指数退避：2秒、4秒、8秒
                    continue
                else:
                    # 最后一次尝试失败，抛出异常
                    raise
        
        # 理论上不会到达这里，但为了类型检查
        raise last_exception
    
    async def fetch_incoming_inspection_data(
        self,
        db: AsyncSession,
        start_date: date,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        拉取入库检验数据
        
        用途：
        - 计算来料批次合格率 (2.4.1)
        - 计算物料上线不良 PPM (2.4.1)
        - 自动生成 SCAR 单 (2.5.1)
        
        Args:
            db: 数据库会话
            start_date: 开始日期
            end_date: 结束日期（默认为开始日期）
            
        Returns:
            Dict[str, Any]: 包含同步结果的字典
            {
                "success": bool,
                "records_count": int,
                "data": List[Dict],
                "error": Optional[str]
            }
        """
        if end_date is None:
            end_date = start_date
        
        # 创建同步日志
        sync_log = IMSSyncLog(
            sync_type=SyncType.INCOMING_INSPECTION,
            sync_date=start_date,
            status=SyncStatus.IN_PROGRESS,
            records_count=0,
            started_at=datetime.utcnow()
        )
        db.add(sync_log)
        await db.commit()
        await db.refresh(sync_log)
        
        try:
            # 调用 IMS API
            response_data = await self._make_request(
                method="GET",
                endpoint="/api/quality/incoming-inspection",
                params={
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat()
                }
            )
            
            # 解析响应数据
            records = response_data.get("data", [])
            records_count = len(records)
            
            # 更新同步日志
            sync_log.status = SyncStatus.SUCCESS
            sync_log.records_count = records_count
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"✅ 入库检验数据同步成功: {records_count} 条记录")
            
            return {
                "success": True,
                "records_count": records_count,
                "data": records,
                "error": None
            }
            
        except Exception as e:
            # 记录错误
            error_message = f"入库检验数据同步失败: {str(e)}"
            sync_log.status = SyncStatus.FAILED
            sync_log.error_message = error_message
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"❌ {error_message}")
            
            return {
                "success": False,
                "records_count": 0,
                "data": [],
                "error": error_message
            }
    
    async def fetch_production_output_data(
        self,
        db: AsyncSession,
        start_date: date,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        拉取成品产出数据
        
        用途：
        - 计算制程不合格率 (2.4.1)
        - 计算 0KM 不良 PPM (2.4.1)
        - 试产数据自动抓取 (2.8.3)
        
        Args:
            db: 数据库会话
            start_date: 开始日期
            end_date: 结束日期（默认为开始日期）
            
        Returns:
            Dict[str, Any]: 包含同步结果的字典
        """
        if end_date is None:
            end_date = start_date
        
        # 创建同步日志
        sync_log = IMSSyncLog(
            sync_type=SyncType.PRODUCTION_OUTPUT,
            sync_date=start_date,
            status=SyncStatus.IN_PROGRESS,
            records_count=0,
            started_at=datetime.utcnow()
        )
        db.add(sync_log)
        await db.commit()
        await db.refresh(sync_log)
        
        try:
            # 调用 IMS API
            response_data = await self._make_request(
                method="GET",
                endpoint="/api/production/output",
                params={
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat()
                }
            )
            
            # 解析响应数据
            records = response_data.get("data", [])
            records_count = len(records)
            
            # 更新同步日志
            sync_log.status = SyncStatus.SUCCESS
            sync_log.records_count = records_count
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"✅ 成品产出数据同步成功: {records_count} 条记录")
            
            return {
                "success": True,
                "records_count": records_count,
                "data": records,
                "error": None
            }
            
        except Exception as e:
            # 记录错误
            error_message = f"成品产出数据同步失败: {str(e)}"
            sync_log.status = SyncStatus.FAILED
            sync_log.error_message = error_message
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"❌ {error_message}")
            
            return {
                "success": False,
                "records_count": 0,
                "data": [],
                "error": error_message
            }
    
    async def fetch_process_test_data(
        self,
        db: AsyncSession,
        start_date: date,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        拉取制程测试数据
        
        用途：
        - 计算制程直通率 (FPY) (2.4.1)
        - 一次测试通过数、一次测试总数量
        
        Args:
            db: 数据库会话
            start_date: 开始日期
            end_date: 结束日期（默认为开始日期）
            
        Returns:
            Dict[str, Any]: 包含同步结果的字典
        """
        if end_date is None:
            end_date = start_date
        
        # 创建同步日志
        sync_log = IMSSyncLog(
            sync_type=SyncType.PROCESS_TEST,
            sync_date=start_date,
            status=SyncStatus.IN_PROGRESS,
            records_count=0,
            started_at=datetime.utcnow()
        )
        db.add(sync_log)
        await db.commit()
        await db.refresh(sync_log)
        
        try:
            # 调用 IMS API
            response_data = await self._make_request(
                method="GET",
                endpoint="/api/production/process-test",
                params={
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat()
                }
            )
            
            # 解析响应数据
            records = response_data.get("data", [])
            records_count = len(records)
            
            # 更新同步日志
            sync_log.status = SyncStatus.SUCCESS
            sync_log.records_count = records_count
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"✅ 制程测试数据同步成功: {records_count} 条记录")
            
            return {
                "success": True,
                "records_count": records_count,
                "data": records,
                "error": None
            }
            
        except Exception as e:
            # 记录错误
            error_message = f"制程测试数据同步失败: {str(e)}"
            sync_log.status = SyncStatus.FAILED
            sync_log.error_message = error_message
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"❌ {error_message}")
            
            return {
                "success": False,
                "records_count": 0,
                "data": [],
                "error": error_message
            }
    
    async def sync_iqc_inspection_results(
        self,
        db: AsyncSession,
        start_date: date,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        同步 IQC 检验结果
        
        用途：
        - 为 2.4.1 质量数据中心提供计算源数据
        - 触发 NG 自动立案逻辑 (2.5.1)
        - 流向 2.5.4 绩效评分
        
        Args:
            db: 数据库会话
            start_date: 开始日期
            end_date: 结束日期（默认为开始日期）
            
        Returns:
            Dict[str, Any]: 包含同步结果的字典
            {
                "success": bool,
                "records_count": int,
                "ng_count": int,  # NG 记录数量
                "auto_scar_count": int,  # 自动创建的 SCAR 数量
                "data": List[Dict],
                "error": Optional[str]
            }
        """
        if end_date is None:
            end_date = start_date
        
        # 创建同步日志
        sync_log = IMSSyncLog(
            sync_type=SyncType.IQC_RESULTS,
            sync_date=start_date,
            status=SyncStatus.IN_PROGRESS,
            records_count=0,
            started_at=datetime.utcnow()
        )
        db.add(sync_log)
        await db.commit()
        await db.refresh(sync_log)
        
        try:
            # 调用 IMS API 获取 IQC 检验结果
            response_data = await self._make_request(
                method="GET",
                endpoint="/api/quality/iqc-inspection-results",
                params={
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat()
                }
            )
            
            # 解析响应数据
            records = response_data.get("data", [])
            records_count = len(records)
            
            # 统计 NG 记录数量
            ng_records = [r for r in records if r.get("inspection_result") == "NG"]
            ng_count = len(ng_records)
            
            # 触发 NG 自动立案逻辑
            auto_scar_count = 0
            if ng_records:
                auto_scar_result = await self.auto_create_scar_on_ng(db, ng_records)
                auto_scar_count = auto_scar_result.get("created_count", 0)
            
            # 更新同步日志
            sync_log.status = SyncStatus.SUCCESS
            sync_log.records_count = records_count
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"✅ IQC 检验结果同步成功: {records_count} 条记录, {ng_count} 条 NG, 自动创建 {auto_scar_count} 个 SCAR")
            
            return {
                "success": True,
                "records_count": records_count,
                "ng_count": ng_count,
                "auto_scar_count": auto_scar_count,
                "data": records,
                "error": None
            }
            
        except Exception as e:
            # 记录错误
            error_message = f"IQC 检验结果同步失败: {str(e)}"
            sync_log.status = SyncStatus.FAILED
            sync_log.error_message = error_message
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"❌ {error_message}")
            
            return {
                "success": False,
                "records_count": 0,
                "ng_count": 0,
                "auto_scar_count": 0,
                "data": [],
                "error": error_message
            }
    
    async def auto_create_scar_on_ng(
        self,
        db: AsyncSession,
        ng_records: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        NG 自动立案逻辑
        
        当检测到 IMS 出现"检验结果 = 不合格"时，自动生成 SCAR 单
        
        Args:
            db: 数据库会话
            ng_records: NG 检验记录列表
            
        Returns:
            Dict[str, Any]: 包含创建结果的字典
            {
                "created_count": int,
                "skipped_count": int,
                "errors": List[str]
            }
        """
        from app.models.scar import SCAR, SCARSeverity, SCARStatus
        from app.models.supplier import Supplier
        from sqlalchemy import select
        
        created_count = 0
        skipped_count = 0
        errors = []
        
        for record in ng_records:
            try:
                # 提取关键字段
                material_code = record.get("material_code")
                supplier_code = record.get("supplier_code")
                defect_description = record.get("defect_description", "IQC检验不合格")
                defect_qty = record.get("defect_qty", 0)
                batch_number = record.get("batch_number", "")
                
                # 验证必填字段
                if not material_code or not supplier_code:
                    skipped_count += 1
                    errors.append(f"记录缺少必填字段: material_code={material_code}, supplier_code={supplier_code}")
                    continue
                
                # 查询供应商 ID
                supplier_query = select(Supplier).where(Supplier.code == supplier_code)
                supplier_result = await db.execute(supplier_query)
                supplier = supplier_result.scalar_one_or_none()
                
                if not supplier:
                    skipped_count += 1
                    errors.append(f"未找到供应商: {supplier_code}")
                    continue
                
                # 生成 SCAR 编号（格式：SCAR-YYYYMMDD-XXXX）
                today = datetime.utcnow().date()
                date_str = today.strftime("%Y%m%d")
                
                # 查询当天已有的 SCAR 数量
                count_query = select(SCAR).where(
                    SCAR.scar_number.like(f"SCAR-{date_str}-%")
                )
                count_result = await db.execute(count_query)
                existing_count = len(count_result.scalars().all())
                
                # 生成序号（4位数字，从0001开始）
                sequence = str(existing_count + 1).zfill(4)
                scar_number = f"SCAR-{date_str}-{sequence}"
                
                # 判断严重度（基于不良数量）
                if defect_qty >= 100:
                    severity = SCARSeverity.CRITICAL
                elif defect_qty >= 50:
                    severity = SCARSeverity.HIGH
                elif defect_qty >= 10:
                    severity = SCARSeverity.MEDIUM
                else:
                    severity = SCARSeverity.LOW
                
                # 设置截止日期（默认7个工作日）
                deadline = datetime.utcnow() + timedelta(days=7)
                
                # 创建 SCAR 记录
                new_scar = SCAR(
                    scar_number=scar_number,
                    supplier_id=supplier.id,
                    material_code=material_code,
                    defect_description=f"{defect_description} (批次: {batch_number})",
                    defect_qty=defect_qty,
                    severity=severity,
                    status=SCARStatus.OPEN,
                    current_handler_id=None,  # 待指派
                    deadline=deadline,
                    created_by=None,  # 系统自动创建
                )
                
                db.add(new_scar)
                created_count += 1
                
                print(f"  ✅ 自动创建 SCAR: {scar_number} (供应商: {supplier.name}, 物料: {material_code})")
                
            except Exception as e:
                skipped_count += 1
                errors.append(f"创建 SCAR 失败: {str(e)}")
                print(f"  ❌ 创建 SCAR 失败: {str(e)}")
        
        # 提交所有创建的 SCAR
        if created_count > 0:
            await db.commit()
        
        return {
            "created_count": created_count,
            "skipped_count": skipped_count,
            "errors": errors
        }
    
    async def sync_special_approval_records(
        self,
        db: AsyncSession,
        start_date: date,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        同步特采记录
        
        用途：
        - 标记特采批次，用于后续追踪该批次物料在产线上的表现
        - 为质量追溯提供数据支持
        
        Args:
            db: 数据库会话
            start_date: 开始日期
            end_date: 结束日期（默认为开始日期）
            
        Returns:
            Dict[str, Any]: 包含同步结果的字典
            {
                "success": bool,
                "records_count": int,
                "data": List[Dict],
                "error": Optional[str]
            }
        """
        if end_date is None:
            end_date = start_date
        
        # 创建同步日志
        sync_log = IMSSyncLog(
            sync_type=SyncType.SPECIAL_APPROVAL,
            sync_date=start_date,
            status=SyncStatus.IN_PROGRESS,
            records_count=0,
            started_at=datetime.utcnow()
        )
        db.add(sync_log)
        await db.commit()
        await db.refresh(sync_log)
        
        try:
            # 调用 IMS API 获取特采记录
            response_data = await self._make_request(
                method="GET",
                endpoint="/api/quality/special-approval-records",
                params={
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat()
                }
            )
            
            # 解析响应数据
            records = response_data.get("data", [])
            records_count = len(records)
            
            # 更新同步日志
            sync_log.status = SyncStatus.SUCCESS
            sync_log.records_count = records_count
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"✅ 特采记录同步成功: {records_count} 条记录")
            
            return {
                "success": True,
                "records_count": records_count,
                "data": records,
                "error": None
            }
            
        except Exception as e:
            # 记录错误
            error_message = f"特采记录同步失败: {str(e)}"
            sync_log.status = SyncStatus.FAILED
            sync_log.error_message = error_message
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"❌ {error_message}")
            
            return {
                "success": False,
                "records_count": 0,
                "data": [],
                "error": error_message
            }
    
    async def sync_production_output(
        self,
        db: AsyncSession,
        start_date: date,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        同步成品入库数据（用于制程质量管理 2.6.1）
        
        用途：
        - 为核心指标计算提供准确的"分母"数据
        - 计算制程不合格率 (2.4.1)
        - 试产数据自动抓取 (2.8.3)
        
        维度要求：日期、工单号、工序、产线
        
        Args:
            db: 数据库会话
            start_date: 开始日期
            end_date: 结束日期（默认为开始日期）
            
        Returns:
            Dict[str, Any]: 包含同步结果的字典
            {
                "success": bool,
                "records_count": int,
                "data": List[Dict],  # 包含: date, work_order, process_id, line_id, output_qty
                "error": Optional[str]
            }
        """
        if end_date is None:
            end_date = start_date
        
        # 创建同步日志
        sync_log = IMSSyncLog(
            sync_type=SyncType.PRODUCTION_OUTPUT,
            sync_date=start_date,
            status=SyncStatus.IN_PROGRESS,
            records_count=0,
            started_at=datetime.utcnow()
        )
        db.add(sync_log)
        await db.commit()
        await db.refresh(sync_log)
        
        try:
            # 调用 IMS API 获取成品入库数据
            response_data = await self._make_request(
                method="GET",
                endpoint="/api/production/finished-goods-input",
                params={
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat()
                }
            )
            
            # 解析响应数据
            # 预期数据格式：
            # [
            #   {
            #     "date": "2026-02-14",
            #     "work_order": "WO202602140001",
            #     "process_id": "P001",
            #     "line_id": "LINE01",
            #     "output_qty": 1000,
            #     "product_type": "MCU"
            #   },
            #   ...
            # ]
            records = response_data.get("data", [])
            records_count = len(records)
            
            # 更新同步日志
            sync_log.status = SyncStatus.SUCCESS
            sync_log.records_count = records_count
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"✅ 成品入库数据同步成功: {records_count} 条记录")
            
            return {
                "success": True,
                "records_count": records_count,
                "data": records,
                "error": None
            }
            
        except Exception as e:
            # 记录错误
            error_message = f"成品入库数据同步失败: {str(e)}"
            sync_log.status = SyncStatus.FAILED
            sync_log.error_message = error_message
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"❌ {error_message}")
            
            return {
                "success": False,
                "records_count": 0,
                "data": [],
                "error": error_message
            }
    
    async def sync_first_pass_test(
        self,
        db: AsyncSession,
        start_date: date,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        同步一次测试数据（用于制程质量管理 2.6.1）
        
        用途：
        - 计算制程直通率 (FPY) (2.4.1)
        - 一次测试通过数、一次测试总数量
        
        维度要求：日期、工单号、工序、产线
        
        Args:
            db: 数据库会话
            start_date: 开始日期
            end_date: 结束日期（默认为开始日期）
            
        Returns:
            Dict[str, Any]: 包含同步结果的字典
            {
                "success": bool,
                "records_count": int,
                "data": List[Dict],  # 包含: date, work_order, process_id, line_id, 
                                     #        first_pass_qty, total_test_qty
                "error": Optional[str]
            }
        """
        if end_date is None:
            end_date = start_date
        
        # 创建同步日志
        sync_log = IMSSyncLog(
            sync_type=SyncType.FIRST_PASS_TEST,
            sync_date=start_date,
            status=SyncStatus.IN_PROGRESS,
            records_count=0,
            started_at=datetime.utcnow()
        )
        db.add(sync_log)
        await db.commit()
        await db.refresh(sync_log)
        
        try:
            # 调用 IMS API 获取一次测试数据
            response_data = await self._make_request(
                method="GET",
                endpoint="/api/production/first-pass-test",
                params={
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat()
                }
            )
            
            # 解析响应数据
            # 预期数据格式：
            # [
            #   {
            #     "date": "2026-02-14",
            #     "work_order": "WO202602140001",
            #     "process_id": "P001",
            #     "line_id": "LINE01",
            #     "first_pass_qty": 950,  # 一次测试通过数
            #     "total_test_qty": 1000,  # 一次测试总数量
            #     "product_type": "MCU"
            #   },
            #   ...
            # ]
            records = response_data.get("data", [])
            records_count = len(records)
            
            # 更新同步日志
            sync_log.status = SyncStatus.SUCCESS
            sync_log.records_count = records_count
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"✅ 一次测试数据同步成功: {records_count} 条记录")
            
            return {
                "success": True,
                "records_count": records_count,
                "data": records,
                "error": None
            }
            
        except Exception as e:
            # 记录错误
            error_message = f"一次测试数据同步失败: {str(e)}"
            sync_log.status = SyncStatus.FAILED
            sync_log.error_message = error_message
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"❌ {error_message}")
            
            return {
                "success": False,
                "records_count": 0,
                "data": [],
                "error": error_message
            }
    
    async def sync_process_defects(
        self,
        db: AsyncSession,
        start_date: date,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        同步制程不良记录（用于制程质量管理 2.6.1）
        
        用途：
        - 为 2.6.2 不合格品数据录入提供 IMS 自动同步的数据源
        - 支持按责任类别进行区分统计
        
        维度要求：日期、工单号、工序、产线
        
        Args:
            db: 数据库会话
            start_date: 开始日期
            end_date: 结束日期（默认为开始日期）
            
        Returns:
            Dict[str, Any]: 包含同步结果的字典
            {
                "success": bool,
                "records_count": int,
                "saved_count": int,  # 实际保存到数据库的记录数
                "data": List[Dict],  # 包含: date, work_order, process_id, line_id, 
                                     #        defect_type, defect_qty, responsibility_category
                "error": Optional[str]
            }
        """
        if end_date is None:
            end_date = start_date
        
        # 创建同步日志
        sync_log = IMSSyncLog(
            sync_type=SyncType.PROCESS_DEFECTS,
            sync_date=start_date,
            status=SyncStatus.IN_PROGRESS,
            records_count=0,
            started_at=datetime.utcnow()
        )
        db.add(sync_log)
        await db.commit()
        await db.refresh(sync_log)
        
        try:
            # 调用 IMS API 获取制程不良记录
            response_data = await self._make_request(
                method="GET",
                endpoint="/api/production/process-defects",
                params={
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat()
                }
            )
            
            # 解析响应数据
            # 预期数据格式：
            # [
            #   {
            #     "date": "2026-02-14",
            #     "work_order": "WO202602140001",
            #     "process_id": "P001",
            #     "line_id": "LINE01",
            #     "defect_type": "焊接不良",
            #     "defect_qty": 5,
            #     "responsibility_category": "operation_defect",  # 可选，IMS可能已分类
            #     "operator_id": 123,  # 可选
            #     "material_code": "MAT001",  # 可选，当责任为物料不良时
            #     "remarks": "备注信息"  # 可选
            #   },
            #   ...
            # ]
            records = response_data.get("data", [])
            records_count = len(records)
            
            # 将数据保存到 ProcessDefect 表
            from app.models.process_defect import ProcessDefect, ResponsibilityCategory
            from app.models.supplier import Supplier
            from sqlalchemy import select
            
            saved_count = 0
            errors = []
            
            for record in records:
                try:
                    # 提取字段
                    defect_date_str = record.get("date")
                    work_order = record.get("work_order")
                    process_id = record.get("process_id")
                    line_id = record.get("line_id")
                    defect_type = record.get("defect_type")
                    defect_qty = record.get("defect_qty", 0)
                    responsibility_category = record.get("responsibility_category", "operation_defect")
                    operator_id = record.get("operator_id")
                    material_code = record.get("material_code")
                    remarks = record.get("remarks")
                    
                    # 验证必填字段
                    if not all([defect_date_str, work_order, process_id, line_id, defect_type]):
                        errors.append(f"记录缺少必填字段: {record}")
                        continue
                    
                    # 转换日期
                    defect_date = datetime.strptime(defect_date_str, "%Y-%m-%d").date()
                    
                    # 查询供应商ID（如果是物料不良且提供了物料编码）
                    supplier_id = None
                    if responsibility_category == "material_defect" and material_code:
                        # 这里简化处理，实际应该通过物料编码查询供应商
                        # 可以从 IMS 返回的数据中直接获取 supplier_code
                        supplier_code = record.get("supplier_code")
                        if supplier_code:
                            supplier_query = select(Supplier).where(Supplier.code == supplier_code)
                            supplier_result = await db.execute(supplier_query)
                            supplier = supplier_result.scalar_one_or_none()
                            if supplier:
                                supplier_id = supplier.id
                    
                    # 创建 ProcessDefect 记录
                    process_defect = ProcessDefect(
                        defect_date=defect_date,
                        work_order=work_order,
                        process_id=process_id,
                        line_id=line_id,
                        defect_type=defect_type,
                        defect_qty=defect_qty,
                        responsibility_category=responsibility_category,
                        operator_id=operator_id,
                        recorded_by=1,  # 系统自动同步，使用系统账号ID
                        material_code=material_code,
                        supplier_id=supplier_id,
                        remarks=remarks
                    )
                    
                    db.add(process_defect)
                    saved_count += 1
                    
                except Exception as e:
                    errors.append(f"保存记录失败: {str(e)}")
                    print(f"  ❌ 保存制程不良记录失败: {str(e)}")
            
            # 提交所有保存的记录
            if saved_count > 0:
                await db.commit()
            
            # 更新同步日志
            sync_log.status = SyncStatus.SUCCESS if saved_count == records_count else SyncStatus.PARTIAL
            sync_log.records_count = records_count
            if errors:
                sync_log.error_message = f"部分记录保存失败: {'; '.join(errors[:5])}"  # 只记录前5个错误
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"✅ 制程不良记录同步成功: {records_count} 条记录, 保存 {saved_count} 条")
            
            return {
                "success": True,
                "records_count": records_count,
                "saved_count": saved_count,
                "data": records,
                "error": None if not errors else f"部分记录保存失败: {len(errors)} 条"
            }
            
        except Exception as e:
            # 记录错误
            error_message = f"制程不良记录同步失败: {str(e)}"
            sync_log.status = SyncStatus.FAILED
            sync_log.error_message = error_message
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"❌ {error_message}")
            
            return {
                "success": False,
                "records_count": 0,
                "saved_count": 0,
                "data": [],
                "error": error_message
            }
    
    async def sync_shipment_data(
        self,
        db: AsyncSession,
        start_date: date,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        同步发货数据（用于客户质量管理 2.7.1）
        
        用途：
        - 计算 0KM 不良 PPM (2.4.1)
        - 计算 3MIS 售后不良 PPM（滚动3个月）(2.4.1)
        - 计算 12MIS 售后不良 PPM（滚动12个月）(2.4.1)
        
        维护策略：
        - 保留过去 24 个月的分月出货数据
        - 每日从 IMS/ERP/SAP 同步发货记录
        
        核心字段：客户代码、产品类型、出货日期、出货数量
        
        Args:
            db: 数据库会话
            start_date: 开始日期
            end_date: 结束日期（默认为开始日期）
            
        Returns:
            Dict[str, Any]: 包含同步结果的字典
            {
                "success": bool,
                "records_count": int,
                "saved_count": int,  # 实际保存到数据库的记录数
                "data": List[Dict],  # 包含: customer_code, product_type, shipment_date, shipment_qty
                "error": Optional[str]
            }
        """
        if end_date is None:
            end_date = start_date
        
        # 创建同步日志
        sync_log = IMSSyncLog(
            sync_type=SyncType.SHIPMENT_DATA,
            sync_date=start_date,
            status=SyncStatus.IN_PROGRESS,
            records_count=0,
            started_at=datetime.utcnow()
        )
        db.add(sync_log)
        await db.commit()
        await db.refresh(sync_log)
        
        try:
            # 调用 IMS/ERP/SAP API 获取发货记录
            response_data = await self._make_request(
                method="GET",
                endpoint="/api/shipment/records",
                params={
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat()
                }
            )
            
            # 解析响应数据
            # 预期数据格式：
            # [
            #   {
            #     "customer_code": "CUST001",
            #     "product_type": "MCU",
            #     "shipment_date": "2026-02-14",
            #     "shipment_qty": 5000,
            #     "work_order": "WO202602140001",  # 可选
            #     "batch_number": "BATCH001",  # 可选
            #     "destination": "上海工厂"  # 可选
            #   },
            #   ...
            # ]
            records = response_data.get("data", [])
            records_count = len(records)
            
            # 将数据保存到 ShipmentData 表
            from app.models.shipment_data import ShipmentData
            from sqlalchemy import select
            
            saved_count = 0
            errors = []
            
            for record in records:
                try:
                    # 提取字段
                    customer_code = record.get("customer_code")
                    product_type = record.get("product_type")
                    shipment_date_str = record.get("shipment_date")
                    shipment_qty = record.get("shipment_qty", 0)
                    work_order = record.get("work_order")
                    batch_number = record.get("batch_number")
                    destination = record.get("destination")
                    
                    # 验证必填字段
                    if not all([customer_code, product_type, shipment_date_str]):
                        errors.append(f"记录缺少必填字段: {record}")
                        continue
                    
                    # 转换日期
                    shipment_date = datetime.strptime(shipment_date_str, "%Y-%m-%d").date()
                    
                    # 检查是否已存在相同记录（避免重复插入）
                    existing_query = select(ShipmentData).where(
                        ShipmentData.customer_code == customer_code,
                        ShipmentData.product_type == product_type,
                        ShipmentData.shipment_date == shipment_date,
                        ShipmentData.work_order == work_order
                    )
                    existing_result = await db.execute(existing_query)
                    existing_record = existing_result.scalar_one_or_none()
                    
                    if existing_record:
                        # 更新现有记录
                        existing_record.shipment_qty = shipment_qty
                        existing_record.batch_number = batch_number
                        existing_record.destination = destination
                        existing_record.updated_at = datetime.utcnow()
                    else:
                        # 创建新记录
                        shipment_data = ShipmentData(
                            customer_code=customer_code,
                            product_type=product_type,
                            shipment_date=shipment_date,
                            shipment_qty=shipment_qty,
                            work_order=work_order,
                            batch_number=batch_number,
                            destination=destination
                        )
                        db.add(shipment_data)
                    
                    saved_count += 1
                    
                except Exception as e:
                    errors.append(f"保存记录失败: {str(e)}")
                    print(f"  ❌ 保存发货记录失败: {str(e)}")
            
            # 提交所有保存的记录
            if saved_count > 0:
                await db.commit()
            
            # 清理超过24个月的旧数据
            await self._cleanup_old_shipment_data(db)
            
            # 更新同步日志
            sync_log.status = SyncStatus.SUCCESS if saved_count == records_count else SyncStatus.PARTIAL
            sync_log.records_count = records_count
            if errors:
                sync_log.error_message = f"部分记录保存失败: {'; '.join(errors[:5])}"  # 只记录前5个错误
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"✅ 发货数据同步成功: {records_count} 条记录, 保存 {saved_count} 条")
            
            return {
                "success": True,
                "records_count": records_count,
                "saved_count": saved_count,
                "data": records,
                "error": None if not errors else f"部分记录保存失败: {len(errors)} 条"
            }
            
        except Exception as e:
            # 记录错误
            error_message = f"发货数据同步失败: {str(e)}"
            sync_log.status = SyncStatus.FAILED
            sync_log.error_message = error_message
            sync_log.completed_at = datetime.utcnow()
            await db.commit()
            
            print(f"❌ {error_message}")
            
            return {
                "success": False,
                "records_count": 0,
                "saved_count": 0,
                "data": [],
                "error": error_message
            }
    
    async def _cleanup_old_shipment_data(self, db: AsyncSession) -> int:
        """
        清理超过24个月的旧发货数据
        
        Args:
            db: 数据库会话
            
        Returns:
            int: 删除的记录数量
        """
        from app.models.shipment_data import ShipmentData
        from sqlalchemy import delete
        
        # 计算24个月前的日期
        cutoff_date = date.today() - timedelta(days=24 * 30)  # 约24个月
        
        # 删除旧数据
        delete_stmt = delete(ShipmentData).where(ShipmentData.shipment_date < cutoff_date)
        result = await db.execute(delete_stmt)
        await db.commit()
        
        deleted_count = result.rowcount
        if deleted_count > 0:
            print(f"🗑️ 清理旧发货数据: 删除 {deleted_count} 条记录（{cutoff_date} 之前）")
        
        return deleted_count
    
    async def sync_all_data(
        self,
        db: AsyncSession,
        target_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        同步所有类型的数据（用于 Celery 定时任务）
        
        Args:
            db: 数据库会话
            target_date: 目标日期（默认为昨天）
            
        Returns:
            Dict[str, Any]: 包含所有同步结果的汇总
        """
        if target_date is None:
            # 默认同步昨天的数据
            target_date = date.today() - timedelta(days=1)
        
        print(f"🔄 开始同步 IMS 数据: {target_date}")
        
        results = {
            "date": target_date.isoformat(),
            "started_at": datetime.utcnow().isoformat(),
            "incoming_inspection": None,
            "production_output": None,
            "process_test": None,
            "iqc_results": None,
            "special_approval": None,
            "sync_production_output": None,
            "sync_first_pass_test": None,
            "sync_process_defects": None,
            "sync_shipment_data": None,
            "overall_success": False
        }
        
        # 1. 同步入库检验数据
        incoming_result = await self.fetch_incoming_inspection_data(
            db=db,
            start_date=target_date
        )
        results["incoming_inspection"] = incoming_result
        
        # 2. 同步成品产出数据（旧方法，保持兼容）
        output_result = await self.fetch_production_output_data(
            db=db,
            start_date=target_date
        )
        results["production_output"] = output_result
        
        # 3. 同步制程测试数据
        test_result = await self.fetch_process_test_data(
            db=db,
            start_date=target_date
        )
        results["process_test"] = test_result
        
        # 4. 同步 IQC 检验结果
        iqc_result = await self.sync_iqc_inspection_results(
            db=db,
            start_date=target_date
        )
        results["iqc_results"] = iqc_result
        
        # 5. 同步特采记录
        special_approval_result = await self.sync_special_approval_records(
            db=db,
            start_date=target_date
        )
        results["special_approval"] = special_approval_result
        
        # 6. 同步成品入库数据（新方法，用于制程质量管理）
        sync_production_result = await self.sync_production_output(
            db=db,
            start_date=target_date
        )
        results["sync_production_output"] = sync_production_result
        
        # 7. 同步一次测试数据（新方法，用于制程质量管理）
        sync_first_pass_result = await self.sync_first_pass_test(
            db=db,
            start_date=target_date
        )
        results["sync_first_pass_test"] = sync_first_pass_result
        
        # 8. 同步制程不良记录（新方法，用于制程质量管理）
        sync_defects_result = await self.sync_process_defects(
            db=db,
            start_date=target_date
        )
        results["sync_process_defects"] = sync_defects_result
        
        # 9. 同步发货数据（新方法，用于客户质量管理）
        sync_shipment_result = await self.sync_shipment_data(
            db=db,
            start_date=target_date
        )
        results["sync_shipment_data"] = sync_shipment_result
        
        # 判断整体是否成功
        results["overall_success"] = all([
            incoming_result["success"],
            output_result["success"],
            test_result["success"],
            iqc_result["success"],
            special_approval_result["success"],
            sync_production_result["success"],
            sync_first_pass_result["success"],
            sync_defects_result["success"],
            sync_shipment_result["success"]
        ])
        
        results["completed_at"] = datetime.utcnow().isoformat()
        
        if results["overall_success"]:
            print(f"✅ IMS 数据同步完成: {target_date}")
        else:
            print(f"⚠️ IMS 数据同步部分失败: {target_date}")
        
        return results
    
    async def get_sync_history(
        self,
        db: AsyncSession,
        sync_type: Optional[SyncType] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        limit: int = 50
    ) -> List[IMSSyncLog]:
        """
        查询同步历史记录
        
        Args:
            db: 数据库会话
            sync_type: 同步类型（可选）
            start_date: 开始日期（可选）
            end_date: 结束日期（可选）
            limit: 返回记录数量限制
            
        Returns:
            List[IMSSyncLog]: 同步日志列表
        """
        query = select(IMSSyncLog)
        
        # 添加筛选条件
        if sync_type:
            query = query.where(IMSSyncLog.sync_type == sync_type)
        
        if start_date:
            query = query.where(IMSSyncLog.sync_date >= start_date)
        
        if end_date:
            query = query.where(IMSSyncLog.sync_date <= end_date)
        
        # 按创建时间倒序排列
        query = query.order_by(IMSSyncLog.created_at.desc()).limit(limit)
        
        result = await db.execute(query)
        return result.scalars().all()
    
    async def fetch_trial_production_data(
        self,
        work_order: str,
        target_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        根据工单号获取试产数据
        
        用途：
        - 为试产记录提供IMS数据（投入数、产出数、一次合格数、不良数）
        - 支持2.8.3试产目标与实绩管理
        
        Args:
            work_order: IMS工单号
            target_date: 目标日期（默认为当前日期）
            
        Returns:
            Dict[str, Any]: 包含试产数据的字典
            {
                "success": bool,
                "work_order": str,
                "data": Optional[Dict],  # 包含: input_qty, output_qty, first_pass_qty, defect_qty
                "error": Optional[str]
            }
        """
        if target_date is None:
            target_date = date.today()
        
        try:
            # 调用IMS API获取工单数据
            response_data = await self._make_request(
                method="GET",
                endpoint="/api/production/work-order-details",
                params={
                    "work_order": work_order,
                    "date": target_date.isoformat()
                }
            )
            
            # 解析响应数据
            # 预期数据格式：
            # {
            #   "work_order": "WO202602140001",
            #   "date": "2026-02-14",
            #   "input_qty": 1000,  # 投入数
            #   "output_qty": 950,  # 产出数
            #   "first_pass_qty": 920,  # 一次测试通过数
            #   "total_test_qty": 1000,  # 一次测试总数量
            #   "defect_qty": 30,  # 不良数
            #   "product_type": "MCU",
            #   "line_id": "LINE01"
            # }
            work_order_data = response_data.get("data")
            
            if not work_order_data:
                return {
                    "success": False,
                    "work_order": work_order,
                    "data": None,
                    "error": f"未找到工单号 {work_order} 的数据"
                }
            
            print(f"✅ 获取试产数据成功: 工单号={work_order}")
            
            return {
                "success": True,
                "work_order": work_order,
                "data": work_order_data,
                "error": None
            }
            
        except Exception as e:
            error_message = f"获取试产数据失败: {str(e)}"
            print(f"❌ {error_message}")
            
            return {
                "success": False,
                "work_order": work_order,
                "data": None,
                "error": error_message
            }


# 创建全局 IMS 集成服务实例
ims_integration_service = IMSIntegrationService()
