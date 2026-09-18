"""
供应商会议与改进监控数据模型
Supplier Meeting - 基于绩效等级的强制干预机制
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, DateTime, Boolean, ForeignKey, Text, Date
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SupplierMeeting(Base):
    """
    供应商会议记录模型
    当月度绩效生成为C级或D级时，自动生成"供应商月度品质改善会议"任务
    """
    __tablename__ = "supplier_meetings"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 关联信息
    supplier_id: Mapped[int] = mapped_column(
        ForeignKey("suppliers.id"),
        nullable=False,
        index=True,
        comment="供应商ID"
    )
    
    performance_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_performances.id"),
        nullable=False,
        index=True,
        comment="关联的绩效评价ID"
    )
    
    # 会议基本信息
    meeting_number: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
        comment="会议编号"
    )
    
    meeting_date: Mapped[Optional[Date]] = mapped_column(
        Date,
        comment="会议日期"
    )
    
    performance_grade: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        comment="触发会议的绩效等级（C或D）"
    )
    
    # 参会人员要求
    required_attendee_level: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="要求参会人员级别（C级:副总级，D级:总经理）"
    )
    
    # 资料上传
    improvement_report_path: Mapped[Optional[str]] = mapped_column(
        String(500),
        comment="物料品质问题改善报告路径"
    )
    
    report_uploaded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        comment="报告上传时间"
    )
    
    report_uploaded_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"),
        comment="报告上传人ID（供应商用户）"
    )
    
    # 考勤与纪要
    actual_attendee_level: Mapped[Optional[str]] = mapped_column(
        String(50),
        comment="实际参会最高级别人员"
    )
    
    attendee_name: Mapped[Optional[str]] = mapped_column(
        String(100),
        comment="参会人员姓名"
    )
    
    attendee_position: Mapped[Optional[str]] = mapped_column(
        String(100),
        comment="参会人员职位"
    )
    
    meeting_minutes: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="会议纪要"
    )
    
    # 违规标记
    supplier_attended: Mapped[bool] = mapped_column(
        default=True,
        nullable=False,
        comment="供应商是否参会"
    )
    
    report_submitted: Mapped[bool] = mapped_column(
        default=False,
        nullable=False,
        comment="是否提交改善报告"
    )
    
    penalty_applied: Mapped[bool] = mapped_column(
        default=False,
        nullable=False,
        comment="是否已执行违规处罚（下月配合度扣分）"
    )
    
    penalty_reason: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="处罚原因"
    )
    
    # 状态管理
    status: Mapped[str] = mapped_column(
        String(20),
        default="pending",
        nullable=False,
        index=True,
        comment="状态：pending-待召开，completed-已完成，cancelled-已取消"
    )
    
    # SQE记录人
    recorded_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"),
        comment="记录人ID（SQE）"
    )
    
    recorded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        comment="记录时间"
    )
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        comment="创建时间"
    )
    
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        comment="更新时间"
    )
    
    created_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"),
        comment="创建人ID"
    )
    
    __table_args__ = (
        {"comment": "供应商会议记录表"},
    )
    
    def __repr__(self) -> str:
        return (
            f"<SupplierMeeting(id={self.id}, "
            f"meeting_number='{self.meeting_number}', "
            f"supplier_id={self.supplier_id}, "
            f"grade='{self.performance_grade}', "
            f"status='{self.status}')>"
        )
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "supplier_id": self.supplier_id,
            "performance_id": self.performance_id,
            "meeting_number": self.meeting_number,
            "meeting_date": self.meeting_date.isoformat() if self.meeting_date else None,
            "performance_grade": self.performance_grade,
            "required_attendee_level": self.required_attendee_level,
            "improvement_report_path": self.improvement_report_path,
            "report_uploaded_at": self.report_uploaded_at.isoformat() if self.report_uploaded_at else None,
            "report_uploaded_by": self.report_uploaded_by,
            "actual_attendee_level": self.actual_attendee_level,
            "attendee_name": self.attendee_name,
            "attendee_position": self.attendee_position,
            "meeting_minutes": self.meeting_minutes,
            "supplier_attended": self.supplier_attended,
            "report_submitted": self.report_submitted,
            "penalty_applied": self.penalty_applied,
            "penalty_reason": self.penalty_reason,
            "status": self.status,
            "recorded_by": self.recorded_by,
            "recorded_at": self.recorded_at.isoformat() if self.recorded_at else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "created_by": self.created_by,
        }
