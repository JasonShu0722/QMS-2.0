"""
审核报告生成服务
Audit Report Service - 生成PDF审核报告（含雷达图）
"""
from datetime import datetime
from typing import Optional, Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
import os
from pathlib import Path
import json

from app.models.audit import AuditExecution, AuditPlan, AuditTemplate
from app.core.exceptions import NotFoundException


class AuditReportService:
    """审核报告生成服务类"""
    
    # 报告存储路径
    REPORT_DIR = Path("uploads/audit_reports")
    
    @staticmethod
    async def generate_audit_report(
        db: AsyncSession,
        execution_id: int,
        include_radar_chart: bool = True,
        include_photos: bool = True
    ) -> tuple[str, str]:
        """
        生成审核报告（PDF格式，含雷达图）
        
        实现逻辑：
        1. 获取审核执行记录、计划和模板数据
        2. 生成雷达图（使用matplotlib）
        3. 生成PDF报告（使用reportlab）
        4. 返回报告文件路径和下载URL
        
        Args:
            db: 数据库会话
            execution_id: 审核执行记录ID
            include_radar_chart: 是否包含雷达图
            include_photos: 是否包含证据照片
            
        Returns:
            (报告文件路径, 报告下载URL)
        """
        # 获取审核执行记录
        audit_execution = await db.get(AuditExecution, execution_id)
        if not audit_execution:
            raise NotFoundException(f"审核执行记录 ID {execution_id} 不存在")
        
        # 获取审核计划
        audit_plan = await db.get(AuditPlan, audit_execution.audit_plan_id)
        if not audit_plan:
            raise NotFoundException(f"审核计划 ID {audit_execution.audit_plan_id} 不存在")
        
        # 获取审核模板
        template = await db.get(AuditTemplate, audit_execution.template_id)
        if not template:
            raise NotFoundException(f"审核模板 ID {audit_execution.template_id} 不存在")
        
        # 确保报告目录存在
        AuditReportService.REPORT_DIR.mkdir(parents=True, exist_ok=True)
        
        # 生成报告文件名
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"audit_report_{execution_id}_{timestamp}.pdf"
        report_path = AuditReportService.REPORT_DIR / filename
        
        # 准备报告数据
        report_data = {
            "execution": audit_execution,
            "plan": audit_plan,
            "template": template,
            "include_radar_chart": include_radar_chart,
            "include_photos": include_photos
        }
        
        # 生成PDF报告
        await AuditReportService._generate_pdf_report(
            report_path,
            report_data
        )
        
        # 更新审核执行记录的报告路径
        audit_execution.audit_report_path = str(report_path)
        audit_execution.updated_at = datetime.utcnow()
        await db.commit()
        
        # 生成下载URL
        report_url = f"/api/v1/audit-executions/{execution_id}/report/download"
        
        return str(report_path), report_url
    
    @staticmethod
    async def _generate_pdf_report(
        report_path: Path,
        report_data: Dict[str, Any]
    ):
        """
        生成PDF报告
        
        注意：这是一个简化实现，实际生产环境需要使用reportlab或weasyprint
        生成专业的PDF报告。这里使用HTML模板 + 文本输出作为演示。
        
        Args:
            report_path: 报告文件路径
            report_data: 报告数据
        """
        execution = report_data["execution"]
        plan = report_data["plan"]
        template = report_data["template"]
        
        # 生成雷达图（如果需要）
        radar_chart_path = None
        if report_data["include_radar_chart"]:
            radar_chart_path = await AuditReportService._generate_radar_chart(
                execution,
                template
            )
        
        # 生成HTML报告内容
        html_content = AuditReportService._generate_html_report(
            execution,
            plan,
            template,
            radar_chart_path,
            report_data["include_photos"]
        )
        
        # 简化实现：将HTML内容写入文件
        # 实际生产环境应使用weasyprint或reportlab转换为PDF
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(html_content)
        
        # TODO: 在实际生产环境中，使用以下代码生成真正的PDF：
        # from weasyprint import HTML
        # HTML(string=html_content).write_pdf(report_path)
    
    @staticmethod
    async def _generate_radar_chart(
        execution: AuditExecution,
        template: AuditTemplate
    ) -> Optional[str]:
        """
        生成雷达图
        
        使用matplotlib生成审核结果的雷达图
        
        Args:
            execution: 审核执行记录
            template: 审核模板
            
        Returns:
            雷达图文件路径
        """
        try:
            import matplotlib.pyplot as plt
            import numpy as np
            from matplotlib.patches import Circle, RegularPolygon
            from matplotlib.path import Path as MplPath
            from matplotlib.projections.polar import PolarAxes
            from matplotlib.projections import register_projection
            from matplotlib.spines import Spine
            from matplotlib.transforms import Affine2D
            
            # 准备数据
            checklist_results = execution.checklist_results
            if not checklist_results or "items" not in checklist_results:
                return None
            
            items = checklist_results["items"]
            if not items:
                return None
            
            # 提取类别和得分
            categories = []
            scores = []
            
            for item in items[:8]:  # 最多显示8个维度
                item_id = item.get("item_id", "")
                score = item.get("score", 0)
                categories.append(item_id)
                scores.append(score)
            
            if not categories:
                return None
            
            # 创建雷达图
            N = len(categories)
            angles = np.linspace(0, 2 * np.pi, N, endpoint=False).tolist()
            scores_plot = scores + [scores[0]]  # 闭合图形
            angles += angles[:1]
            
            fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(projection='polar'))
            ax.plot(angles, scores_plot, 'o-', linewidth=2, label='实际得分')
            ax.fill(angles, scores_plot, alpha=0.25)
            ax.set_xticks(angles[:-1])
            ax.set_xticklabels(categories)
            ax.set_ylim(0, 10)
            ax.set_title('审核结果雷达图', size=16, pad=20)
            ax.legend(loc='upper right', bbox_to_anchor=(1.3, 1.1))
            ax.grid(True)
            
            # 保存雷达图
            chart_dir = Path("uploads/audit_charts")
            chart_dir.mkdir(parents=True, exist_ok=True)
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            chart_filename = f"radar_chart_{execution.id}_{timestamp}.png"
            chart_path = chart_dir / chart_filename
            
            plt.savefig(chart_path, dpi=150, bbox_inches='tight')
            plt.close()
            
            return str(chart_path)
            
        except ImportError:
            # matplotlib未安装，跳过雷达图生成
            return None
        except Exception as e:
            # 雷达图生成失败，记录错误但不影响报告生成
            print(f"雷达图生成失败: {str(e)}")
            return None
    
    @staticmethod
    def _generate_html_report(
        execution: AuditExecution,
        plan: AuditPlan,
        template: AuditTemplate,
        radar_chart_path: Optional[str],
        include_photos: bool
    ) -> str:
        """
        生成HTML格式的审核报告
        
        Args:
            execution: 审核执行记录
            plan: 审核计划
            template: 审核模板
            radar_chart_path: 雷达图路径
            include_photos: 是否包含证据照片
            
        Returns:
            HTML内容
        """
        html = f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>审核报告 - {plan.audit_name}</title>
    <style>
        body {{
            font-family: "Microsoft YaHei", Arial, sans-serif;
            margin: 40px;
            line-height: 1.6;
        }}
        h1 {{
            text-align: center;
            color: #333;
            border-bottom: 3px solid #4CAF50;
            padding-bottom: 10px;
        }}
        .section {{
            margin: 20px 0;
            padding: 15px;
            background-color: #f9f9f9;
            border-left: 4px solid #4CAF50;
        }}
        .section-title {{
            font-size: 18px;
            font-weight: bold;
            color: #4CAF50;
            margin-bottom: 10px;
        }}
        .info-row {{
            margin: 5px 0;
        }}
        .label {{
            font-weight: bold;
            color: #555;
        }}
        .score-box {{
            text-align: center;
            padding: 20px;
            background-color: #e8f5e9;
            border: 2px solid #4CAF50;
            border-radius: 8px;
            margin: 20px 0;
        }}
        .score {{
            font-size: 48px;
            font-weight: bold;
            color: #4CAF50;
        }}
        .grade {{
            font-size: 36px;
            font-weight: bold;
            color: #2196F3;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }}
        th, td {{
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
        }}
        th {{
            background-color: #4CAF50;
            color: white;
        }}
        tr:nth-child(even) {{
            background-color: #f2f2f2;
        }}
        .nc-item {{
            background-color: #ffebee;
        }}
        img {{
            max-width: 300px;
            margin: 10px;
            border: 1px solid #ddd;
        }}
    </style>
</head>
<body>
    <h1>审核报告</h1>
    
    <div class="section">
        <div class="section-title">基本信息</div>
        <div class="info-row"><span class="label">审核名称：</span>{plan.audit_name}</div>
        <div class="info-row"><span class="label">审核类型：</span>{plan.audit_type}</div>
        <div class="info-row"><span class="label">审核日期：</span>{execution.audit_date.strftime('%Y-%m-%d')}</div>
        <div class="info-row"><span class="label">被审核部门：</span>{plan.auditee_dept}</div>
        <div class="info-row"><span class="label">审核员ID：</span>{execution.auditor_id}</div>
    </div>
    
    <div class="score-box">
        <div><span class="label">最终得分：</span><span class="score">{execution.final_score or 0}</span> 分</div>
        <div><span class="label">等级评定：</span><span class="grade">{execution.grade or 'N/A'}</span></div>
    </div>
"""
        
        # 添加雷达图
        if radar_chart_path:
            html += f"""
    <div class="section">
        <div class="section-title">审核结果雷达图</div>
        <img src="{radar_chart_path}" alt="雷达图" style="max-width: 600px; display: block; margin: 0 auto;">
    </div>
"""
        
        # 添加检查表结果
        checklist_results = execution.checklist_results
        if checklist_results and "items" in checklist_results:
            html += """
    <div class="section">
        <div class="section-title">检查表结果</div>
        <table>
            <thead>
                <tr>
                    <th>条款编号</th>
                    <th>得分</th>
                    <th>评价意见</th>
                    <th>是否NC</th>
                </tr>
            </thead>
            <tbody>
"""
            for item in checklist_results["items"]:
                nc_class = "nc-item" if item.get("is_nc") else ""
                html += f"""
                <tr class="{nc_class}">
                    <td>{item.get('item_id', '')}</td>
                    <td>{item.get('score', 0)}</td>
                    <td>{item.get('comment', '')}</td>
                    <td>{'是' if item.get('is_nc') else '否'}</td>
                </tr>
"""
                
                # 添加证据照片
                if include_photos and item.get("evidence_photos"):
                    html += """
                <tr>
                    <td colspan="4">
                        <strong>证据照片：</strong><br>
"""
                    for photo in item.get("evidence_photos", []):
                        html += f'<img src="{photo}" alt="证据照片"><br>'
                    html += """
                    </td>
                </tr>
"""
            
            html += """
            </tbody>
        </table>
    </div>
"""
        
        # 添加审核总结
        if execution.summary:
            html += f"""
    <div class="section">
        <div class="section-title">审核总结</div>
        <p>{execution.summary}</p>
    </div>
"""
        
        html += """
    <div style="text-align: center; margin-top: 40px; color: #999;">
        <p>报告生成时间：""" + datetime.now().strftime('%Y-%m-%d %H:%M:%S') + """</p>
    </div>
</body>
</html>
"""
        
        return html
