"""
审核模板服务
Audit Template Service - 审核模板的业务逻辑处理
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditTemplate
from app.schemas.audit_template import (
    AuditTemplateCreate,
    AuditTemplateUpdate
)


class AuditTemplateService:
    """审核模板服务类"""
    
    # 内置标准模板定义
    BUILTIN_TEMPLATES = {
        "VDA 6.3 P2-P7": {
            "audit_type": "process_audit",
            "description": "VDA 6.3 过程审核标准模板 (P2-P7)",
            "checklist_items": {
                "P2": {
                    "name": "项目管理",
                    "items": [
                        {
                            "id": "P2.1",
                            "question": "是否明确了项目目标和范围？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        },
                        {
                            "id": "P2.2",
                            "question": "是否建立了项目组织结构？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        },
                        {
                            "id": "P2.3",
                            "question": "是否制定了项目计划和里程碑？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        }
                    ]
                },
                "P3": {
                    "name": "产品和过程开发的策划",
                    "items": [
                        {
                            "id": "P3.1",
                            "question": "是否识别了特殊特性？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        },
                        {
                            "id": "P3.2",
                            "question": "是否进行了风险分析（FMEA）？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        }
                    ]
                },
                "P4": {
                    "name": "产品和过程开发的实现",
                    "items": [
                        {
                            "id": "P4.1",
                            "question": "是否按计划完成了产品设计？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        },
                        {
                            "id": "P4.2",
                            "question": "是否进行了设计验证和确认？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        }
                    ]
                },
                "P5": {
                    "name": "供应商管理",
                    "items": [
                        {
                            "id": "P5.1",
                            "question": "是否对供应商进行了评估和选择？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        },
                        {
                            "id": "P5.2",
                            "question": "是否监控供应商绩效？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        }
                    ]
                },
                "P6": {
                    "name": "过程分析/生产",
                    "items": [
                        {
                            "id": "P6.1",
                            "question": "是否建立了生产控制计划？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        },
                        {
                            "id": "P6.2",
                            "question": "是否进行了过程能力分析？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        },
                        {
                            "id": "P6.3",
                            "question": "是否实施了防错措施？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        }
                    ]
                },
                "P7": {
                    "name": "顾客关怀/顾客满意/服务",
                    "items": [
                        {
                            "id": "P7.1",
                            "question": "是否建立了客户反馈机制？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        },
                        {
                            "id": "P7.2",
                            "question": "是否及时处理客户投诉？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        }
                    ]
                }
            },
            "scoring_rules": {
                "method": "percentage",
                "total_points": 100,
                "grade_thresholds": {
                    "A": 90,
                    "B": 80,
                    "C": 70,
                    "D": 0
                },
                "downgrade_rules": [
                    {
                        "condition": "任何单项得分为0",
                        "action": "整体等级降一级"
                    }
                ],
                "calculation": "总得分 = Σ(各条款得分) / 总条款数 * 100"
            }
        },
        "VDA 6.5": {
            "audit_type": "product_audit",
            "description": "VDA 6.5 产品审核标准模板",
            "checklist_items": {
                "P1": {
                    "name": "文件和标识",
                    "items": [
                        {
                            "id": "P1.1",
                            "question": "产品标识是否清晰完整？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        },
                        {
                            "id": "P1.2",
                            "question": "技术文件是否齐全有效？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        }
                    ]
                },
                "P2": {
                    "name": "功能和性能",
                    "items": [
                        {
                            "id": "P2.1",
                            "question": "产品功能是否符合规格要求？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        },
                        {
                            "id": "P2.2",
                            "question": "产品性能是否满足客户需求？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        }
                    ]
                },
                "P3": {
                    "name": "尺寸和外观",
                    "items": [
                        {
                            "id": "P3.1",
                            "question": "关键尺寸是否在公差范围内？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        },
                        {
                            "id": "P3.2",
                            "question": "外观质量是否符合标准？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        }
                    ]
                },
                "P4": {
                    "name": "材料和表面处理",
                    "items": [
                        {
                            "id": "P4.1",
                            "question": "材料是否符合规格要求？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        },
                        {
                            "id": "P4.2",
                            "question": "表面处理是否符合要求？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        }
                    ]
                },
                "P5": {
                    "name": "包装和运输",
                    "items": [
                        {
                            "id": "P5.1",
                            "question": "包装是否符合要求？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        },
                        {
                            "id": "P5.2",
                            "question": "运输保护是否充分？",
                            "scoring": "0-10分",
                            "evidence_required": True
                        }
                    ]
                }
            },
            "scoring_rules": {
                "method": "percentage",
                "total_points": 100,
                "grade_thresholds": {
                    "A": 95,
                    "B": 85,
                    "C": 75,
                    "D": 0
                },
                "downgrade_rules": [
                    {
                        "condition": "任何单项得分为0",
                        "action": "整体等级降一级"
                    }
                ],
                "calculation": "总得分 = Σ(各条款得分) / 总条款数 * 100"
            }
        },
        "IATF 16949": {
            "audit_type": "system_audit",
            "description": "IATF 16949 体系审核标准模板",
            "checklist_items": {
                "4": {
                    "name": "组织环境",
                    "items": [
                        {
                            "id": "4.1",
                            "question": "是否理解组织及其环境？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "4.2",
                            "question": "是否理解相关方的需求和期望？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "4.3",
                            "question": "是否确定了质量管理体系的范围？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "4.4",
                            "question": "质量管理体系及其过程是否建立？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        }
                    ]
                },
                "5": {
                    "name": "领导作用",
                    "items": [
                        {
                            "id": "5.1",
                            "question": "最高管理者是否展现领导作用和承诺？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "5.2",
                            "question": "是否制定了质量方针？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "5.3",
                            "question": "是否明确了组织的角色、职责和权限？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        }
                    ]
                },
                "6": {
                    "name": "策划",
                    "items": [
                        {
                            "id": "6.1",
                            "question": "是否识别了风险和机遇？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "6.2",
                            "question": "是否制定了质量目标及实现计划？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "6.3",
                            "question": "是否策划了变更？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        }
                    ]
                },
                "7": {
                    "name": "支持",
                    "items": [
                        {
                            "id": "7.1",
                            "question": "是否提供了必要的资源？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "7.2",
                            "question": "是否确保人员能力？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "7.3",
                            "question": "是否建立了意识培训？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "7.4",
                            "question": "是否建立了沟通机制？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "7.5",
                            "question": "是否控制了文件化信息？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        }
                    ]
                },
                "8": {
                    "name": "运行",
                    "items": [
                        {
                            "id": "8.1",
                            "question": "是否策划和控制了运行？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "8.2",
                            "question": "是否确定了产品和服务的要求？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "8.3",
                            "question": "是否进行了产品和服务的设计和开发？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "8.4",
                            "question": "是否控制了外部提供的过程、产品和服务？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "8.5",
                            "question": "是否控制了生产和服务提供？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "8.6",
                            "question": "是否放行了产品和服务？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "8.7",
                            "question": "是否控制了不合格输出？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        }
                    ]
                },
                "9": {
                    "name": "绩效评价",
                    "items": [
                        {
                            "id": "9.1",
                            "question": "是否进行了监视、测量、分析和评价？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "9.2",
                            "question": "是否进行了内部审核？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "9.3",
                            "question": "是否进行了管理评审？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        }
                    ]
                },
                "10": {
                    "name": "改进",
                    "items": [
                        {
                            "id": "10.1",
                            "question": "是否识别了改进机会？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "10.2",
                            "question": "是否处理了不合格和纠正措施？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        },
                        {
                            "id": "10.3",
                            "question": "是否实施了持续改进？",
                            "scoring": "符合/不符合",
                            "evidence_required": True
                        }
                    ]
                }
            },
            "scoring_rules": {
                "method": "conformity",
                "grade_thresholds": {
                    "A": "无不符合项",
                    "B": "仅有轻微不符合项",
                    "C": "有一般不符合项",
                    "D": "有严重不符合项"
                },
                "nc_classification": {
                    "major": "严重不符合：系统性失效或影响产品质量",
                    "minor": "一般不符合：局部性问题",
                    "observation": "观察项：潜在风险"
                }
            }
        }
    }
    
    @staticmethod
    async def create_audit_template(
        db: AsyncSession,
        template_data: AuditTemplateCreate,
        created_by: int,
        is_builtin: bool = False
    ) -> AuditTemplate:
        """
        创建审核模板
        
        Args:
            db: 数据库会话
            template_data: 审核模板数据
            created_by: 创建人ID
            is_builtin: 是否为内置模板
            
        Returns:
            创建的审核模板对象
        """
        audit_template = AuditTemplate(
            template_name=template_data.template_name,
            audit_type=template_data.audit_type,
            checklist_items=template_data.checklist_items,
            scoring_rules=template_data.scoring_rules,
            description=template_data.description,
            is_active=template_data.is_active,
            is_builtin=is_builtin,
            created_by=created_by
        )
        
        db.add(audit_template)
        await db.commit()
        await db.refresh(audit_template)
        
        return audit_template
    
    @staticmethod
    async def get_audit_template_by_id(
        db: AsyncSession,
        template_id: int
    ) -> Optional[AuditTemplate]:
        """
        根据ID获取审核模板
        
        Args:
            db: 数据库会话
            template_id: 审核模板ID
            
        Returns:
            审核模板对象或None
        """
        result = await db.execute(
            select(AuditTemplate).where(AuditTemplate.id == template_id)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def get_audit_template_by_name(
        db: AsyncSession,
        template_name: str
    ) -> Optional[AuditTemplate]:
        """
        根据名称获取审核模板
        
        Args:
            db: 数据库会话
            template_name: 模板名称
            
        Returns:
            审核模板对象或None
        """
        result = await db.execute(
            select(AuditTemplate).where(AuditTemplate.template_name == template_name)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def get_audit_templates(
        db: AsyncSession,
        audit_type: Optional[str] = None,
        is_active: Optional[bool] = None,
        is_builtin: Optional[bool] = None,
        page: int = 1,
        page_size: int = 50
    ) -> tuple[list[AuditTemplate], int]:
        """
        获取审核模板列表（支持筛选和分页）
        
        Args:
            db: 数据库会话
            audit_type: 审核类型筛选
            is_active: 是否启用筛选
            is_builtin: 是否内置模板筛选
            page: 页码
            page_size: 每页记录数
            
        Returns:
            (审核模板列表, 总记录数)
        """
        # 构建查询
        query = select(AuditTemplate)
        
        # 应用筛选条件
        if audit_type:
            query = query.where(AuditTemplate.audit_type == audit_type)
        if is_active is not None:
            query = query.where(AuditTemplate.is_active == is_active)
        if is_builtin is not None:
            query = query.where(AuditTemplate.is_builtin == is_builtin)
        
        # 获取总记录数
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar_one()
        
        # 应用分页和排序
        query = query.order_by(
            AuditTemplate.is_builtin.desc(),  # 内置模板优先
            AuditTemplate.created_at.desc()
        )
        query = query.offset((page - 1) * page_size).limit(page_size)
        
        # 执行查询
        result = await db.execute(query)
        templates = result.scalars().all()
        
        return list(templates), total
    
    @staticmethod
    async def update_audit_template(
        db: AsyncSession,
        template_id: int,
        template_data: AuditTemplateUpdate
    ) -> Optional[AuditTemplate]:
        """
        更新审核模板
        
        Args:
            db: 数据库会话
            template_id: 审核模板ID
            template_data: 更新数据
            
        Returns:
            更新后的审核模板对象或None
        """
        audit_template = await AuditTemplateService.get_audit_template_by_id(db, template_id)
        if not audit_template:
            return None
        
        # 内置模板不允许修改
        if audit_template.is_builtin:
            raise ValueError("内置模板不允许修改")
        
        # 更新字段
        update_data = template_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(audit_template, field, value)
        
        audit_template.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(audit_template)
        
        return audit_template
    
    @staticmethod
    async def delete_audit_template(
        db: AsyncSession,
        template_id: int
    ) -> bool:
        """
        删除审核模板
        
        Args:
            db: 数据库会话
            template_id: 审核模板ID
            
        Returns:
            是否删除成功
        """
        audit_template = await AuditTemplateService.get_audit_template_by_id(db, template_id)
        if not audit_template:
            return False
        
        # 内置模板不允许删除
        if audit_template.is_builtin:
            raise ValueError("内置模板不允许删除")
        
        await db.delete(audit_template)
        await db.commit()
        
        return True
    
    @staticmethod
    async def initialize_builtin_templates(
        db: AsyncSession,
        created_by: int = 1
    ) -> list[AuditTemplate]:
        """
        初始化内置标准模板
        
        Args:
            db: 数据库会话
            created_by: 创建人ID（默认为系统管理员）
            
        Returns:
            创建的内置模板列表
        """
        created_templates = []
        
        for template_name, template_config in AuditTemplateService.BUILTIN_TEMPLATES.items():
            # 检查模板是否已存在
            existing_template = await AuditTemplateService.get_audit_template_by_name(
                db, template_name
            )
            
            if existing_template:
                # 模板已存在，跳过
                continue
            
            # 创建内置模板
            template_data = AuditTemplateCreate(
                template_name=template_name,
                audit_type=template_config["audit_type"],
                checklist_items=template_config["checklist_items"],
                scoring_rules=template_config["scoring_rules"],
                description=template_config["description"],
                is_active=True
            )
            
            template = await AuditTemplateService.create_audit_template(
                db=db,
                template_data=template_data,
                created_by=created_by,
                is_builtin=True
            )
            
            created_templates.append(template)
        
        return created_templates
