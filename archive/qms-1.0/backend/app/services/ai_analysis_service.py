"""
AI 智能诊断服务
AI Analysis Service - 集成 OpenAI API / DeepSeek 实现异常诊断和自然语言查询

Requirements: 2.4.4
"""
from typing import Optional, Dict, Any, List
from datetime import date, datetime, timedelta
import json
import logging
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, and_

from app.core.config import settings
from app.models.quality_metric import QualityMetric, MetricType
from app.models.supplier import Supplier

logger = logging.getLogger(__name__)


class AIAnalysisService:
    """
    AI 智能诊断服务类
    
    功能：
    1. 异常自动寻源：当指标飙升时自动分析原因
    2. 自然语言查询：将用户提问转换为 SQL 查询
    3. 生成趋势图表：根据用户描述生成图表配置
    """
    
    def __init__(self):
        """初始化 AI 客户端"""
        if not settings.OPENAI_API_KEY:
            logger.warning("OPENAI_API_KEY 未配置，AI 功能将不可用")
            self.client = None
        else:
            # 支持 OpenAI 和 DeepSeek 等兼容接口
            self.client = AsyncOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_BASE_URL  # 如果为 None，使用默认 OpenAI 地址
            )
    
    def _is_available(self) -> bool:
        """检查 AI 服务是否可用"""
        return self.client is not None
    
    async def analyze_anomaly(
        self,
        db: AsyncSession,
        metric_type: str,
        metric_date: date,
        current_value: float,
        historical_avg: float,
        supplier_id: Optional[int] = None,
        product_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        异常自动寻源
        
        当监控到某项指标突发飙升时，AI 自动触发分析，寻找强相关性因子。
        
        Args:
            db: 数据库会话
            metric_type: 指标类型
            metric_date: 指标日期
            current_value: 当前值
            historical_avg: 历史平均值
            supplier_id: 供应商ID（可选）
            product_type: 产品类型（可选）
        
        Returns:
            分析结果字典，包含：
            - anomaly_detected: 是否检测到异常
            - severity: 严重程度 (low/medium/high)
            - root_causes: 可能的根本原因列表
            - recommendations: 建议措施
            - related_data: 相关数据
        
        Requirements: 2.4.4
        """
        if not self._is_available():
            return {
                "anomaly_detected": False,
                "error": "AI 服务未配置或不可用"
            }
        
        try:
            # 计算异常程度
            change_percentage = ((current_value - historical_avg) / historical_avg * 100) if historical_avg != 0 else 0
            
            # 判断严重程度
            if abs(change_percentage) < 10:
                severity = "low"
            elif abs(change_percentage) < 30:
                severity = "medium"
            else:
                severity = "high"
            
            # 查询相关数据
            # 1. 查询同日期其他指标
            related_metrics_query = select(QualityMetric).where(
                and_(
                    QualityMetric.metric_date == metric_date,
                    QualityMetric.metric_type != metric_type
                )
            )
            
            if supplier_id:
                related_metrics_query = related_metrics_query.where(
                    QualityMetric.supplier_id == supplier_id
                )
            
            if product_type:
                related_metrics_query = related_metrics_query.where(
                    QualityMetric.product_type == product_type
                )
            
            result = await db.execute(related_metrics_query)
            related_metrics = result.scalars().all()
            
            # 2. 查询历史趋势（过去7天）
            start_date = metric_date - timedelta(days=7)
            historical_query = select(QualityMetric).where(
                and_(
                    QualityMetric.metric_type == metric_type,
                    QualityMetric.metric_date >= start_date,
                    QualityMetric.metric_date < metric_date
                )
            )
            
            if supplier_id:
                historical_query = historical_query.where(
                    QualityMetric.supplier_id == supplier_id
                )
            
            result = await db.execute(historical_query)
            historical_data = result.scalars().all()
            
            # 3. 获取供应商信息（如果有）
            supplier_name = None
            if supplier_id:
                supplier_query = select(Supplier).where(Supplier.id == supplier_id)
                supplier_result = await db.execute(supplier_query)
                supplier = supplier_result.scalar_one_or_none()
                if supplier:
                    supplier_name = supplier.name
            
            # 构建上下文信息
            context = {
                "metric_type": metric_type,
                "metric_date": metric_date.isoformat(),
                "current_value": current_value,
                "historical_avg": historical_avg,
                "change_percentage": change_percentage,
                "supplier_name": supplier_name,
                "product_type": product_type,
                "related_metrics": [
                    {
                        "type": m.metric_type,
                        "value": float(m.value)
                    }
                    for m in related_metrics
                ],
                "historical_trend": [
                    {
                        "date": m.metric_date.isoformat(),
                        "value": float(m.value)
                    }
                    for m in historical_data
                ]
            }
            
            # 调用 AI 进行分析
            prompt = f"""
你是一个质量管理专家。请分析以下质量指标异常情况：

指标类型：{metric_type}
日期：{metric_date.isoformat()}
当前值：{current_value}
历史平均值：{historical_avg}
变化幅度：{change_percentage:.2f}%
供应商：{supplier_name or '未指定'}
产品类型：{product_type or '未指定'}

相关指标数据：
{json.dumps(context['related_metrics'], indent=2, ensure_ascii=False)}

历史趋势（过去7天）：
{json.dumps(context['historical_trend'], indent=2, ensure_ascii=False)}

请分析：
1. 这个异常的可能根本原因（列出3-5个最可能的原因）
2. 建议的改善措施（具体可执行的措施）
3. 需要关注的相关指标

请以 JSON 格式返回，包含以下字段：
{{
    "root_causes": ["原因1", "原因2", "原因3"],
    "recommendations": ["建议1", "建议2", "建议3"],
    "related_indicators": ["指标1", "指标2"]
}}
"""
            
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",  # 使用 gpt-4o-mini 或 DeepSeek 兼容模型
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的质量管理专家，擅长分析质量数据异常并提供改善建议。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.7,
                max_tokens=1000
            )
            
            # 解析 AI 响应
            ai_response = response.choices[0].message.content
            
            # 尝试解析 JSON
            try:
                ai_analysis = json.loads(ai_response)
            except json.JSONDecodeError:
                # 如果不是 JSON，尝试提取关键信息
                ai_analysis = {
                    "root_causes": ["AI 分析结果解析失败"],
                    "recommendations": ["请人工审核"],
                    "related_indicators": []
                }
                logger.warning(f"AI 响应不是有效的 JSON: {ai_response}")
            
            return {
                "anomaly_detected": True,
                "severity": severity,
                "change_percentage": change_percentage,
                "root_causes": ai_analysis.get("root_causes", []),
                "recommendations": ai_analysis.get("recommendations", []),
                "related_indicators": ai_analysis.get("related_indicators", []),
                "context": context,
                "ai_raw_response": ai_response
            }
            
        except Exception as e:
            logger.error(f"AI 异常分析失败: {str(e)}", exc_info=True)
            return {
                "anomaly_detected": False,
                "error": f"分析失败: {str(e)}"
            }
    
    async def natural_language_query(
        self,
        db: AsyncSession,
        user_question: str,
        user_context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        自然语言查询
        
        用户可以用自然语言提问，AI 自动转化为 SQL 查询数据库并返回数据详情以及图表。
        
        Args:
            db: 数据库会话
            user_question: 用户的自然语言问题
            user_context: 用户上下文（如用户ID、供应商ID等）
        
        Returns:
            查询结果字典，包含：
            - understood_query: AI 理解的查询意图
            - sql_query: 生成的 SQL 查询（仅供参考）
            - data: 查询结果数据
            - chart_config: 图表配置（如果适用）
            - explanation: 结果解释
        
        Requirements: 2.4.4
        """
        if not self._is_available():
            return {
                "success": False,
                "error": "AI 服务未配置或不可用"
            }
        
        try:
            # 获取数据库表结构信息
            schema_info = """
数据库表结构：

1. quality_metrics (质量指标表)
   - id: 主键
   - metric_type: 指标类型 (incoming_batch_pass_rate, material_online_ppm, process_defect_rate, process_fpy, okm_ppm, mis_3_ppm, mis_12_ppm)
   - metric_date: 指标日期
   - value: 指标值
   - target_value: 目标值
   - product_type: 产品类型
   - supplier_id: 供应商ID
   - line_id: 产线ID
   - process_id: 工序ID

2. suppliers (供应商表)
   - id: 主键
   - name: 供应商名称
   - code: 供应商代码
   - status: 状态
"""
            
            # 调用 AI 理解用户意图并生成查询
            prompt = f"""
你是一个数据分析助手。用户提出了以下问题：

"{user_question}"

数据库结构：
{schema_info}

请分析用户的问题，并生成相应的 SQL 查询。

要求：
1. 只使用 SELECT 语句，不要使用 UPDATE/DELETE/INSERT
2. 使用标准 PostgreSQL 语法
3. 如果需要聚合，使用 GROUP BY
4. 如果需要排序，使用 ORDER BY
5. 限制返回结果数量（使用 LIMIT）

请以 JSON 格式返回：
{{
    "understood_query": "你理解的用户意图",
    "sql_query": "生成的 SQL 查询语句",
    "chart_type": "建议的图表类型 (line/bar/pie/table)",
    "explanation": "对查询结果的解释"
}}
"""
            
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的数据分析助手，擅长将自然语言转换为 SQL 查询。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.3,  # 降低温度以获得更确定的结果
                max_tokens=800
            )
            
            # 解析 AI 响应
            ai_response = response.choices[0].message.content
            
            try:
                ai_result = json.loads(ai_response)
            except json.JSONDecodeError:
                logger.warning(f"AI 响应不是有效的 JSON: {ai_response}")
                return {
                    "success": False,
                    "error": "AI 响应解析失败",
                    "ai_raw_response": ai_response
                }
            
            # 安全检查：确保只执行 SELECT 查询
            sql_query = ai_result.get("sql_query", "")
            if not sql_query.strip().upper().startswith("SELECT"):
                return {
                    "success": False,
                    "error": "安全限制：只允许执行 SELECT 查询"
                }
            
            # 执行 SQL 查询
            try:
                result = await db.execute(text(sql_query))
                rows = result.fetchall()
                
                # 转换为字典列表
                columns = result.keys()
                data = [
                    {col: (val.isoformat() if isinstance(val, (date, datetime)) else val) 
                     for col, val in zip(columns, row)}
                    for row in rows
                ]
                
                return {
                    "success": True,
                    "understood_query": ai_result.get("understood_query", ""),
                    "sql_query": sql_query,
                    "data": data,
                    "chart_type": ai_result.get("chart_type", "table"),
                    "explanation": ai_result.get("explanation", ""),
                    "row_count": len(data)
                }
                
            except Exception as sql_error:
                logger.error(f"SQL 执行失败: {str(sql_error)}")
                return {
                    "success": False,
                    "error": f"查询执行失败: {str(sql_error)}",
                    "sql_query": sql_query
                }
            
        except Exception as e:
            logger.error(f"自然语言查询失败: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": f"查询失败: {str(e)}"
            }
    
    async def generate_trend_chart(
        self,
        user_description: str,
        data: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        根据用户描述生成图表配置
        
        用户可以描述想要的图表，AI 自动生成 ECharts 配置。
        
        Args:
            user_description: 用户对图表的描述
            data: 可选的数据（如果已有数据）
        
        Returns:
            图表配置字典，包含：
            - chart_type: 图表类型
            - echarts_config: ECharts 配置对象
            - description: 图表描述
        
        Requirements: 2.4.4
        """
        if not self._is_available():
            return {
                "success": False,
                "error": "AI 服务未配置或不可用"
            }
        
        try:
            # 构建提示
            data_context = ""
            if data:
                data_context = f"\n\n可用数据示例（前5条）：\n{json.dumps(data[:5], indent=2, ensure_ascii=False)}"
            
            prompt = f"""
用户想要生成以下图表：

"{user_description}"
{data_context}

请生成一个 ECharts 配置对象。

要求：
1. 使用标准的 ECharts 5.x 配置格式
2. 包含 title, tooltip, legend, xAxis, yAxis, series 等必要配置
3. 选择合适的图表类型（line/bar/pie/radar等）
4. 使用中文标签
5. 配置要美观且易读

请以 JSON 格式返回：
{{
    "chart_type": "图表类型",
    "echarts_config": {{
        "title": {{}},
        "tooltip": {{}},
        "legend": {{}},
        "xAxis": {{}},
        "yAxis": {{}},
        "series": []
    }},
    "description": "图表说明"
}}
"""
            
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个数据可视化专家，擅长生成 ECharts 图表配置。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.5,
                max_tokens=1500
            )
            
            # 解析 AI 响应
            ai_response = response.choices[0].message.content
            
            try:
                ai_result = json.loads(ai_response)
                
                return {
                    "success": True,
                    "chart_type": ai_result.get("chart_type", "line"),
                    "echarts_config": ai_result.get("echarts_config", {}),
                    "description": ai_result.get("description", "")
                }
                
            except json.JSONDecodeError:
                logger.warning(f"AI 响应不是有效的 JSON: {ai_response}")
                return {
                    "success": False,
                    "error": "AI 响应解析失败",
                    "ai_raw_response": ai_response
                }
            
        except Exception as e:
            logger.error(f"图表生成失败: {str(e)}", exc_info=True)
            return {
                "success": False,
                "error": f"生成失败: {str(e)}"
            }


# 创建全局实例
ai_analysis_service = AIAnalysisService()
